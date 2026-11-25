<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $pdo->exec('UPDATE products SET stock = 100 WHERE stock IS NULL');
};
