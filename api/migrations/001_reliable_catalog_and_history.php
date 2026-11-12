<?php
declare(strict_types=1);

return static function (PDO $pdo): void {
    $columnExists = static function (string $table, string $column) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $statement->execute([$table, $column]);
        return (bool)$statement->fetchColumn();
    };
    $indexExists = static function (string $table, string $index) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?'
        );
        $statement->execute([$table, $index]);
        return (bool)$statement->fetchColumn();
    };
    $foreignKeyExists = static function (string $table, string $name) use ($pdo): bool {
        $statement = $pdo->prepare(
            'SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_schema = DATABASE() AND table_name = ?
               AND constraint_name = ? AND constraint_type = "FOREIGN KEY"'
        );
        $statement->execute([$table, $name]);
        return (bool)$statement->fetchColumn();
    };
    $ensureColumn = static function (string $table, string $column, string $definition) use ($pdo, $columnExists): void {
        if (!$columnExists($table, $column)) {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
        }
    };
    $ensureIndex = static function (string $table, string $index, string $definition) use ($pdo, $indexExists): void {
        if (!$indexExists($table, $index)) {
            $pdo->exec("ALTER TABLE `$table` ADD INDEX `$index` $definition");
        }
    };
    $ensureForeignKey = static function (
        string $table,
        string $name,
        string $column,
        string $referencedTable,
        string $deleteRule
    ) use ($pdo, $foreignKeyExists): void {
        if (!$foreignKeyExists($table, $name)) {
            $pdo->exec(
                "ALTER TABLE `$table` ADD CONSTRAINT `$name` FOREIGN KEY (`$column`)
                 REFERENCES `$referencedTable` (`id`) ON DELETE $deleteRule"
            );
        }
    };

    $ensureColumn('users', 'deleted_at', 'TIMESTAMP NULL DEFAULT NULL');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS products (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(120) NOT NULL,
            source_key VARCHAR(120) NULL,
            sku VARCHAR(40) NULL,
            category VARCHAR(50) NOT NULL DEFAULT "Menu",
            description VARCHAR(500) NOT NULL DEFAULT "",
            image MEDIUMTEXT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0,
            stock INT UNSIGNED NULL,
            available BOOLEAN NOT NULL DEFAULT TRUE,
            deleted BOOLEAN NOT NULL DEFAULT FALSE,
            metadata JSON NULL,
            updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
            UNIQUE KEY products_title_unique (title),
            UNIQUE KEY products_source_key_unique (source_key),
            UNIQUE KEY products_sku_unique (sku)
        ) ENGINE=InnoDB'
    );
    $ensureColumn('products', 'title', "VARCHAR(120) NOT NULL DEFAULT ''");
    $ensureColumn('products', 'source_key', 'VARCHAR(120) NULL');
    $ensureColumn('products', 'sku', 'VARCHAR(40) NULL');
    $ensureColumn('products', 'category', 'VARCHAR(50) NOT NULL DEFAULT "Menu"');
    $ensureColumn('products', 'description', "VARCHAR(500) NOT NULL DEFAULT ''");
    $ensureColumn('products', 'image', 'MEDIUMTEXT NULL');
    $ensureColumn('products', 'price', 'DECIMAL(10,2) NOT NULL DEFAULT 0');
    $ensureColumn('products', 'stock', 'INT UNSIGNED NULL');
    $ensureColumn('products', 'available', 'BOOLEAN NOT NULL DEFAULT TRUE');
    $ensureColumn('products', 'deleted', 'BOOLEAN NOT NULL DEFAULT FALSE');
    $ensureColumn('products', 'metadata', 'JSON NULL');
    $ensureColumn(
        'products',
        'updated_at',
        'TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'
    );
    $pdo->exec("UPDATE products SET source_key = CONCAT('legacy-', id) WHERE source_key IS NULL OR source_key = ''");
    $pdo->exec("UPDATE products SET image = '' WHERE image IS NULL");
    $pdo->exec('ALTER TABLE products MODIFY source_key VARCHAR(120) NOT NULL');
    $pdo->exec('ALTER TABLE products MODIFY image MEDIUMTEXT NOT NULL');
    if (!$indexExists('products', 'products_source_key_unique')) {
        $pdo->exec('ALTER TABLE products ADD CONSTRAINT products_source_key_unique UNIQUE (source_key)');
    }
    if (!$indexExists('products', 'products_sku_unique')) {
        $pdo->exec('ALTER TABLE products ADD CONSTRAINT products_sku_unique UNIQUE (sku)');
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

    foreach (['favorites', 'cart_items', 'order_items'] as $table) {
        $ensureColumn($table, 'product_id', 'BIGINT UNSIGNED NULL');
    }
    foreach ([
        ['favorites', 'favorites_product_fk', 'products'],
        ['cart_items', 'cart_items_product_fk', 'products'],
        ['order_items', 'order_items_product_fk', 'products'],
    ] as [$table, $key, $referencedTable]) {
        $ensureForeignKey($table, $key, 'product_id', $referencedTable, 'SET NULL');
    }
    foreach (['favorites', 'cart_items', 'order_items'] as $table) {
        $pdo->exec("ALTER TABLE `$table` MODIFY image MEDIUMTEXT NOT NULL");
    }
    $ensureIndex('order_items', 'order_items_order_idx', '(order_id)');
    $ensureIndex('orders', 'orders_created_id_idx', '(created_at, id)');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS checkout_requests (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            idempotency_key VARCHAR(64) NOT NULL,
            order_id BIGINT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT checkout_requests_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
            CONSTRAINT checkout_requests_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
            UNIQUE KEY checkout_requests_user_key_unique (user_id, idempotency_key),
            INDEX checkout_requests_created_idx (created_at)
        ) ENGINE=InnoDB'
    );

    $ensureColumn('audit_log', 'actor_id', 'BIGINT UNSIGNED NULL');
    $ensureColumn('audit_log', 'actor_type', "ENUM('user', 'staff', 'system') NOT NULL DEFAULT 'system'");
    $pdo->exec(
        'UPDATE audit_log SET actor_type = CASE
            WHEN role IN ("admin", "staff") THEN "staff"
            WHEN role IN ("user", "customer") THEN "user"
            ELSE "system"
         END WHERE actor_type = "system"'
    );
    $ensureIndex('audit_log', 'audit_created_idx', '(created_at, id)');
    $ensureIndex('audit_log', 'audit_actor_created_idx', '(actor_type, actor_id, created_at)');
    $ensureIndex('audit_log', 'audit_entity_action_role_idx', '(entity, action, role)');
    $ensureIndex('audit_log', 'audit_action_created_idx', '(action, created_at, id)');

    foreach ([
        ['orders', 'orders_user_fk', 'user_id', 'users'],
        ['feedback', 'feedback_user_fk', 'user_id', 'users'],
    ] as [$table, $key, $column, $referencedTable]) {
        $statement = $pdo->prepare(
            'SELECT rc.constraint_name, rc.delete_rule
             FROM information_schema.referential_constraints rc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_schema = rc.constraint_schema
              AND kcu.table_name = rc.table_name
              AND kcu.constraint_name = rc.constraint_name
             WHERE rc.constraint_schema = DATABASE() AND rc.table_name = ?
               AND kcu.column_name = ? AND kcu.referenced_table_name = ?'
        );
        $statement->execute([$table, $column, $referencedTable]);
        $hasRestrict = false;
        foreach ($statement->fetchAll() as $foreignKey) {
            if ($foreignKey['delete_rule'] !== 'RESTRICT') {
                $constraintName = str_replace('`', '``', $foreignKey['constraint_name']);
                $pdo->exec("ALTER TABLE `$table` DROP FOREIGN KEY `$constraintName`");
            } else {
                $hasRestrict = true;
            }
        }
        if (!$hasRestrict) {
            $ensureForeignKey($table, $key, $column, $referencedTable, 'RESTRICT');
        }
    }
};

