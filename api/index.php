<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
date_default_timezone_set('UTC');

$isHttps = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
$requestedAction = (string)($_GET['action'] ?? '');
$requestMethod = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$staffActions = ['order-status', 'product', 'product-undo', 'audit'];
$isStaffRequest = str_starts_with($requestedAction, 'staff-')
    || str_starts_with($requestedAction, 'admin-')
    || in_array($requestedAction, $staffActions, true)
    || ($requestedAction === 'products' && $requestMethod !== 'GET');
session_name($isStaffRequest ? 'BRSTAFFSESSID' : 'BRUSERSESSID');
session_set_cookie_params([
    'httponly' => true,
    'secure' => $isHttps,
    'samesite' => 'Lax',
]);
session_start();

function respond(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_data(): array
{
    try {
        $data = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        respond(400, ['error' => 'Invalid JSON request.']);
    }
    if (!is_array($data)) {
        respond(400, ['error' => 'A JSON object is required.']);
    }
    return $data;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $configPath = __DIR__ . '/config.php';
    if (!is_file($configPath)) {
        respond(500, ['error' => 'Database is not configured. Copy api/config.example.php to api/config.php and set your MySQL credentials.']);
    }
    $config = require $configPath;
    try {
        $pdo = new PDO($config['dsn'], $config['username'], $config['password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    } catch (PDOException $error) {
        error_log($error->getMessage());
        respond(500, ['error' => 'Could not connect to MySQL. Check api/config.php and XAMPP MySQL.']);
    }
    return $pdo;
}

function retry_transaction(PDO $pdo, callable $operation, int $attempts = 3): mixed
{
    for ($attempt = 1; $attempt <= $attempts; $attempt++) {
        try {
            $pdo->beginTransaction();
            $result = $operation();
            $pdo->commit();
            return $result;
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            $driverError = (int)($error->errorInfo[1] ?? 0);
            if (!in_array($driverError, [1205, 1213], true) || $attempt === $attempts) {
                throw $error;
            }
            usleep(random_int(25000, 75000) * $attempt);
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    throw new LogicException('The database transaction could not be completed.');
}

function current_user(bool $requireAccountContext = false): array
{
    if (empty($_SESSION['user'])) {
        respond(401, ['error' => 'Please sign in to continue.']);
    }
    $expectedUserId = $_SERVER['HTTP_X_BITERUSH_ACCOUNT'] ?? '';
    if ($expectedUserId === '' && $requireAccountContext) {
        respond(409, [
            'error' => 'Refresh this page before changing account data.',
            'code' => 'account_context_missing',
        ]);
    }
    if ($expectedUserId !== ''
        && (!ctype_digit($expectedUserId) || (int)$expectedUserId !== (int)$_SESSION['user']['id'])) {
        respond(409, [
            'error' => 'Your account changed in another tab. Refresh this page before continuing.',
            'code' => 'account_context_changed',
        ]);
    }
    $statement = db()->prepare('SELECT deleted_at FROM users WHERE id = ?');
    $statement->execute([$_SESSION['user']['id']]);
    $deletedAt = $statement->fetchColumn();
    if ($deletedAt === false || $deletedAt !== null) {
        unset($_SESSION['user']);
        respond(401, ['error' => 'This account is no longer active.']);
    }
    return $_SESSION['user'];
}

function require_staff(array $roles = ['admin', 'staff']): array
{
    $actor = $_SESSION['staff'] ?? null;
    $role = is_array($actor) ? strtolower(trim((string)($actor['role'] ?? ''))) : '';
    if (!is_array($actor) || !in_array($role, $roles, true)) {
        respond(403, ['error' => 'You do not have permission to perform this action.']);
    }
    $actor['role'] = $role;
    return $actor;
}

function clean_text(mixed $value, int $maxLength, string $label, bool $required = false): string
{
    if (!is_string($value)) {
        if ($required) {
            respond(400, ['error' => "$label is required."]);
        }
        return '';
    }
    $value = trim($value);
    if (($required && $value === '') || mb_strlen($value) > $maxLength) {
        respond(400, ['error' => "$label is required and must be at most $maxLength characters."]);
    }
    return $value;
}

function clean_image(mixed $value, string $label = 'Image'): string
{
    $value = clean_text($value, 1100000, $label);
    if ($value === '') {
        return '';
    }
    if (str_starts_with($value, 'data:')) {
        if (!preg_match('/\Adata:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+\/=]+)\z/i', $value, $match)
            || strlen($match[1]) > 1049000) {
            respond(400, ['error' => "$label must be a supported image smaller than 750 KB."]);
        }
        $decodedImage = base64_decode($match[1], true);
        if ($decodedImage === false || strlen($decodedImage) > 768000) {
            respond(400, ['error' => "$label must be a supported image smaller than 750 KB."]);
        }
        return $value;
    }
    $scheme = parse_url($value, PHP_URL_SCHEME);
    if (($scheme !== null && !in_array(strtolower($scheme), ['http', 'https'], true))
        || str_starts_with($value, '//')) {
        respond(400, ['error' => "$label must use a relative path, HTTP, or HTTPS URL."]);
    }
    return $value;
}

function nullable_product_id(mixed $value): ?int
{
    if ($value === null || $value === '') {
        return null;
    }
    $id = filter_var($value, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        respond(400, ['error' => 'A product ID is invalid.']);
    }
    return $id;
}

function validate_product(array $product): array
{
    $title = clean_text($product['title'] ?? null, 120, 'Dish name', true);
    $category = clean_text($product['category'] ?? 'Menu', 50, 'Category', true);
    $description = clean_text($product['description'] ?? '', 500, 'Description');
    $image = clean_image($product['image'] ?? '');
    $price = $product['price'] ?? null;
    if (!is_numeric($price) || !is_finite((float)$price) || (float)$price <= 0 || (float)$price > 100000) {
        respond(400, ['error' => 'Price must be greater than zero and at most 100000.']);
    }

    $stockValue = $product['stock'] ?? null;
    $stock = null;
    if ($stockValue !== null && $stockValue !== '') {
        $stock = filter_var($stockValue, FILTER_VALIDATE_INT);
        if ($stock === false || $stock < 0 || $stock > 4294967295) {
            respond(400, ['error' => 'Stock must be a non-negative whole number.']);
        }
    }

    $metadata = $product['metadata'] ?? [];
    if (!is_array($metadata) || ($metadata !== [] && array_is_list($metadata))) {
        respond(400, ['error' => 'Product metadata must be an object.']);
    }
    $metadataFields = [
        'prepTime', 'barcode', 'cost', 'lowStockThreshold', 'lifecycle', 'featured',
        'allergens', 'tags', 'variants', 'addons', 'notes', 'scheduleStart', 'scheduleEnd',
    ];
    $metadata = array_intersect_key($metadata, array_fill_keys($metadataFields, true));
    if (isset($metadata['featured']) && !is_bool($metadata['featured'])) {
        respond(400, ['error' => 'Featured must be a boolean.']);
    }
    foreach ($metadataFields as $field) {
        if (array_key_exists($field, $product) && !array_key_exists($field, $metadata)) {
            $metadata[$field] = $product[$field];
        }
    }
    foreach (['prepTime', 'lowStockThreshold'] as $field) {
        if (!isset($metadata[$field]) || $metadata[$field] === '') {
            continue;
        }
        $value = filter_var($metadata[$field], FILTER_VALIDATE_INT);
        if ($value === false || $value < 0 || $value > 100000) {
            respond(400, ['error' => "$field must be a non-negative whole number."]);
        }
        $metadata[$field] = $value;
    }
    if (isset($metadata['cost']) && $metadata['cost'] !== '') {
        if (!is_numeric($metadata['cost']) || !is_finite((float)$metadata['cost'])
            || (float)$metadata['cost'] < 0 || (float)$metadata['cost'] > 100000) {
            respond(400, ['error' => 'Cost must be a non-negative amount.']);
        }
        $metadata['cost'] = (float)$metadata['cost'];
    }
    foreach ([
        'barcode' => 60,
        'lifecycle' => 20,
        'allergens' => 180,
        'tags' => 180,
        'notes' => 300,
        'scheduleStart' => 32,
        'scheduleEnd' => 32,
    ] as $field => $limit) {
        if (!array_key_exists($field, $metadata)) {
            continue;
        }
        $metadata[$field] = clean_text($metadata[$field], $limit, $field);
        if ($field === 'lifecycle' && $metadata[$field] !== ''
            && !in_array($metadata[$field], ['active', 'draft', 'archived', 'discontinued'], true)) {
            respond(400, ['error' => 'Lifecycle state is invalid.']);
        }
    }
    foreach (['scheduleStart', 'scheduleEnd'] as $field) {
        if (!empty($metadata[$field]) && strtotime($metadata[$field]) === false) {
            respond(400, ['error' => "$field must be a valid date and time."]);
        }
    }
    if (!empty($metadata['scheduleStart']) && !empty($metadata['scheduleEnd'])
        && strtotime($metadata['scheduleEnd']) <= strtotime($metadata['scheduleStart'])) {
        respond(400, ['error' => 'Scheduled end must be after scheduled start.']);
    }
    foreach (['variants', 'addons'] as $field) {
        if (!array_key_exists($field, $metadata)) {
            continue;
        }
        if (!is_array($metadata[$field]) || count($metadata[$field]) > 50) {
            respond(400, ['error' => "$field must contain at most 50 entries."]);
        }
        foreach ($metadata[$field] as &$option) {
            if (!is_array($option)) {
                respond(400, ['error' => "A $field entry is invalid."]);
            }
            $name = clean_text($option['name'] ?? null, 80, 'Option name', true);
            $optionPrice = $option['price'] ?? 0;
            if (!is_numeric($optionPrice) || !is_finite((float)$optionPrice)
                || (float)$optionPrice < 0 || (float)$optionPrice > 100000) {
                respond(400, ['error' => "A $field price is invalid."]);
            }
            $option = ['name' => $name, 'price' => (float)$optionPrice];
        }
        unset($option);
    }

    $sku = clean_text($product['sku'] ?? '', 40, 'SKU');
    $sourceKey = clean_text($product['sourceKey'] ?? '', 120, 'Product source key');
    foreach (['available', 'deleted'] as $field) {
        if (isset($product[$field]) && !is_bool($product[$field])) {
            respond(400, ['error' => "$field must be a boolean."]);
        }
    }
    $expectedUpdatedAt = $product['expectedUpdatedAt'] ?? null;
    if ($expectedUpdatedAt !== null
        && (!is_string($expectedUpdatedAt) || strlen($expectedUpdatedAt) > 32)) {
        respond(400, ['error' => 'The product version is invalid. Reload the menu and retry.']);
    }
    return [
        'id' => $product['id'] ?? null,
        'expectedUpdatedAt' => $expectedUpdatedAt,
        'sourceKey' => $sourceKey !== '' ? $sourceKey : mb_strtolower($title),
        'title' => $title,
        'sku' => $sku !== '' ? $sku : null,
        'category' => $category,
        'description' => $description,
        'image' => $image,
        'price' => (float)$price,
        'stock' => $stock,
        'available' => filter_var($product['available'] ?? false, FILTER_VALIDATE_BOOLEAN),
        'deleted' => filter_var($product['deleted'] ?? false, FILTER_VALIDATE_BOOLEAN),
        'metadata' => $metadata,
    ];
}

function canonical_value(mixed $value): mixed
{
    if (is_object($value)) {
        $value = get_object_vars($value);
    }
    if (!is_array($value)) {
        return $value;
    }
    if (!array_is_list($value)) {
        ksort($value);
    }
    foreach ($value as &$item) {
        $item = canonical_value($item);
    }
    unset($item);
    return $value;
}

function product_fields(array $row): array
{
    $metadata = json_decode((string)($row['metadata'] ?? '{}'), true);
    if (!is_array($metadata)) {
        $metadata = [];
    }
    return [
        'id' => (int)$row['id'],
        'title' => $row['title'],
        'sourceKey' => $row['source_key'] ?? '',
        'sku' => $row['sku'] ?? '',
        'category' => $row['category'],
        'description' => $row['description'],
        'image' => $row['image'],
        'price' => (float)$row['price'],
        'stock' => $row['stock'] === null ? null : (int)$row['stock'],
        'available' => (bool)$row['available'],
        'deleted' => (bool)$row['deleted'],
        'metadata' => (object)$metadata,
        ...$metadata,
        'updatedAt' => $row['updated_at'],
    ];
}

function log_action(array $actor, string $action, string $entity, string $details = ''): void
{
    $role = $actor['role'] ?? 'user';
    $actorType = $role === 'admin' || $role === 'staff' ? 'staff' : 'user';
    $statement = db()->prepare(
        'INSERT INTO audit_log (actor_id, actor_type, actor, role, action, entity, details)
         VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        isset($actor['id']) ? (int)$actor['id'] : null,
        $actorType,
        $actor['name'] ?? $actor['display_name'] ?? $actor['fullname'] ?? $actor['username'] ?? 'Unknown',
        $role,
        $action,
        $entity,
        mb_substr($details, 0, 500),
    ]);
}

function utc_iso(?string $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return (new DateTimeImmutable($value, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
}

function checkout_receipt(PDO $pdo, int $orderId, int $userId): array
{
    $statement = $pdo->prepare(
        'SELECT order_number, status, subtotal, discount, delivery_fee, service_fee, tip, total,
                delivery_label, eta, eta_at, address, instructions, payment, created_at
         FROM orders WHERE id = ? AND user_id = ?'
    );
    $statement->execute([$orderId, $userId]);
    $order = $statement->fetch();
    if (!$order) {
        respond(500, ['error' => 'The saved checkout request has no matching order.']);
    }

    $itemsStatement = $pdo->prepare(
        'SELECT product_id, title, review_title, image, product_path, instructions, unit_price, quantity
         FROM order_items WHERE order_id = ? ORDER BY id'
    );
    $itemsStatement->execute([$orderId]);
    $items = array_map(static fn(array $item): array => [
        'productId' => $item['product_id'] === null ? null : (int)$item['product_id'],
        'title' => $item['title'],
        'reviewTitle' => $item['review_title'],
        'price' => (float)$item['unit_price'],
        'quantity' => (int)$item['quantity'],
        'instructions' => $item['instructions'],
        'img' => $item['image'],
        'link' => $item['product_path'],
    ], $itemsStatement->fetchAll());

    return [
        'id' => $order['order_number'],
        'createdAt' => utc_iso($order['created_at']),
        'status' => $order['status'],
        'items' => $items,
        'subtotal' => (float)$order['subtotal'],
        'discount' => (float)$order['discount'],
        'deliveryFee' => (float)$order['delivery_fee'],
        'serviceFee' => (float)$order['service_fee'],
        'tip' => (float)$order['tip'],
        'total' => (float)$order['total'],
        'deliveryLabel' => $order['delivery_label'],
        'eta' => $order['eta'],
        'etaAt' => utc_iso($order['eta_at']),
        'address' => $order['address'],
        'instructions' => $order['instructions'],
        'payment' => $order['payment'],
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
$data = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? request_data() : [];
$pdo = db();

try {
    if ($method === 'POST' && $action === 'signup') {
        $fullname = clean_text($data['fullname'] ?? null, 80, 'Full name', true);
        $username = strtolower(clean_text($data['username'] ?? null, 24, 'Username', true));
        $email = strtolower(clean_text($data['email'] ?? null, 254, 'Email', true));
        $password = $data['password'] ?? '';
        if (!preg_match('/^[a-z0-9_.]{3,24}$/', $username)
            || !filter_var($email, FILTER_VALIDATE_EMAIL)
            || !is_string($password) || strlen($password) < 8 || strlen($password) > 128) {
            respond(400, ['error' => 'Check the name, username, email, and password.']);
        }
        $statement = $pdo->prepare(
            'INSERT INTO users (fullname, username, email, password_hash) VALUES (?, ?, ?, ?)'
        );
        $statement->execute([$fullname, $username, $email, password_hash($password, PASSWORD_DEFAULT)]);
        session_regenerate_id(true);
        unset($_SESSION['staff']);
        $_SESSION['user'] = [
            'id' => (int)$pdo->lastInsertId(),
            'fullname' => $fullname,
            'username' => $username,
            'email' => $email,
            'profileImage' => null,
        ];
        respond(201, ['user' => $_SESSION['user']]);
    }

    if ($method === 'POST' && $action === 'login') {
        $identity = strtolower(clean_text($data['identity'] ?? null, 254, 'Username or email', true));
        $password = $data['password'] ?? '';
        $statement = $pdo->prepare(
            'SELECT id, fullname, username, email, password_hash, profile_image
             FROM users WHERE deleted_at IS NULL AND (email = ? OR username = ?) LIMIT 1'
        );
        $statement->execute([$identity, $identity]);
        $user = $statement->fetch();
        if (!$user || !is_string($password) || !password_verify($password, $user['password_hash'])) {
            respond(401, ['error' => 'Username/email or password is incorrect.']);
        }
        session_regenerate_id(true);
        unset($_SESSION['staff']);
        $_SESSION['user'] = [
            'id' => (int)$user['id'],
            'fullname' => $user['fullname'],
            'username' => $user['username'],
            'email' => $user['email'],
            'profileImage' => $user['profile_image'],
        ];
        respond(200, ['user' => $_SESSION['user']]);
    }

    if ($method === 'POST' && $action === 'logout') {
        current_user(true);
        $_SESSION = [];
        session_regenerate_id(true);
        respond(200, ['message' => 'Signed out.']);
    }

    if ($method === 'GET' && $action === 'me') {
        respond(200, ['user' => current_user()]);
    }

    if ($method === 'PATCH' && $action === 'profile') {
        $user = current_user(true);
        $fullname = clean_text($data['fullname'] ?? null, 80, 'Full name', true);
        $username = strtolower(clean_text($data['username'] ?? null, 24, 'Username', true));
        $email = strtolower(clean_text($data['email'] ?? null, 254, 'Email', true));
        $image = $data['profileImage'] ?? null;
        if (!preg_match('/^[a-z0-9_.]{3,24}$/', $username) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(400, ['error' => 'Check your username and email address.']);
        }
        if ($image !== null && (!is_string($image) || strlen($image) > 1500000
            || !preg_match('/^(data:image\/(?:png|jpeg|webp|gif);base64,|https?:\/\/|\/)/i', $image))) {
            respond(400, ['error' => 'Choose a supported image under 1.5 MB.']);
        }
        $statement = $pdo->prepare(
            'UPDATE users SET fullname = ?, username = ?, email = ?, profile_image = ? WHERE id = ?'
        );
        $statement->execute([$fullname, $username, $email, $image, $user['id']]);
        $_SESSION['user'] = [
            'id' => $user['id'],
            'fullname' => $fullname,
            'username' => $username,
            'email' => $email,
            'profileImage' => $image,
        ];
        respond(200, ['user' => $_SESSION['user']]);
    }

    if ($method === 'DELETE' && $action === 'account') {
        $user = current_user(true);
        $userId = (int)$user['id'];
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM cart_items WHERE user_id = ?')->execute([$userId]);
        $pdo->prepare('DELETE FROM carts WHERE user_id = ?')->execute([$userId]);
        $pdo->prepare('DELETE FROM favorites WHERE user_id = ?')->execute([$userId]);
        $auditNames = [];
        $otherNameCount = $pdo->prepare(
            'SELECT COUNT(*) FROM users
             WHERE id <> ? AND deleted_at IS NULL AND (fullname = ? OR username = ?)'
        );
        foreach (array_unique([$user['username'], $user['fullname']]) as $name) {
            $otherNameCount->execute([$userId, $name, $name]);
            if ((int)$otherNameCount->fetchColumn() === 0) {
                $auditNames[] = $name;
            }
        }
        if ($auditNames) {
            $placeholders = implode(',', array_fill(0, count($auditNames), '?'));
            $anonymizeAudit = $pdo->prepare(
                "UPDATE audit_log SET actor = 'Deleted account', actor_id = ?, actor_type = 'user'
                 WHERE actor IN ($placeholders) AND role IN ('user', 'customer')"
            );
            $anonymizeAudit->execute([$userId, ...$auditNames]);
        }
        $statement = $pdo->prepare(
            'UPDATE users
             SET fullname = "Deleted account", username = ?, email = ?, password_hash = ?,
                 profile_image = NULL, deleted_at = UTC_TIMESTAMP()
             WHERE id = ? AND deleted_at IS NULL'
        );
        $statement->execute([
            'deleted_' . base_convert((string)$userId, 10, 36),
            'deleted+' . $userId . '@invalid.example',
            password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT),
            $userId,
        ]);
        if ($statement->rowCount() !== 1) {
            $pdo->rollBack();
            respond(409, ['error' => 'The account could not be deactivated.']);
        }
        log_action([
            'id' => $userId,
            'username' => 'Deleted account',
            'role' => 'user',
        ], 'account anonymized', 'account', 'Account deactivated; order and feedback history retained');
        $pdo->commit();
        $_SESSION = [];
        session_regenerate_id(true);
        respond(200, ['message' => 'Account deactivated. Order and feedback history was retained.']);
    }

    if ($action === 'favorites' && $method === 'GET') {
        $user = current_user();
        $statement = $pdo->prepare(
            'SELECT f.product_id AS productId, f.product_title AS title,
                    COALESCE(NULLIF(p.image, ""), f.image) AS img, f.product_path AS path,
                    p.price, p.category, p.description
             FROM favorites f LEFT JOIN products p ON p.id = f.product_id
             WHERE f.user_id = ? ORDER BY f.created_at DESC'
        );
        $statement->execute([$user['id']]);
        respond(200, ['favorites' => $statement->fetchAll()]);
    }

    if ($action === 'favorites' && $method === 'POST') {
        $user = current_user(true);
        $title = clean_text($data['title'] ?? null, 120, 'Dish name', true);
        $productId = nullable_product_id($data['productId'] ?? null);
        if ($productId !== null) {
            $productStatement = $pdo->prepare(
                'SELECT id, title, image FROM products WHERE id = ? AND deleted = FALSE'
            );
            $productStatement->execute([$productId]);
        } else {
            $productStatement = $pdo->prepare(
                'SELECT id, title, image FROM products WHERE title = ? AND deleted = FALSE'
            );
            $productStatement->execute([$title]);
        }
        $product = $productStatement->fetch();
        if (!$product) {
            respond(404, ['error' => 'This dish is not in the active menu.']);
        }
        if ($title !== $product['title']) {
            respond(400, ['error' => 'The dish name does not match the selected menu item.']);
        }
        $image = clean_image($data['img'] ?? $product['image'], 'Dish image');
        $path = clean_text($data['path'] ?? '', 1000, 'Dish path');
        $statement = $pdo->prepare(
            'INSERT INTO favorites (user_id, product_id, product_title, image, product_path)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE product_id = VALUES(product_id),
                 product_title = VALUES(product_title),
                 image = VALUES(image), product_path = VALUES(product_path)'
        );
        $statement->execute([$user['id'], $product['id'], $product['title'], $image, $path]);
        respond(200, ['message' => 'Favorite saved.', 'productId' => (int)$product['id']]);
    }

    if ($action === 'favorites' && $method === 'DELETE') {
        $user = current_user(true);
        $productId = nullable_product_id($data['productId'] ?? null);
        if ($productId === null) {
            $title = clean_text($data['title'] ?? null, 120, 'Dish name', true);
            $productStatement = $pdo->prepare('SELECT id, title FROM products WHERE title = ?');
            $productStatement->execute([$title]);
        } else {
            $productStatement = $pdo->prepare('SELECT id, title FROM products WHERE id = ?');
            $productStatement->execute([$productId]);
        }
        $product = $productStatement->fetch();
        if (!$product) {
            respond(404, ['error' => 'This dish is not in the menu.']);
        }
        $statement = $pdo->prepare(
            'DELETE FROM favorites WHERE user_id = ? AND (product_id = ? OR product_title = ?)'
        );
        $statement->execute([$user['id'], $product['id'], $product['title']]);
        respond(200, ['message' => 'Favorite removed.']);
    }

    if ($action === 'favorites' && $method === 'PUT') {
        $user = current_user(true);
        $items = $data['favorites'] ?? null;
        if (!is_array($items) || count($items) > 200) {
            respond(400, ['error' => 'Favorites must be a list of at most 200 dishes.']);
        }
        $cleanFavorites = [];
        $findProductId = $pdo->prepare('SELECT id FROM products WHERE title = ?');
        foreach ($items as $item) {
            if (!is_array($item)) {
                respond(400, ['error' => 'A favorite is invalid.']);
            }
            $title = clean_text($item['title'] ?? null, 120, 'Dish name', true);
            $findProductId->execute([$title]);
            $cleanFavorites[] = [
                'productId' => $findProductId->fetchColumn() ?: null,
                'title' => $title,
                'image' => clean_image($item['img'] ?? '', 'Dish image'),
                'path' => clean_text($item['path'] ?? '', 1000, 'Dish path'),
            ];
        }
        $insert = $pdo->prepare(
            'INSERT INTO favorites (user_id, product_id, product_title, image, product_path) VALUES (?, ?, ?, ?, ?)'
        );
        retry_transaction($pdo, static function () use ($pdo, $user, $cleanFavorites, $insert): void {
            $pdo->prepare('DELETE FROM favorites WHERE user_id = ?')->execute([$user['id']]);
            foreach ($cleanFavorites as $favorite) {
                $insert->execute([
                    $user['id'],
                    $favorite['productId'],
                    $favorite['title'],
                    $favorite['image'],
                    $favorite['path'],
                ]);
            }
        });
        respond(200, ['message' => 'Favorites saved.']);
    }

    if ($action === 'cart' && $method === 'GET') {
        $user = current_user();
        $statement = $pdo->prepare(
            'SELECT item_key AS `key`, product_id AS productId, title, review_title AS reviewTitle, image AS img,
                    product_path AS link, instructions, unit_price AS price, quantity
             FROM cart_items WHERE user_id = ? ORDER BY id'
        );
        $statement->execute([$user['id']]);
        $items = $statement->fetchAll();
        foreach ($items as &$item) {
            $item['price'] = (float)$item['price'];
            $item['quantity'] = (int)$item['quantity'];
        }
        unset($item);
        respond(200, ['items' => $items]);
    }

    if ($action === 'cart' && $method === 'PUT') {
        $user = current_user(true);
        $items = $data['items'] ?? null;
        if (!is_array($items) || count($items) > 100) {
            respond(400, ['error' => 'Cart must contain at most 100 items.']);
        }
        $cleanItems = [];
        foreach ($items as $item) {
            if (!is_array($item) || !is_string($item['title'] ?? null)
                || !is_numeric($item['quantity'] ?? null)
                || (int)$item['quantity'] < 1 || (int)$item['quantity'] > 99) {
                respond(400, ['error' => 'A cart item is invalid.']);
            }
            $title = clean_text($item['title'], 120, 'Dish name', true);
            $image = clean_image($item['img'] ?? '', 'Dish image');
            $path = clean_text($item['link'] ?? '', 1000, 'Dish path');
            $itemKey = clean_text(
                $item['key'] ?? ($path !== '' ? $path : $title . '|' . $image),
                512,
                'Cart item key',
                true
            );
            $price = $item['price'] ?? null;
            if (!is_numeric($price) || (float)$price < 0 || (float)$price > 100000) {
                respond(400, ['error' => 'A cart item has an invalid price.']);
            }
            $requestedProductId = nullable_product_id($item['productId'] ?? $item['product_id'] ?? null);
            if ($requestedProductId === null) {
                $productLookup = $pdo->prepare('SELECT id FROM products WHERE title = ?');
                $productLookup->execute([$title]);
                $foundProductId = $productLookup->fetchColumn();
                $requestedProductId = $foundProductId === false ? null : (int)$foundProductId;
            }
            $cleanItems[] = [
                'key' => $itemKey,
                'productId' => $requestedProductId,
                'title' => $title,
                'reviewTitle' => clean_text($item['reviewTitle'] ?? $title, 120, 'Dish name'),
                'img' => $image,
                'link' => $path,
                'instructions' => clean_text($item['instructions'] ?? '', 500, 'Item instructions'),
                'price' => (float)$price,
                'quantity' => (int)$item['quantity'],
            ];
        }
        $insert = $pdo->prepare(
            'INSERT INTO cart_items
             (user_id, item_key, product_id, title, review_title, image, product_path, instructions, unit_price, quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        retry_transaction($pdo, static function () use ($pdo, $user, $cleanItems, $insert): void {
            $pdo->prepare('INSERT INTO carts (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)')
                ->execute([$user['id']]);
            $pdo->prepare('DELETE FROM cart_items WHERE user_id = ?')->execute([$user['id']]);
            foreach ($cleanItems as $item) {
                $insert->execute([
                    $user['id'], $item['key'], $item['productId'], $item['title'], $item['reviewTitle'], $item['img'],
                    $item['link'], $item['instructions'], $item['price'], $item['quantity'],
                ]);
            }
        });
        respond(200, ['message' => 'Cart saved.']);
    }

    if ($action === 'orders' && $method === 'GET') {
        $user = current_user();
        $statement = $pdo->prepare(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
        );
        $statement->execute([$user['id']]);
        $orders = $statement->fetchAll();
        $itemsStatement = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ?');
        $feedbackStatement = $pdo->prepare(
            'SELECT product_title AS foodItem, product_path AS foodItemPath, food_rating AS foodRating,
                    delivery_rating AS deliveryRating, comment, created_at AS submittedAt
             FROM feedback WHERE order_id = ?'
        );
        foreach ($orders as &$order) {
            $itemsStatement->execute([$order['id']]);
            $order['items'] = $itemsStatement->fetchAll();
            foreach ($order['items'] as &$item) {
                $item['productId'] = $item['product_id'] === null ? null : (int)$item['product_id'];
                $item['price'] = (float)$item['unit_price'];
                $item['img'] = $item['image'];
                $item['link'] = $item['product_path'];
            }
            unset($item);
            $feedbackStatement->execute([$order['id']]);
            $reviews = $feedbackStatement->fetchAll();
            $order['productReviews'] = array_values(array_filter($reviews, static fn(array $review): bool =>
                $review['foodItem'] !== null && $review['foodRating'] !== null
            ));
            $deliveryRating = array_values(array_filter($reviews, static fn(array $review): bool =>
                $review['deliveryRating'] !== null
            ));
            if ($deliveryRating) {
                $order['feedback'] = ['deliveryRating' => (int)$deliveryRating[0]['deliveryRating']];
            }
            $order['id'] = $order['order_number'];
            foreach (['subtotal', 'discount', 'delivery_fee', 'service_fee', 'tip', 'total', 'refund_amount'] as $field) {
                $order[$field] = (float)$order[$field];
            }
            $order['deliveryFee'] = $order['delivery_fee'];
            $order['serviceFee'] = $order['service_fee'];
            $order['refundAmount'] = $order['refund_amount'];
            $order['createdAt'] = utc_iso($order['created_at']);
            $order['updatedAt'] = utc_iso($order['updated_at']);
            $order['deliveryLabel'] = $order['delivery_label'];
            $order['etaAt'] = utc_iso($order['eta_at']);
            $order['confirmedDelivered'] = (bool)$order['confirmed_delivered'];
            $order['cancellationReason'] = $order['cancellation_reason'];
            $order['estimatedDelivery'] = $order['estimated_delivery'];
            $order['assignedStaff'] = $order['assigned_staff'];
            $order['refundAmount'] = $order['refund_amount'];
        }
        unset($order);
        respond(200, ['orders' => $orders]);
    }

    if ($action === 'orders' && $method === 'POST') {
        $user = current_user(true);
        $idempotencyKey = clean_text($data['idempotencyKey'] ?? null, 64, 'Checkout request key', true);
        if (!preg_match('/^[a-f0-9]{32}$/i', $idempotencyKey)) {
            respond(400, ['error' => 'The checkout request key is invalid. Refresh checkout and try again.']);
        }
        $pdo->beginTransaction();
        $reserveRequest = $pdo->prepare(
            'INSERT INTO checkout_requests (user_id, idempotency_key) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'
        );
        $reserveRequest->execute([$user['id'], $idempotencyKey]);
        $findRequest = $pdo->prepare(
            'SELECT order_id FROM checkout_requests WHERE user_id = ? AND idempotency_key = ? FOR UPDATE'
        );
        $findRequest->execute([$user['id'], $idempotencyKey]);
        $existingOrderId = $findRequest->fetchColumn();
        if ($existingOrderId !== null && $existingOrderId !== false) {
            $pdo->commit();
            respond(200, ['order' => checkout_receipt($pdo, (int)$existingOrderId, (int)$user['id'])]);
        }

        $items = $data['items'] ?? null;
        if (!is_array($items) || count($items) < 1 || count($items) > 100) {
            respond(400, ['error' => 'Your cart must contain between 1 and 100 items.']);
        }
        $cleanItems = [];
        $subtotal = 0.0;
        $stockAdjustments = [];
        $stockTitles = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                respond(400, ['error' => 'A cart item is invalid.']);
            }
            $title = clean_text($item['title'] ?? null, 120, 'Dish name', true);
            $quantity = filter_var($item['quantity'] ?? null, FILTER_VALIDATE_INT);
            $price = $item['price'] ?? null;
            if ($quantity === false || $quantity < 1 || $quantity > 99
                || !is_numeric($price) || (float)$price < 0 || (float)$price > 100000) {
                respond(400, ['error' => 'A cart item has an invalid quantity or price.']);
            }
            $requestedProductId = nullable_product_id($item['productId'] ?? $item['product_id'] ?? null);
            if ($requestedProductId !== null) {
                $product = $pdo->prepare(
                    'SELECT id, title, price, stock, available, deleted FROM products WHERE id = ? FOR UPDATE'
                );
                $product->execute([$requestedProductId]);
            } else {
                $product = $pdo->prepare(
                    'SELECT id, title, price, stock, available, deleted FROM products WHERE title = ? FOR UPDATE'
                );
                $product->execute([$title]);
            }
            $catalogProduct = $product->fetch();
            $productId = null;
            if ($catalogProduct) {
                $productId = (int)$catalogProduct['id'];
                $title = $catalogProduct['title'];
                if (!$catalogProduct['available'] || $catalogProduct['deleted']
                    || ($catalogProduct['stock'] !== null
                        && $quantity > (int)$catalogProduct['stock'] - ($stockAdjustments[$productId] ?? 0))) {
                    respond(409, ['error' => "$title is unavailable or has insufficient stock."]);
                }
                $price = (float)$catalogProduct['price'];
                if ($catalogProduct['stock'] !== null) {
                    $stockAdjustments[$productId] = ($stockAdjustments[$productId] ?? 0) + $quantity;
                    $stockTitles[$productId] = $title;
                }
            } else {
                $price = (float)$price;
            }
            $subtotal += $price * $quantity;
            $cleanItems[] = [
                'productId' => $productId,
                'title' => $title,
                'reviewTitle' => clean_text($item['reviewTitle'] ?? $title, 120, 'Dish name'),
                'image' => clean_image($item['img'] ?? '', 'Dish image'),
                'path' => clean_text($item['link'] ?? '', 1000, 'Dish path'),
                'instructions' => clean_text($item['instructions'] ?? '', 500, 'Item instructions'),
                'price' => $price,
                'quantity' => $quantity,
            ];
        }
        $voucher = $data['voucher'] ?? '';
        $discount = 0.0;
        if ($voucher === 'voucher20' && $subtotal >= 249) {
            $discount = min($subtotal * 0.20, 500);
        } elseif ($voucher === 'voucher15' && $subtotal >= 199) {
            $discount = min($subtotal * 0.15, 600);
        }
        $deliveryLabel = clean_text($data['deliveryLabel'] ?? 'Standard', 40, 'Delivery option');
        $adjustment = filter_var($data['deliveryAdjustment'] ?? 0, FILTER_VALIDATE_FLOAT);
        $tip = filter_var($data['tip'] ?? 0, FILTER_VALIDATE_FLOAT);
        if ($adjustment === false || abs($adjustment) > 10000 || $tip === false || $tip < 0 || $tip > 10000) {
            respond(400, ['error' => 'Delivery fee or tip is invalid.']);
        }
        $deliveryFee = max(0, 4 + $adjustment);
        $serviceFee = 9.0;
        $total = max(0, $subtotal - $discount + $deliveryFee + $serviceFee + $tip);
        $address = clean_text($data['address'] ?? null, 1000, 'Delivery address', true);
        if (mb_strlen($address) < 8) {
            respond(400, ['error' => 'Enter a complete delivery address.']);
        }
        $payment = clean_text($data['payment'] ?? 'Cash', 80, 'Payment method');
        $instructions = clean_text($data['instructions'] ?? '', 1000, 'Delivery instructions');
        $etaByDelivery = [
            'Priority' => ['15–30 minutes', 23],
            'Standard' => ['20–45 minutes', 33],
            'Saver' => ['30–45 minutes', 38],
            'Schedule' => ['As scheduled', null],
        ];
        [$eta, $etaMinutes] = $etaByDelivery[$deliveryLabel] ?? $etaByDelivery['Standard'];
        $etaAt = $etaMinutes === null ? null : gmdate('Y-m-d H:i:s', time() + $etaMinutes * 60);
        $orderNumber = 'BR-' . strtoupper(bin2hex(random_bytes(5)));
        $decrementStock = $pdo->prepare(
            'UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND stock >= ?'
        );
        foreach ($stockAdjustments as $productId => $quantity) {
            $decrementStock->execute([$quantity, $productId, $quantity]);
            if ($decrementStock->rowCount() !== 1) {
                respond(409, ['error' => 'A dish just sold out. Refresh the menu and try again.']);
            }
            log_action($user, 'stock decrement', $stockTitles[$productId], "$quantity unit(s) reserved for order $orderNumber");
        }
        $insertOrder = $pdo->prepare(
            'INSERT INTO orders (order_number, user_id, subtotal, discount, delivery_fee, service_fee, tip, total,
             delivery_label, eta, eta_at, address, instructions, payment)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $insertOrder->execute([
            $orderNumber, $user['id'], $subtotal, $discount, $deliveryFee, $serviceFee, $tip, $total,
            $deliveryLabel, $eta, $etaAt, $address, $instructions, $payment,
        ]);
        $orderId = (int)$pdo->lastInsertId();
        $insertItem = $pdo->prepare(
            'INSERT INTO order_items (order_id, product_id, title, review_title, image, product_path, instructions, unit_price, quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($cleanItems as $item) {
            $insertItem->execute([
                $orderId, $item['productId'], $item['title'], $item['reviewTitle'], $item['image'], $item['path'],
                $item['instructions'], $item['price'], $item['quantity'],
            ]);
        }
        $pdo->prepare(
            'UPDATE checkout_requests SET order_id = ? WHERE user_id = ? AND idempotency_key = ?'
        )->execute([$orderId, $user['id'], $idempotencyKey]);
        $pdo->commit();
        respond(201, ['order' => checkout_receipt($pdo, $orderId, (int)$user['id'])]);
    }

    if ($action === 'order' && $method === 'GET') {
        $user = current_user();
        $orderNumber = clean_text($_GET['id'] ?? null, 40, 'Order number', true);
        $statement = $pdo->prepare('SELECT * FROM orders WHERE order_number = ? AND user_id = ?');
        $statement->execute([$orderNumber, $user['id']]);
        $order = $statement->fetch();
        if (!$order) {
            respond(404, ['error' => 'Order not found.']);
        }
        $items = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ?');
        $items->execute([$order['id']]);
        $order['items'] = $items->fetchAll();
        foreach ($order['items'] as &$item) {
            $item['productId'] = $item['product_id'] === null ? null : (int)$item['product_id'];
            $item['price'] = (float)$item['unit_price'];
            $item['img'] = $item['image'];
            $item['link'] = $item['product_path'];
        }
        unset($item);
        $feedbackStatement = $pdo->prepare(
            'SELECT product_title AS foodItem, product_path AS foodItemPath, food_rating AS foodRating,
                    delivery_rating AS deliveryRating, comment, created_at AS submittedAt
             FROM feedback WHERE order_id = ?'
        );
        $feedbackStatement->execute([$order['id']]);
        $reviews = $feedbackStatement->fetchAll();
        $order['productReviews'] = array_values(array_filter($reviews, static fn(array $review): bool =>
            $review['foodItem'] !== null && $review['foodRating'] !== null
        ));
        $deliveryRating = array_values(array_filter($reviews, static fn(array $review): bool =>
            $review['deliveryRating'] !== null
        ));
        if ($deliveryRating) {
            $order['feedback'] = ['deliveryRating' => (int)$deliveryRating[0]['deliveryRating']];
        }
        $order['id'] = $order['order_number'];
        $order['createdAt'] = utc_iso($order['created_at']);
        $order['updatedAt'] = utc_iso($order['updated_at']);
        $order['deliveryFee'] = (float)$order['delivery_fee'];
        $order['serviceFee'] = (float)$order['service_fee'];
        $order['total'] = (float)$order['total'];
        $order['subtotal'] = (float)$order['subtotal'];
        $order['discount'] = (float)$order['discount'];
        $order['tip'] = (float)$order['tip'];
        $order['deliveryLabel'] = $order['delivery_label'];
        $order['etaAt'] = utc_iso($order['eta_at']);
        $order['confirmedDelivered'] = (bool)$order['confirmed_delivered'];
        respond(200, ['order' => $order]);
    }

    if ($action === 'confirm-delivery' && $method === 'POST') {
        $user = current_user(true);
        $orderNumber = clean_text($data['id'] ?? null, 40, 'Order number', true);
        $statement = $pdo->prepare(
            'UPDATE orders SET status = "delivered", confirmed_delivered = TRUE, updated_at = NOW()
             WHERE order_number = ? AND user_id = ? AND status = "on_the_way"'
        );
        $statement->execute([$orderNumber, $user['id']]);
        if ($statement->rowCount() === 0) {
            respond(409, ['error' => 'Only an order that is on the way can be confirmed as delivered.']);
        }
        respond(200, ['message' => 'Delivery confirmed.']);
    }

    if ($action === 'product-ratings' && $method === 'GET') {
        $statement = $pdo->query(
            'SELECT MIN(f.product_title) AS foodItem, AVG(f.food_rating) AS averageRating,
                    COUNT(*) AS ratingCount
             FROM feedback f
             JOIN orders o ON o.id = f.order_id
             WHERE o.status = "delivered" AND f.food_rating IS NOT NULL AND f.hidden = FALSE
             GROUP BY LOWER(TRIM(f.product_title))'
        );
        respond(200, ['ratings' => $statement->fetchAll()]);
    }

    if ($action === 'feedback' && $method === 'GET') {
        $product = clean_text($_GET['food'] ?? null, 120, 'Dish name', true);
        $statement = $pdo->prepare(
            'SELECT f.product_title AS foodItem, f.product_path AS foodItemPath, f.food_rating AS foodRating, f.comment, f.created_at AS submittedAt, o.order_number AS orderId
             FROM feedback f JOIN orders o ON o.id = f.order_id
             WHERE o.status = "delivered" AND f.product_title = ? AND f.food_rating IS NOT NULL
               AND f.hidden = FALSE
             ORDER BY f.created_at DESC'
        );
        $statement->execute([$product]);
        respond(200, ['reviews' => $statement->fetchAll()]);
    }

    if ($action === 'feedback' && $method === 'POST') {
        $user = current_user(true);
        $orderNumber = clean_text($data['orderId'] ?? null, 40, 'Order number', true);
        $foodRating = filter_var($data['foodRating'] ?? null, FILTER_VALIDATE_INT);
        $deliveryRating = isset($data['deliveryRating'])
            ? filter_var($data['deliveryRating'], FILTER_VALIDATE_INT) : null;
        if ($foodRating === false || $foodRating < 1 || $foodRating > 5
            || ($deliveryRating !== null && ($deliveryRating === false || $deliveryRating < 1 || $deliveryRating > 5))) {
            respond(400, ['error' => 'Ratings must be between 1 and 5.']);
        }
        $orderQuery = $pdo->prepare(
            'SELECT id, status FROM orders WHERE order_number = ? AND user_id = ?'
        );
        $orderQuery->execute([$orderNumber, $user['id']]);
        $order = $orderQuery->fetch();
        if (!$order || $order['status'] !== 'delivered') {
            respond(403, ['error' => 'Feedback is available only for your delivered orders.']);
        }
        $product = isset($data['foodItem'])
            ? clean_text($data['foodItem'], 120, 'Dish name', true) : null;
        $path = clean_text($data['foodItemPath'] ?? '', 1000, 'Dish path');
        $comment = clean_text($data['comment'] ?? '', 500, 'Comment');
        $exists = $pdo->prepare('SELECT id FROM order_items WHERE order_id = ? AND (title = ? OR review_title = ?)');
        if ($product !== null) {
            $exists->execute([$order['id'], $product, $product]);
            if (!$exists->fetchColumn()) {
                respond(403, ['error' => 'This dish was not part of that order.']);
            }
        }
        $statement = $pdo->prepare(
            'INSERT INTO feedback (order_id, user_id, product_title, product_path, food_rating, delivery_rating, comment)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE product_path = VALUES(product_path),
                 food_rating = VALUES(food_rating), delivery_rating = VALUES(delivery_rating),
                 comment = VALUES(comment)'
        );
        $statement->execute([$order['id'], $user['id'], $product, $path, $foodRating, $deliveryRating, $comment]);
        respond(200, ['message' => 'Feedback saved.']);
    }

    if ($action === 'staff-login' && $method === 'POST') {
        $username = clean_text($data['username'] ?? null, 64, 'Username', true);
        $password = $data['password'] ?? '';
        $statement = $pdo->prepare(
            'SELECT id, username, display_name, role, password_hash FROM staff WHERE username = ? AND active = TRUE'
        );
        $statement->execute([$username]);
        $staff = $statement->fetch();
        if (!$staff || !is_string($password) || !password_verify($password, $staff['password_hash'])) {
            respond(401, ['error' => 'Invalid username or password.']);
        }
        session_regenerate_id(true);
        unset($_SESSION['user']);
        $_SESSION['staff'] = [
            'id' => (int)$staff['id'],
            'username' => $staff['username'],
            'name' => $staff['display_name'],
            'role' => $staff['role'],
        ];
        respond(200, ['staff' => $_SESSION['staff']]);
    }

    if ($action === 'staff-session' && $method === 'GET') {
        $staff = require_staff();
        respond(200, ['staff' => $staff]);
    }

    if ($action === 'staff-logout' && $method === 'POST') {
        unset($_SESSION['staff']);
        session_regenerate_id(true);
        respond(200, ['message' => 'Signed out.']);
    }

    if ($action === 'admin-feedback' && $method === 'GET') {
        require_staff();
        $statement = $pdo->query(
            'SELECT f.id, f.order_id, f.product_title, f.product_path, f.food_rating,
                    f.delivery_rating, f.comment, f.admin_response, f.response_at, f.hidden, f.created_at,
                    o.order_number, u.fullname AS customer_name, u.email AS customer_email
             FROM feedback f
             JOIN orders o ON o.id = f.order_id
             LEFT JOIN users u ON u.id = f.user_id
             ORDER BY f.created_at DESC, f.id DESC'
        );
        $reviews = array_map(static function (array $review): array {
            return [
                'id' => (int)$review['id'],
                'orderId' => $review['order_number'],
                'foodItem' => $review['product_title'],
                'foodItemPath' => $review['product_path'],
                'foodRating' => $review['food_rating'] === null ? null : (int)$review['food_rating'],
                'deliveryRating' => $review['delivery_rating'] === null ? null : (int)$review['delivery_rating'],
                'comment' => $review['comment'],
                'adminResponse' => $review['admin_response'],
                'responseAt' => utc_iso($review['response_at']),
                'hidden' => (bool)$review['hidden'],
                'submittedAt' => utc_iso($review['created_at']),
                'customerName' => $review['customer_name'] ?? 'Deleted customer',
                'customerEmail' => $review['customer_email'] ?? '',
            ];
        }, $statement->fetchAll());
        respond(200, ['reviews' => $reviews]);
    }

    if ($action === 'admin-feedback' && $method === 'PATCH') {
        $staff = require_staff();
        $reviewId = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
        if ($reviewId === false || $reviewId < 1
            || (!array_key_exists('adminResponse', $data) && !array_key_exists('hidden', $data))) {
            respond(400, ['error' => 'The feedback update is invalid.']);
        }
        $updates = [];
        $parameters = [];
        if (array_key_exists('adminResponse', $data)) {
            $response = clean_text($data['adminResponse'], 500, 'Response');
            $updates[] = 'admin_response = ?';
            $updates[] = 'response_at = ?';
            $parameters[] = $response;
            $parameters[] = $response === '' ? null : gmdate('Y-m-d H:i:s');
        }
        if (array_key_exists('hidden', $data)) {
            if (!is_bool($data['hidden'])) {
                respond(400, ['error' => 'The hidden state is invalid.']);
            }
            $updates[] = 'hidden = ?';
            $parameters[] = (int)$data['hidden'];
        }
        $parameters[] = $reviewId;
        $statement = $pdo->prepare('UPDATE feedback SET ' . implode(', ', $updates) . ' WHERE id = ?');
        $statement->execute($parameters);
        if ($statement->rowCount() === 0) {
            $exists = $pdo->prepare('SELECT 1 FROM feedback WHERE id = ?');
            $exists->execute([$reviewId]);
            if (!$exists->fetchColumn()) {
                respond(404, ['error' => 'Feedback was not found.']);
            }
        }
        $changes = [];
        if (array_key_exists('adminResponse', $data)) {
            $changes[] = 'Response saved';
        }
        if (array_key_exists('hidden', $data)) {
            $changes[] = $data['hidden'] ? 'Review hidden' : 'Review visible';
        }
        log_action($staff, 'feedback update', (string)$reviewId, implode('; ', $changes));
        $saved = $pdo->prepare(
            'SELECT admin_response, response_at, hidden FROM feedback WHERE id = ?'
        );
        $saved->execute([$reviewId]);
        $review = $saved->fetch();
        respond(200, ['review' => [
            'id' => $reviewId,
            'adminResponse' => $review['admin_response'],
            'responseAt' => utc_iso($review['response_at']),
            'hidden' => (bool)$review['hidden'],
        ]]);
    }

    if ($action === 'admin-orders' && $method === 'GET') {
        require_staff();
        $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT);
        $pageSize = filter_var($_GET['pageSize'] ?? 50, FILTER_VALIDATE_INT);
        if ($page === false || $page < 1 || $pageSize === false || $pageSize < 1 || $pageSize > 100) {
            respond(400, ['error' => 'Order page and page size are invalid.']);
        }
        $all = ($_GET['all'] ?? '') === '1';
        $status = clean_text($_GET['status'] ?? '', 20, 'Order status');
        if ($status !== '' && !in_array($status, ['received', 'preparing', 'on_the_way', 'delivered', 'cancelled'], true)) {
            respond(400, ['error' => 'Order status filter is invalid.']);
        }
        $search = clean_text($_GET['q'] ?? '', 200, 'Order search');
        $conditions = [];
        $parameters = [];
        if ($status !== '') {
            $conditions[] = 'o.status = ?';
            $parameters[] = $status;
        }
        if ($search !== '') {
            $conditions[] = '(o.order_number LIKE ? OR o.address LIKE ? OR u.fullname LIKE ? OR u.email LIKE ?
                OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.title LIKE ?))';
            $searchPattern = '%' . $search . '%';
            array_push($parameters, $searchPattern, $searchPattern, $searchPattern, $searchPattern, $searchPattern);
        }
        $where = $conditions ? ' WHERE ' . implode(' AND ', $conditions) : '';
        $count = $pdo->prepare(
            "SELECT COUNT(*) FROM orders o LEFT JOIN users u ON u.id = o.user_id$where"
        );
        $count->execute($parameters);
        $total = (int)$count->fetchColumn();
        $pages = max(1, (int)ceil($total / $pageSize));
        if (!$all) {
            $page = min($page, $pages);
        }
        $orderSql =
            'SELECT o.*, u.fullname AS customer_name, u.email AS customer_email,
                    EXISTS (
                        SELECT 1 FROM audit_log l
                        WHERE l.entity = o.order_number
                          AND l.action = "status update"
                          AND l.role = "admin"
                    ) AS admin_status_locked
             FROM orders o LEFT JOIN users u ON u.id = o.user_id' . $where . ' ORDER BY o.created_at DESC, o.id DESC';
        if (!$all) {
            $orderSql .= ' LIMIT ? OFFSET ?';
        }
        $orderStatement = $pdo->prepare($orderSql);
        foreach ($parameters as $index => $parameter) {
            $orderStatement->bindValue($index + 1, $parameter, PDO::PARAM_STR);
        }
        if (!$all) {
            $orderStatement->bindValue(count($parameters) + 1, $pageSize, PDO::PARAM_INT);
            $orderStatement->bindValue(count($parameters) + 2, ($page - 1) * $pageSize, PDO::PARAM_INT);
        }
        $orderStatement->execute();
        $orders = $orderStatement->fetchAll();
        $orderIds = array_map(static fn(array $order): int => (int)$order['id'], $orders);
        $itemsByOrder = [];
        if ($orderIds) {
            if ($all) {
                $itemsStatement = $pdo->prepare(
                    "SELECT * FROM order_items WHERE order_id IN (
                        SELECT o.id FROM orders o LEFT JOIN users u ON u.id = o.user_id$where
                    ) ORDER BY order_id, id"
                );
                $itemsStatement->execute($parameters);
            } else {
                $placeholders = implode(',', array_fill(0, count($orderIds), '?'));
                $itemsStatement = $pdo->prepare(
                    "SELECT * FROM order_items WHERE order_id IN ($placeholders) ORDER BY order_id, id"
                );
                $itemsStatement->execute($orderIds);
            }
            foreach ($itemsStatement->fetchAll() as $item) {
                $item['productId'] = $item['product_id'] === null ? null : (int)$item['product_id'];
                $item['price'] = (float)$item['unit_price'];
                $item['img'] = $item['image'];
                $item['link'] = $item['product_path'];
                $itemsByOrder[(int)$item['order_id']][] = $item;
            }
        }
        foreach ($orders as &$order) {
            $order['items'] = $itemsByOrder[(int)$order['id']] ?? [];
            $order['id'] = $order['order_number'];
            $order['createdAt'] = utc_iso($order['created_at']);
            $order['deliveryFee'] = (float)$order['delivery_fee'];
            $order['serviceFee'] = (float)$order['service_fee'];
            $order['total'] = (float)$order['total'];
            $order['refundAmount'] = (float)$order['refund_amount'];
            $order['subtotal'] = (float)$order['subtotal'];
            $order['discount'] = (float)$order['discount'];
            $order['tip'] = (float)$order['tip'];
            $order['updatedAt'] = utc_iso($order['updated_at']);
            $order['cancellationReason'] = $order['cancellation_reason'];
            $order['estimatedDelivery'] = utc_iso($order['estimated_delivery']);
            $order['assignedStaff'] = $order['assigned_staff'];
            $order['etaAt'] = utc_iso($order['eta_at']);
            $order['deliveryLabel'] = $order['delivery_label'];
            $order['adminStatusLocked'] = (bool)$order['admin_status_locked'];
        }
        unset($order);
        $response = ['orders' => $orders];
        if (!$all) {
            $response['pagination'] = [
                'page' => $page,
                'pageSize' => $pageSize,
                'total' => $total,
                'pages' => $pages,
            ];
        }
        respond(200, $response);
    }

    if ($action === 'order-status' && $method === 'PATCH') {
        $staff = require_staff();
        $orderNumber = clean_text($data['id'] ?? null, 40, 'Order number', true);
        $status = $data['status'] ?? '';
        $stages = ['received', 'preparing', 'on_the_way', 'delivered'];
        if (!in_array($status, [...$stages, 'cancelled'], true)) {
            respond(400, ['error' => 'Invalid order status.']);
        }
        $pdo->beginTransaction();
        $currentOrder = $pdo->prepare('SELECT status FROM orders WHERE order_number = ? FOR UPDATE');
        $currentOrder->execute([$orderNumber]);
        $previousStatus = $currentOrder->fetchColumn();
        if ($previousStatus === false) {
            $pdo->rollBack();
            respond(404, ['error' => 'Order not found.']);
        }
        if ($previousStatus === 'delivered') {
            $pdo->rollBack();
            respond(409, ['error' => 'Delivered orders cannot be changed.']);
        }
        if ($staff['role'] !== 'admin') {
            $adminUpdate = $pdo->prepare(
                'SELECT id FROM audit_log
                 WHERE entity = ? AND action = "status update" AND role = "admin"
                 LIMIT 1 FOR UPDATE'
            );
            $adminUpdate->execute([$orderNumber]);
            if ($adminUpdate->fetchColumn() !== false) {
                $pdo->rollBack();
                respond(409, ['error' => 'An admin has already changed this order status. Staff can no longer update it.']);
            }
        }
        if ($previousStatus === $status) {
            $pdo->commit();
            respond(200, ['message' => 'Order status is unchanged.']);
        }
        if ($previousStatus === 'cancelled') {
            $pdo->rollBack();
            respond(409, ['error' => 'Cancelled orders cannot be changed.']);
        }
        if ($staff['role'] !== 'admin') {
            $previousStage = array_search($previousStatus, $stages, true);
            $nextStage = array_search($status, $stages, true);
            if ($previousStage === false
                || ($status !== 'cancelled' && ($nextStage === false || $nextStage < $previousStage))) {
                $pdo->rollBack();
                respond(409, ['error' => 'Staff can only move order status forward.']);
            }
        }
        $statement = $pdo->prepare('UPDATE orders SET status = ?, updated_at = NOW() WHERE order_number = ?');
        $statement->execute([$status, $orderNumber]);
        if ($statement->rowCount() === 0) {
            $pdo->rollBack();
            respond(404, ['error' => 'Order not found or unchanged.']);
        }
        log_action($staff, 'status update', $orderNumber, "$previousStatus to $status");
        $pdo->commit();
        respond(200, ['message' => 'Order status updated.']);
    }

    if (($action === 'products' || $action === 'admin-products') && $method === 'GET') {
        if ($action === 'admin-products') {
            require_staff(['admin']);
        }
        $rows = $pdo->query(
            'SELECT id, title, source_key, sku, category, description, image, price, stock, available, deleted, metadata, updated_at
             FROM products ORDER BY title'
        )->fetchAll();
        $products = array_map('product_fields', $rows);
        if ($action === 'products') {
            $products = array_values(array_filter($products, static fn(array $product): bool =>
                !$product['deleted']
            ));
            $products = array_map(static function (array $product): array {
                $metadata = (array)$product['metadata'];
                return [
                    'id' => $product['id'],
                    'title' => $product['title'],
                    'sourceKey' => $product['sourceKey'],
                    'category' => $product['category'],
                    'description' => $product['description'],
                    'image' => $product['image'],
                    'price' => $product['price'],
                    'stock' => $product['stock'],
                    'available' => $product['available'],
                    'deleted' => $product['deleted'],
                    'metadata' => (object)array_intersect_key($metadata, array_fill_keys([
                        'featured', 'prepTime', 'allergens', 'tags', 'lifecycle',
                        'scheduleStart', 'scheduleEnd', 'variants', 'addons',
                    ], true)),
                ];
            }, $products);
        }
        respond(200, ['products' => $products]);
    }

    if ($action === 'products' && $method === 'PUT') {
        $staff = require_staff(['admin']);
        $products = $data['products'] ?? null;
        if (!is_array($products) || count($products) > 500) {
            respond(400, ['error' => 'Products must be a list of at most 500 entries.']);
        }
        $validatedProducts = [];
        $seenIds = [];
        $seenSourceKeys = [];
        $seenTitles = [];
        foreach ($products as $product) {
            if (!is_array($product)) {
                respond(400, ['error' => 'A product entry is invalid.']);
            }
            $validated = validate_product($product);
            $validated['id'] = nullable_product_id($validated['id']);
            $sourceKey = mb_strtolower($validated['sourceKey']);
            $title = mb_strtolower($validated['title']);
            if (($validated['id'] !== null && isset($seenIds[$validated['id']]))
                || isset($seenSourceKeys[$sourceKey]) || isset($seenTitles[$title])) {
                respond(400, ['error' => 'The product batch contains duplicate IDs, source keys, or dish names.']);
            }
            if ($validated['id'] !== null) {
                $seenIds[$validated['id']] = true;
            }
            $seenSourceKeys[$sourceKey] = true;
            $seenTitles[$title] = true;
            $validatedProducts[] = $validated;
        }

        $pdo->beginTransaction();
        $selectFields = 'SELECT id, title, source_key, sku, category, description, image, price, stock,
                                available, deleted, metadata, updated_at FROM products';
        $findById = $pdo->prepare("$selectFields WHERE id = ? FOR UPDATE");
        $findBySource = $pdo->prepare("$selectFields WHERE source_key = ? FOR UPDATE");
        $findByTitle = $pdo->prepare("$selectFields WHERE title = ? FOR UPDATE");
        $findSkuOwner = $pdo->prepare('SELECT id FROM products WHERE sku = ?');
        $findSourceOwner = $pdo->prepare('SELECT id FROM products WHERE source_key = ?');
        $findSaved = $pdo->prepare("$selectFields WHERE id = ?");
        $insertProduct = $pdo->prepare(
            'INSERT INTO products (title, source_key, sku, category, description, image, price, stock,
             available, deleted, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $updateProduct = $pdo->prepare(
            'UPDATE products SET title = ?, source_key = ?, sku = ?, category = ?, description = ?,
             image = ?, price = ?, stock = ?, available = ?, deleted = ?, metadata = ? WHERE id = ?'
        );
        $insertRevision = $pdo->prepare(
            'INSERT INTO product_revisions (staff_id, product_id, before_data, after_data) VALUES (?, ?, ?, ?)'
        );
        $savedProducts = [];

        foreach ($validatedProducts as $product) {
            if ($product['id'] !== null) {
                $findById->execute([$product['id']]);
                $existing = $findById->fetch();
                if (!$existing) {
                    respond(404, ['error' => 'A product no longer exists. Reload the menu and retry.']);
                }
            } else {
                $findBySource->execute([$product['sourceKey']]);
                $existing = $findBySource->fetch();
                if (!$existing) {
                    $findByTitle->execute([$product['title']]);
                    $existing = $findByTitle->fetch();
                }
            }
            if ($existing && $product['expectedUpdatedAt'] !== $existing['updated_at']) {
                respond(409, ['error' => "{$product['title']} changed in another session. Reload the menu before editing it."]);
            }
            $existingId = $existing ? (int)$existing['id'] : null;
            if ($product['sku'] !== null) {
                $findSkuOwner->execute([$product['sku']]);
                $skuOwner = $findSkuOwner->fetchColumn();
                if ($skuOwner && (int)$skuOwner !== $existingId) {
                    respond(409, ['error' => 'That SKU is already assigned to another dish.']);
                }
            }
            $findSourceOwner->execute([$product['sourceKey']]);
            $sourceOwner = $findSourceOwner->fetchColumn();
            if ($sourceOwner && (int)$sourceOwner !== $existingId) {
                respond(409, ['error' => 'This product source key is already assigned. Reload the menu and retry.']);
            }
            $metadata = json_encode($product['metadata'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $values = [
                $product['title'], $product['sourceKey'], $product['sku'], $product['category'],
                $product['description'], $product['image'], $product['price'], $product['stock'],
                (int)$product['available'], (int)$product['deleted'], $metadata,
            ];
            if ($existing) {
                $oldMetadata = json_decode((string)$existing['metadata'], true) ?: [];
                $oldValues = [
                    'title' => $existing['title'],
                    'sourceKey' => $existing['source_key'],
                    'sku' => $existing['sku'],
                    'category' => $existing['category'],
                    'description' => $existing['description'],
                    'image' => $existing['image'],
                    'price' => (float)$existing['price'],
                    'stock' => $existing['stock'] === null ? null : (int)$existing['stock'],
                    'available' => (bool)$existing['available'],
                    'deleted' => (bool)$existing['deleted'],
                    'metadata' => $oldMetadata,
                ];
                $newValues = [
                    'title' => $product['title'],
                    'sourceKey' => $product['sourceKey'],
                    'sku' => $product['sku'],
                    'category' => $product['category'],
                    'description' => $product['description'],
                    'image' => $product['image'],
                    'price' => $product['price'],
                    'stock' => $product['stock'],
                    'available' => $product['available'],
                    'deleted' => $product['deleted'],
                    'metadata' => $product['metadata'],
                ];
                $changedFields = [];
                foreach ($newValues as $field => $value) {
                    $oldValue = $oldValues[$field];
                    if ($field === 'metadata') {
                        $value = canonical_value($value);
                        $oldValue = canonical_value($oldValue);
                    }
                    if ($value !== $oldValue) {
                        $changedFields[] = $field;
                    }
                }
                if ($changedFields) {
                    $updateProduct->execute([...$values, $existingId]);
                    $findSaved->execute([$existingId]);
                    $savedRow = $findSaved->fetch();
                    $insertRevision->execute([
                        $staff['id'],
                        $existingId,
                        json_encode(product_fields($existing), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                        json_encode(product_fields($savedRow), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                    ]);
                    $auditAction = $product['deleted'] && !$existing['deleted']
                        ? 'archive'
                        : (!$product['deleted'] && $existing['deleted'] ? 'restore' : 'update');
                    log_action($staff, $auditAction, $product['title'], 'Changed: ' . implode(', ', $changedFields));
                }
            } else {
                $insertProduct->execute($values);
                $existingId = (int)$pdo->lastInsertId();
                $findSaved->execute([$existingId]);
                $savedRow = $findSaved->fetch();
                $insertRevision->execute([
                    $staff['id'],
                    $existingId,
                    null,
                    json_encode(product_fields($savedRow), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                ]);
                log_action($staff, 'create', $product['title'], 'Product created');
            }
            $findSaved->execute([$existingId]);
            $savedProducts[] = product_fields($findSaved->fetch());
        }
        $pdo->commit();
        respond(200, ['message' => 'Products saved.', 'products' => $savedProducts]);
    }

    if ($action === 'product' && $method === 'DELETE') {
        $staff = require_staff(['admin']);
        $productId = filter_var($data['id'] ?? null, FILTER_VALIDATE_INT);
        if ($productId === false || $productId < 1) {
            respond(400, ['error' => 'Product ID is invalid.']);
        }
        $pdo->beginTransaction();
        $select = $pdo->prepare(
            'SELECT id, title, source_key, sku, category, description, image, price, stock,
                    available, deleted, metadata, updated_at FROM products WHERE id = ? FOR UPDATE'
        );
        $select->execute([$productId]);
        $product = $select->fetch();
        if (!$product) {
            respond(404, ['error' => 'Product not found.']);
        }
        if (!(bool)$product['deleted']) {
            respond(409, ['error' => 'Move the dish to the recycle bin before permanently deleting it.']);
        }
        $orderCount = $pdo->prepare('SELECT COUNT(*) FROM order_items WHERE product_id = ?');
        $orderCount->execute([$productId]);
        if ((int)$orderCount->fetchColumn() > 0) {
            respond(409, ['error' => 'This dish is linked to order history and cannot be permanently deleted. Archive it instead.']);
        }
        $pdo->prepare(
            'INSERT INTO product_revisions (staff_id, product_id, before_data, after_data) VALUES (?, ?, ?, NULL)'
        )->execute([
            $staff['id'],
            $productId,
            json_encode(product_fields($product), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ]);
        $pdo->prepare('DELETE FROM products WHERE id = ?')->execute([$productId]);
        log_action($staff, 'permanent delete', $product['title'], 'Product permanently deleted');
        $pdo->commit();
        respond(200, ['message' => 'Product permanently deleted.']);
    }

    if ($action === 'product-undo' && $method === 'GET') {
        $staff = require_staff(['admin']);
        $statement = $pdo->prepare(
            'SELECT 1 FROM product_revisions WHERE staff_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1'
        );
        $statement->execute([$staff['id']]);
        respond(200, ['available' => (bool)$statement->fetchColumn()]);
    }

    if ($action === 'product-undo' && $method === 'POST') {
        $staff = require_staff(['admin']);
        $pdo->beginTransaction();
        $revisionStatement = $pdo->prepare(
            'SELECT * FROM product_revisions
             WHERE staff_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE'
        );
        $revisionStatement->execute([$staff['id']]);
        $revision = $revisionStatement->fetch();
        if (!$revision) {
            respond(404, ['error' => 'There are no product changes to undo.']);
        }

        $before = $revision['before_data'] === null
            ? null
            : json_decode($revision['before_data'], true, 512, JSON_THROW_ON_ERROR);
        $productId = (int)$revision['product_id'];
        $currentStatement = $pdo->prepare(
            'SELECT id, title, source_key, sku, category, description, image, price, stock,
                    available, deleted, metadata, updated_at FROM products WHERE id = ? FOR UPDATE'
        );
        $currentStatement->execute([$productId]);
        $current = $currentStatement->fetch();
        $after = $revision['after_data'] === null
            ? null
            : json_decode($revision['after_data'], true, 512, JSON_THROW_ON_ERROR);
        if ($before !== null && $after !== null && $current) {
            $currentValues = product_fields($current);
            foreach (['title', 'sourceKey', 'sku', 'category', 'description', 'image', 'price', 'stock', 'available', 'deleted', 'metadata'] as $field) {
                $currentValue = $currentValues[$field] ?? null;
                $afterValue = $after[$field] ?? null;
                if ($field === 'metadata') {
                    $currentValue = canonical_value($currentValue);
                    $afterValue = canonical_value($afterValue);
                }
                if ($currentValue !== $afterValue) {
                    respond(409, ['error' => 'This dish changed again after that edit. Reload before trying to undo.']);
                }
            }
        }
        if ($before === null) {
            if ($current) {
                $pdo->prepare('UPDATE products SET available = FALSE, deleted = TRUE WHERE id = ?')
                    ->execute([$productId]);
            }
        } elseif ($current) {
            $metadata = json_encode($before['metadata'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $pdo->prepare(
                'UPDATE products SET title = ?, source_key = ?, sku = ?, category = ?, description = ?, image = ?,
                 price = ?, stock = ?, available = ?, deleted = ?, metadata = ? WHERE id = ?'
            )->execute([
                $before['title'], $before['sourceKey'], ($before['sku'] ?? '') !== '' ? $before['sku'] : null,
                $before['category'], $before['description'], $before['image'], $before['price'], $before['stock'],
                (int)$before['available'], (int)$before['deleted'], $metadata, $productId,
            ]);
        } else {
            $metadata = json_encode($before['metadata'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $pdo->prepare(
                'INSERT INTO products (id, title, source_key, sku, category, description, image, price, stock,
                 available, deleted, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $productId, $before['title'], $before['sourceKey'], ($before['sku'] ?? '') !== '' ? $before['sku'] : null,
                $before['category'], $before['description'], $before['image'], $before['price'], $before['stock'],
                (int)$before['available'], (int)$before['deleted'], $metadata,
            ]);
        }
        $pdo->prepare('UPDATE product_revisions SET undone_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$revision['id']]);
        log_action($staff, 'undo', $before['title'] ?? ($current['title'] ?? 'product'), 'Product change reverted');
        $pdo->commit();
        respond(200, ['message' => 'Last product change undone.']);
    }

    if ($action === 'audit' && $method === 'GET') {
        require_staff(['admin']);
        $page = filter_var($_GET['page'] ?? 1, FILTER_VALIDATE_INT);
        $pageSize = filter_var($_GET['pageSize'] ?? 50, FILTER_VALIDATE_INT);
        if ($page === false || $page < 1 || $pageSize === false || $pageSize < 1 || $pageSize > 100) {
            respond(400, ['error' => 'Audit page and page size are invalid.']);
        }
        $query = clean_text($_GET['q'] ?? '', 200, 'Audit search');
        $where = '';
        $parameters = [];
        if ($query !== '') {
            $where = ' WHERE actor LIKE ? OR role LIKE ? OR action LIKE ? OR entity LIKE ? OR details LIKE ?';
            $pattern = '%' . $query . '%';
            $parameters = [$pattern, $pattern, $pattern, $pattern, $pattern];
        }
        $count = $pdo->prepare("SELECT COUNT(*) FROM audit_log$where");
        $count->execute($parameters);
        $total = (int)$count->fetchColumn();
        $pages = max(1, (int)ceil($total / $pageSize));
        $page = min($page, $pages);
        $statement = $pdo->prepare(
            "SELECT id, actor_id, actor_type, actor, role, action, entity, details, created_at AS at
             FROM audit_log$where ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
        );
        foreach ($parameters as $index => $parameter) {
            $statement->bindValue($index + 1, $parameter, PDO::PARAM_STR);
        }
        $statement->bindValue(count($parameters) + 1, $pageSize, PDO::PARAM_INT);
        $statement->bindValue(count($parameters) + 2, ($page - 1) * $pageSize, PDO::PARAM_INT);
        $statement->execute();
        $entries = $statement->fetchAll();
        foreach ($entries as &$entry) {
            $entry['at'] = utc_iso($entry['at']);
        }
        unset($entry);
        respond(200, [
            'entries' => $entries,
            'pagination' => [
                'page' => $page,
                'pageSize' => $pageSize,
                'total' => $total,
                'pages' => $pages,
            ],
        ]);
    }

    if ($action === 'audit') {
        respond(405, ['error' => 'Audit entries are generated by server-side changes.']);
    }

    respond(404, ['error' => 'Unknown API endpoint.']);
} catch (PDOException $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log($error->getMessage());
    if ($error->getCode() === '23000') {
        respond(409, ['error' => 'That username, email, or item is already in use.']);
    }
    respond(500, ['error' => 'The database could not complete this request.']);
} catch (JsonException $error) {
    error_log($error->getMessage());
    respond(500, ['error' => 'The saved data could not be read.']);
}
