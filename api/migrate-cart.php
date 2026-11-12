<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Missing api/config.php. Configure MySQL before running this migration.\n");
    exit(1);
}

$config = require $configPath;
try {
    $pdo = new PDO($config['dsn'], $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS cart_items (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            item_key VARCHAR(512) NOT NULL,
            title VARCHAR(120) NOT NULL,
            review_title VARCHAR(120) NOT NULL DEFAULT \'\',
            image MEDIUMTEXT NOT NULL,
            product_path VARCHAR(1000) NOT NULL DEFAULT \'\',
            instructions VARCHAR(500) NOT NULL DEFAULT \'\',
            unit_price DECIMAL(10,2) NOT NULL,
            quantity INT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT cart_items_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX cart_items_user_idx (user_id)
        ) ENGINE=InnoDB'
    );

    $column = $pdo->query("SHOW COLUMNS FROM carts LIKE 'items'")->fetch();
    $migratedItems = 0;
    if ($column) {
        $rows = $pdo->query('SELECT user_id, items FROM carts')->fetchAll();
        $decodedRows = [];
        foreach ($rows as $row) {
            $items = json_decode($row['items'], true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($items)) {
                throw new RuntimeException("Cart for user {$row['user_id']} is not a JSON list.");
            }
            $decodedRows[] = [(int)$row['user_id'], $items];
        }

        $pdo->beginTransaction();
        $delete = $pdo->prepare('DELETE FROM cart_items WHERE user_id = ?');
        $insert = $pdo->prepare(
            'INSERT INTO cart_items
             (user_id, item_key, title, review_title, image, product_path, instructions, unit_price, quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($decodedRows as [$userId, $items]) {
            $delete->execute([$userId]);
            foreach ($items as $item) {
                if (!is_array($item) || !is_string($item['title'] ?? null)
                    || !is_numeric($item['price'] ?? null)
                    || !is_numeric($item['quantity'] ?? null)
                    || (int)$item['quantity'] < 1 || (int)$item['quantity'] > 99) {
                    throw new RuntimeException("Cart for user $userId contains an invalid item; no carts were changed.");
                }
                $title = trim($item['title']);
                $image = is_string($item['img'] ?? null) ? trim($item['img']) : '';
                $path = is_string($item['link'] ?? null) ? trim($item['link']) : '';
                $itemKey = is_string($item['key'] ?? null) && trim($item['key']) !== ''
                    ? trim($item['key'])
                    : ($path !== '' ? $path : $title . '|' . $image);
                $reviewTitle = is_string($item['reviewTitle'] ?? null) && trim($item['reviewTitle']) !== ''
                    ? trim($item['reviewTitle'])
                    : $title;
                $instructions = is_string($item['instructions'] ?? null) ? trim($item['instructions']) : '';
                if ($title === '' || strlen($title) > 120 || strlen($itemKey) > 512
                    || strlen($reviewTitle) > 120 || strlen($image) > 1000
                    || strlen($path) > 1000 || strlen($instructions) > 500
                    || (float)$item['price'] < 0 || (float)$item['price'] > 100000) {
                    throw new RuntimeException("Cart for user $userId contains an item outside the supported limits; no carts were changed.");
                }
                $insert->execute([
                    $userId,
                    $itemKey,
                    $title,
                    $reviewTitle,
                    $image,
                    $path,
                    $instructions,
                    (float)$item['price'],
                    (int)$item['quantity'],
                ]);
                $migratedItems++;
            }
        }
        $pdo->commit();
        $pdo->exec('ALTER TABLE carts DROP COLUMN items');
    }

    fwrite(STDOUT, "Cart migration complete. $migratedItems item(s) are stored as individual rows in cart_items.\n");
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "Cart migration failed: {$error->getMessage()}\n");
    exit(1);
}
