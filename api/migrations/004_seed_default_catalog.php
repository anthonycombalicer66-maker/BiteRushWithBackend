<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $count = (int)$pdo->query('SELECT COUNT(*) FROM products')->fetchColumn();
    if ($count === 0) {
        $catalogPath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR
            . 'SearchResults' . DIRECTORY_SEPARATOR . 'search-results-data.js';
        $catalogSource = file_get_contents($catalogPath);
        if ($catalogSource === false) {
            throw new RuntimeException('Unable to read the default BiteRush catalog.');
        }
        $prefix = 'window.BITERUSH_DISHES = ';
        if (!str_starts_with($catalogSource, $prefix)) {
            throw new RuntimeException('The default BiteRush catalog has an unexpected format.');
        }
        $catalogJson = rtrim(substr($catalogSource, strlen($prefix)), ";\r\n\t ");
        $dishes = json_decode($catalogJson, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($dishes) || !array_is_list($dishes)) {
            throw new RuntimeException('The default BiteRush catalog is invalid.');
        }

        $insert = $pdo->prepare(
            'INSERT INTO products
             (title, source_key, category, description, image, price, available, deleted)
             VALUES (?, ?, ?, ?, ?, ?, TRUE, FALSE)'
        );
        $seenTitles = [];
        foreach ($dishes as $dish) {
            if (!is_array($dish)) {
                throw new RuntimeException('A default BiteRush dish is invalid.');
            }
            $title = trim((string)($dish['title'] ?? ''));
            $key = mb_strtolower($title, 'UTF-8');
            $priceText = (string)($dish['price'] ?? '');
            if ($title === '' || mb_strlen($title) > 120
                || !preg_match('/(\d+(?:\.\d+)?)\s*$/', $priceText, $priceMatch)) {
                throw new RuntimeException('A default BiteRush dish has invalid catalog data.');
            }
            if (isset($seenTitles[$key])) {
                continue;
            }
            $category = trim((string)($dish['category'] ?? $dish['menu'] ?? 'Menu'));
            $description = trim((string)($dish['description'] ?? ''));
            $image = trim((string)($dish['image'] ?? ''));
            if ($category === '' || mb_strlen($category) > 50 || mb_strlen($description) > 500) {
                throw new RuntimeException("The default BiteRush dish \"$title\" has invalid text fields.");
            }

            $insert->execute([
                $title,
                $key,
                $category,
                $description,
                $image,
                (float)$priceMatch[1],
            ]);
            $seenTitles[$key] = true;
        }
    }

    foreach ([
        ['favorites', 'product_title'],
        ['cart_items', 'title'],
        ['order_items', 'title'],
    ] as [$table, $titleColumn]) {
        $pdo->exec(
            "UPDATE `$table` AS saved
             JOIN products AS product ON LOWER(product.title) = LOWER(saved.`$titleColumn`)
             SET saved.product_id = product.id
             WHERE saved.product_id IS NULL"
        );
    }
};
