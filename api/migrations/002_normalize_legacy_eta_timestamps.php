<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $orders = $pdo->query('SELECT id, eta_at FROM orders WHERE eta_at IS NOT NULL')->fetchAll();
    $update = $pdo->prepare('UPDATE orders SET eta_at = ? WHERE id = ?');
    $berlin = new DateTimeZone('Europe/Berlin');
    $utc = new DateTimeZone('UTC');

    foreach ($orders as $order) {
        $normalized = (new DateTimeImmutable($order['eta_at'], $berlin))
            ->setTimezone($utc)
            ->format('Y-m-d H:i:s');
        $update->execute([$normalized, $order['id']]);
    }
};
