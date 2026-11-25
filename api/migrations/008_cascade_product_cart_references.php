<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $constraints = [
        'favorites' => 'favorites_product_fk',
        'cart_items' => 'cart_items_product_fk',
    ];
    $findRule = $pdo->prepare(
        'SELECT delete_rule FROM information_schema.referential_constraints
         WHERE constraint_schema = DATABASE() AND table_name = ? AND constraint_name = ?'
    );

    foreach ($constraints as $table => $constraint) {
        $findRule->execute([$table, $constraint]);
        $deleteRule = $findRule->fetchColumn();
        if ($deleteRule !== false && strtoupper((string)$deleteRule) === 'CASCADE') {
            continue;
        }
        if ($deleteRule !== false) {
            $pdo->exec("ALTER TABLE `$table` DROP FOREIGN KEY `$constraint`");
        }
        $pdo->exec(
            "ALTER TABLE `$table` ADD CONSTRAINT `$constraint`
             FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE"
        );
    }
};
