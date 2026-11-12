<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

if ($argc !== 4 || !in_array($argv[3], ['admin', 'staff'], true)) {
    fwrite(STDERR, "Usage: php api/create-staff.php <username> <display-name> <admin|staff>\n");
    exit(1);
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    fwrite(STDERR, "Missing api/config.php. Copy api/config.example.php and configure MySQL first.\n");
    exit(1);
}

$username = strtolower(trim($argv[1]));
$displayName = trim($argv[2]);
if (!preg_match('/^[a-z0-9_.-]{3,64}$/', $username) || $displayName === '' || strlen($displayName) > 80) {
    fwrite(STDERR, "Username must be 3–64 letters, numbers, periods, underscores, or hyphens; display name is required.\n");
    exit(1);
}

fwrite(STDOUT, "Choose a strong password: ");
$password = trim((string)fgets(STDIN));
if (strlen($password) < 12 || strlen($password) > 128) {
    fwrite(STDERR, "\nPassword must be between 12 and 128 characters.\n");
    exit(1);
}

$config = require $configPath;
try {
    $pdo = new PDO($config['dsn'], $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $statement = $pdo->prepare(
        'INSERT INTO staff (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)'
    );
    $statement->execute([$username, $displayName, $argv[3], password_hash($password, PASSWORD_DEFAULT)]);
    fwrite(STDOUT, "Staff login created for $username.\n");
} catch (PDOException $error) {
    fwrite(STDERR, "Could not create staff login: {$error->getMessage()}\n");
    exit(1);
}
