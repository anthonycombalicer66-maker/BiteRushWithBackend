# BiteRush

BiteRush is an HTML, CSS, JavaScript, PHP, and MySQL food-ordering demo. Customer and staff accounts, menu CRUD, cart sync, order creation and tracking, favorites, feedback, and server-generated audit events use the PHP API and MySQL. Theme preferences and browser backups remain local to each browser.

Use PHP 8.1 or later with MySQL 5.7.8+ or MariaDB 10.2.7+.

## Run with XAMPP

1. Treat this Git workspace as the canonical source. To publish it to XAMPP, run `scripts\sync-xampp.ps1`; it updates `C:\xampp\htdocs\BiteRush` without deleting extra files or replacing that copy's `api\config.php`.
2. Open XAMPP Control Panel and start **Apache** and **MySQL** http://localhost/phpmyadmin/index.php?route=/database/structure&db=biterush.
3. For a fresh install only, import `database.sql` through phpMyAdmin. For an existing database, do not re-import it expecting `CREATE TABLE IF NOT EXISTS` to update tables.
4. In the XAMPP deployment copy, create `api\config.php` from `api\config.example.php`. For a default local XAMPP installation, the example uses MySQL user `root` with an empty password. Change it if your MySQL account uses a password.
5. If the existing database still stores cart items in a JSON `carts.items` column, migrate those items first:

   ```powershell
   C:\xampp\php\php.exe C:\xampp\htdocs\BiteRush\api\migrate-cart.php
   ```

   The command preserves current cart items and removes the old JSON column only after migration succeeds. It is safe to run when the database already uses normalized cart rows.
6. Back up the database before migrating an existing installation. Then apply pending, versioned schema/data migrations from PowerShell:

   ```powershell
   C:\xampp\php\php.exe C:\xampp\htdocs\BiteRush\api\migrate.php
   ```

   The migrations add database-backed product CRUD and revisions, seed the default catalog only when the products table is empty, retain orders when accounts are anonymized, add checkout idempotency and audit indexes, and normalize legacy ETA values from Europe/Berlin to UTC. Review existing ETA data before relying on it; the timezone conversion assumes older API versions stored Europe/Berlin wall time. The migration runner records applied versions and can be run again safely.
7. Open `http://localhost/BiteRush/`. Do not open the HTML files as `file://` URLs or use a static-only server; PHP and session cookies require Apache.
8. Create an account on the website. Sign in is backed by the `users` table.
9. Create an admin login from PowerShell:

   ```powershell
   C:\xampp\php\php.exe C:\xampp\htdocs\BiteRush\api\create-staff.php admin Admin admin
   ```

   Enter a strong password when prompted. Use `staff` instead of `admin` to create a staff login. Sign in at `http://localhost/BiteRush/AdminDashboard/login.html` or the Staff sign-in page http://localhost/BiteRush/Staff/.

## Database and API

- `database.sql` creates the BiteRush database and tables, including one row per cart item in `cart_items`.
- `api\migrate.php` applies ordered migrations in `api\migrations\` and records them in `schema_migrations`. Run it after setting up the database and before using the updated API.
- `scripts\sync-xampp.ps1` copies the canonical workspace to XAMPP without replacing `api\config.php` or deleting deployment-only files.
- `api\migrate-cart.php` converts the earlier JSON cart column to the normalized `cart_items` table without losing saved items.
- `api\config.php` contains local database settings and should not be committed or deployed with development credentials.
- `api\index.php` handles account, cart, order, favorites, feedback, and staff requests using PHP sessions and prepared statements.
- Customer menu, search, product-detail, and cart pages read current prices, availability, and stock from the MySQL catalog. The initial catalog is seeded by the versioned migration; the admin dashboard can also synchronize later menu edits.
- Buying from a product detail page checks out that dish only and leaves other cart items untouched. Checkout from the cart drawer submits the full cart.
- `api\create-staff.php` is a command-line-only helper for creating staff/admin accounts; it does not provide a public web route.
- Staff can move order statuses forward only, but cannot change delivered or cancelled orders. An admin status change also locks the order from further staff updates; admins can move statuses backward. Cancelled orders remain final.
- Checkout requests use a persistent idempotency key, so retrying the same checkout returns the saved order instead of reserving stock twice.
- Account deletion deactivates and anonymizes the account while preserving orders, feedback, and audit history.
- API timestamps are stored and returned in UTC; the browser converts them to local time for display. Existing ETAs are normalized by the versioned migration.
- Admin order queries support pagination, status/search filters, and batched item loading. Audit history is server-generated, actor-ID-backed, searchable, and paginated.

For production, configure a dedicated MySQL account with a password, HTTPS, secure backups, and a PHP/MySQL host. GitHub Pages serves static files only and cannot run this PHP API.

## Current scope

Menu edits are saved to MySQL with revision history and undo support. Dashboard backup/restore and theme settings remain browser-local. Menu-page favorite buttons keep a local cache and sync to MySQL when signed in. This setup is for local development and is not a complete production payment or deployment configuration.
