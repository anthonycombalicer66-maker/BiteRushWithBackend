<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $statement = $pdo->prepare(
        'SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = "users" AND column_name = "deleted_at"'
    );
    $statement->execute();
    if (!$statement->fetchColumn()) {
        $pdo->exec('ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL');
    }
};
