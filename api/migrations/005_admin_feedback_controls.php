<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $ensureColumn = static function (string $column, string $definition) use ($pdo): void {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = "feedback" AND column_name = ?'
        );
        $statement->execute([$column]);
        if (!$statement->fetchColumn()) {
            $pdo->exec("ALTER TABLE feedback ADD COLUMN `$column` $definition");
        }
    };

    $ensureColumn('admin_response', "VARCHAR(500) NOT NULL DEFAULT ''");
    $ensureColumn('response_at', 'TIMESTAMP NULL DEFAULT NULL');
    $ensureColumn('hidden', 'BOOLEAN NOT NULL DEFAULT FALSE');
};
