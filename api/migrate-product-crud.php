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

    $hasColumn = static function (string $table, string $column) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
        );
        $statement->execute([$table, $column]);
        return (bool)$statement->fetchColumn();
    };
    $hasIndex = static function (string $table, string $index) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?'
        );
        $statement->execute([$table, $index]);
        return (bool)$statement->fetchColumn();
    };
    $hasConstraint = static function (string $table, string $constraint) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?'
        );
        $statement->execute([$table, $constraint]);
        return (bool)$statement->fetchColumn();
    };

    if (!$hasColumn('products', 'sku')) {
        $pdo->exec('ALTER TABLE products ADD COLUMN sku VARCHAR(40) NULL');
    }
    if (!$hasColumn('products', 'source_key')) {
        $pdo->exec('ALTER TABLE products ADD COLUMN source_key VARCHAR(120) NULL');
    }
    if (!$hasColumn('products', 'metadata')) {
        $pdo->exec('ALTER TABLE products ADD COLUMN metadata JSON NULL');
    }
    if (!$hasIndex('products', 'products_sku_unique')) {
        $pdo->exec('ALTER TABLE products ADD UNIQUE INDEX products_sku_unique (sku)');
    }
    if (!$hasIndex('products', 'products_source_key_unique')) {
        $pdo->exec('ALTER TABLE products ADD UNIQUE INDEX products_source_key_unique (source_key)');
    }
    $pdo->exec(
        'UPDATE products SET source_key = LOWER(title)
         WHERE source_key IS NULL OR source_key = ""'
    );
    $pdo->exec('ALTER TABLE products MODIFY source_key VARCHAR(120) NOT NULL');
    $pdo->exec(
        'ALTER TABLE products MODIFY updated_at TIMESTAMP(6) NOT NULL
         DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'
    );

    foreach (['products', 'favorites', 'cart_items', 'order_items'] as $table) {
        $imageColumn = $pdo->query("SHOW COLUMNS FROM `$table` LIKE 'image'")->fetch();
        if ($imageColumn && !str_starts_with(strtolower($imageColumn['Type']), 'mediumtext')) {
            $pdo->exec("ALTER TABLE `$table` MODIFY image MEDIUMTEXT NOT NULL");
        }
    }

    foreach (['favorites', 'cart_items', 'order_items'] as $table) {
        if (!$hasColumn($table, 'product_id')) {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN product_id BIGINT UNSIGNED NULL");
        }
        $index = "{$table}_product_idx";
        if (!$hasIndex($table, $index)) {
            $pdo->exec("ALTER TABLE `$table` ADD INDEX `$index` (product_id)");
        }
    }
    $pdo->exec(
        'UPDATE favorites f JOIN products p ON p.title = f.product_title
         SET f.product_id = p.id WHERE f.product_id IS NULL'
    );
    $pdo->exec(
        'UPDATE cart_items c JOIN products p ON p.title = c.title
         SET c.product_id = p.id WHERE c.product_id IS NULL'
    );
    $pdo->exec(
        'UPDATE order_items i JOIN products p ON p.title = i.title
         SET i.product_id = p.id WHERE i.product_id IS NULL'
    );
    foreach ([
        ['favorites', 'favorites_product_fk'],
        ['cart_items', 'cart_items_product_fk'],
        ['order_items', 'order_items_product_fk'],
    ] as [$table, $constraint]) {
        if (!$hasConstraint($table, $constraint)) {
            $pdo->exec(
                "ALTER TABLE `$table` ADD CONSTRAINT `$constraint`
                 FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL"
            );
        }
    }
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS product_revisions (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            staff_id BIGINT UNSIGNED NULL,
            product_id BIGINT UNSIGNED NOT NULL,
            before_data JSON NULL,
            after_data JSON NULL,
            undone_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT product_revisions_staff_fk FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL,
            INDEX product_revisions_staff_idx (staff_id, undone_at, id)
        ) ENGINE=InnoDB'
    );

    fwrite(STDOUT, "Product CRUD migration complete. Existing records were preserved.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Product CRUD migration failed: {$error->getMessage()}\n");
    exit(1);
}
