CREATE DATABASE IF NOT EXISTS biterush
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE biterush;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(80) NOT NULL,
    username VARCHAR(24) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    profile_image MEDIUMTEXT NULL,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS staff (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    role ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
    password_hash VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(120) NOT NULL UNIQUE,
    source_key VARCHAR(120) NOT NULL,
    sku VARCHAR(40) NULL,
    category VARCHAR(50) NOT NULL DEFAULT 'Menu',
    description VARCHAR(500) NOT NULL DEFAULT '',
    image MEDIUMTEXT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    stock INT UNSIGNED NULL,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    deleted BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSON NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT products_sku_unique UNIQUE (sku),
    CONSTRAINT products_source_key_unique UNIQUE (source_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_revisions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_id BIGINT UNSIGNED NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    before_data JSON NULL,
    after_data JSON NULL,
    undone_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT product_revisions_staff_fk FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE SET NULL,
    INDEX product_revisions_staff_idx (staff_id, undone_at, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS favorites (
    user_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NULL,
    product_title VARCHAR(120) NOT NULL,
    image MEDIUMTEXT NOT NULL,
    product_path VARCHAR(1000) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, product_title),
    UNIQUE KEY favorites_user_product_unique (user_id, product_id),
    CONSTRAINT favorites_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT favorites_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS carts (
    user_id BIGINT UNSIGNED PRIMARY KEY,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT carts_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    item_key VARCHAR(512) NOT NULL,
    product_id BIGINT UNSIGNED NULL,
    title VARCHAR(120) NOT NULL,
    review_title VARCHAR(120) NOT NULL DEFAULT '',
    image MEDIUMTEXT NOT NULL,
    product_path VARCHAR(1000) NOT NULL DEFAULT '',
    instructions VARCHAR(500) NOT NULL DEFAULT '',
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT cart_items_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX cart_items_user_idx (user_id),
    CONSTRAINT cart_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(40) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NOT NULL,
    status ENUM('received', 'preparing', 'on_the_way', 'delivered', 'cancelled') NOT NULL DEFAULT 'received',
    subtotal DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) NOT NULL DEFAULT 0,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    service_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
    tip DECIMAL(10,2) NOT NULL DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    delivery_label VARCHAR(40) NOT NULL DEFAULT 'Standard',
    eta VARCHAR(80) NOT NULL DEFAULT '',
    eta_at DATETIME NULL,
    address VARCHAR(1000) NOT NULL,
    instructions VARCHAR(1000) NOT NULL DEFAULT '',
    payment VARCHAR(80) NOT NULL DEFAULT 'Cash',
    cancellation_reason VARCHAR(500) NULL,
    estimated_delivery DATETIME NULL,
    assigned_staff VARCHAR(80) NULL,
    refund_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    confirmed_delivered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT NULL,
    CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX orders_created_idx (created_at),
    INDEX orders_created_id_idx (created_at, id),
    INDEX orders_status_idx (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NULL,
    title VARCHAR(120) NOT NULL,
    review_title VARCHAR(120) NOT NULL,
    image MEDIUMTEXT NOT NULL,
    product_path VARCHAR(1000) NOT NULL DEFAULT '',
    instructions VARCHAR(500) NOT NULL DEFAULT '',
    unit_price DECIMAL(10,2) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX order_items_order_idx (order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS checkout_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL,
    order_id BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT checkout_requests_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT checkout_requests_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    UNIQUE KEY checkout_requests_user_key_unique (user_id, idempotency_key),
    INDEX checkout_requests_created_idx (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS feedback (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    product_title VARCHAR(120) NULL,
    product_path VARCHAR(1000) NOT NULL DEFAULT '',
    food_rating TINYINT UNSIGNED NULL,
    delivery_rating TINYINT UNSIGNED NULL,
    comment VARCHAR(500) NOT NULL DEFAULT '',
    admin_response VARCHAR(500) NOT NULL DEFAULT '',
    response_at TIMESTAMP NULL DEFAULT NULL,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT feedback_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT feedback_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE KEY feedback_order_product_unique (order_id, product_title),
    INDEX feedback_product_idx (product_title)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_id BIGINT UNSIGNED NULL,
    actor_type ENUM('user', 'staff', 'system') NOT NULL DEFAULT 'system',
    actor VARCHAR(80) NOT NULL,
    role VARCHAR(20) NOT NULL,
    action VARCHAR(80) NOT NULL,
    entity VARCHAR(120) NOT NULL,
    details VARCHAR(500) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX audit_created_idx (created_at, id),
    INDEX audit_actor_created_idx (actor_type, actor_id, created_at),
    INDEX audit_entity_action_role_idx (entity, action, role),
    INDEX audit_action_created_idx (action, created_at, id)
) ENGINE=InnoDB;
