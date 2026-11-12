<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $columnType = static function (string $table, string $column) use ($pdo): ?string {
        $statement = $pdo->prepare(
            'SELECT column_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $statement->execute([$table, $column]);
        $type = $statement->fetchColumn();
        return $type === false ? null : strtolower((string)$type);
    };
    $indexExists = $pdo->prepare(
        'SELECT 1 FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
    );

    foreach ([
        ['favorites', 'user_id', 'users', 'id'],
        ['favorites', 'product_id', 'products', 'id'],
    ] as [$table, $column, $referencedTable, $referencedColumn]) {
        $actualType = $columnType($table, $column);
        $expectedType = $columnType($referencedTable, $referencedColumn);
        if ($actualType === null || $actualType !== $expectedType) {
            throw new RuntimeException(
                "The favorites.$column type ($actualType) must match $referencedTable.$referencedColumn ($expectedType)."
            );
        }
    }

    $pdo->exec(
        'UPDATE favorites f
         JOIN products p ON p.title = f.product_title
         SET f.product_id = p.id
         WHERE f.product_id IS NULL'
    );
    $pdo->exec(
        'DELETE older FROM favorites older
         JOIN favorites newer
           ON newer.user_id = older.user_id
          AND newer.product_id = older.product_id
          AND older.product_id IS NOT NULL
          AND (
              older.created_at < newer.created_at
              OR (older.created_at = newer.created_at AND older.product_title > newer.product_title)
          )'
    );

    $indexExists->execute(['favorites', 'favorites_user_product_unique']);
    if (!$indexExists->fetchColumn()) {
        $pdo->exec(
            'ALTER TABLE favorites
             ADD UNIQUE KEY favorites_user_product_unique (user_id, product_id)'
        );
    }
};
