<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Missing api/config.php. Configure MySQL before running migrations.\n");
    exit(1);
}

$config = require $configPath;
try {
    $pdo = new PDO($config['dsn'], $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (
            version VARCHAR(120) NOT NULL PRIMARY KEY,
            applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB'
    );

    $files = glob(__DIR__ . '/migrations/*.php');
    if ($files === false) {
        throw new RuntimeException('Unable to list migration files.');
    }
    sort($files, SORT_STRING);
    $hasMigration = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
    $recordMigration = $pdo->prepare('INSERT INTO schema_migrations (version) VALUES (?)');

    foreach ($files as $file) {
        $version = basename($file, '.php');
        $hasMigration->execute([$version]);
        if ($hasMigration->fetchColumn()) {
            continue;
        }
        $migration = require $file;
        if (!is_callable($migration)) {
            throw new RuntimeException("Migration $version must return a callable.");
        }
        if (!$pdo->inTransaction()) {
            $pdo->beginTransaction();
        }
        $migration($pdo);
        $recordMigration->execute([$version]);
        if ($pdo->inTransaction()) {
            $pdo->commit();
        }
        fwrite(STDOUT, "Applied $version.\n");
    }
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "Migration failed: {$error->getMessage()}\n");
    exit(1);
}

