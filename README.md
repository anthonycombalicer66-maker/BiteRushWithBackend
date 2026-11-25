# BiteRush

BiteRush is an HTML, CSS, JavaScript, PHP, and MySQL food-ordering demo. Customer and staff accounts, menu CRUD, cart sync, order creation and tracking, favorites, feedback, and server-generated audit events use the PHP API and MySQL. Signed-in customers receive an in-site notice when an order's status changes. Theme preferences and dashboard exports remain local to each browser.

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

   The migrations add database-backed product CRUD and revisions, seed the default catalog only when the products table is empty, set existing products with unlimited stock to 100, cascade hard-deleted products from carts and favorites while retaining order history, retain orders when accounts are anonymized, add checkout idempotency and audit indexes, and normalize legacy ETA values from Europe/Berlin to UTC. Review existing ETA data before relying on it; the timezone conversion assumes older API versions stored Europe/Berlin wall time. The migration runner records applied versions and can be run again safely.
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
- `scripts\smoke-test.ps1` checks important local pages and confirms that the public catalog API can read products from MySQL.
- Signed-in customer pages check account-scoped order statuses every 30 seconds and announce changes with an accessible in-site notification.
- Customer menu, search, product-detail, and cart pages read current prices, availability, and stock from the MySQL catalog. The initial catalog is seeded by the versioned migration; the admin dashboard can also synchronize later menu edits.
- Database-backed account, cart, favorites, staff, catalog, order, and audit views refresh from the API when opened or returned to and while visible. Browser storage is a display cache, not a fallback source for restoring rows removed from the database.
- Home, menu-category, and search results use the shared `food-cards.js` / `food-cards.css` renderer. Admin product metadata (menu section, description, display-time, calories, tags, availability, and featured status) drives those cards; uploaded product images are validated and saved under `uploads\products\`.
- Buying from a product detail page checks out that dish only and leaves other cart items untouched. Checkout from the cart drawer submits the full cart.
- `api\create-staff.php` is a command-line-only helper for creating staff/admin accounts; it does not provide a public web route.
- Staff can move order statuses forward only, but cannot change delivered or cancelled orders. An admin status change also locks the order from further staff updates; admins can move statuses backward. Cancelled orders remain final.
- Checkout requests use a persistent idempotency key, so retrying the same checkout returns the saved order instead of reserving stock twice.
- Account deletion deactivates and anonymizes the account while preserving orders, feedback, and audit history.
- API timestamps are stored and returned in UTC; the browser converts them to local time for display. Existing ETAs are normalized by the versioned migration.
- Admin order queries support pagination, status/search filters, and batched item loading. Audit history is server-generated, actor-ID-backed, searchable, and paginated.

## Delivery address

- The delivery address is entered as editable text and stored with the order in the existing `orders.address` column.
- The Delivery Address page restores the latest saved order address for a signed-in customer when no address is already saved in that browser.
- The Google Maps view was removed because this installation has no configured Google Maps API key. Map-based location selection and automatic address detection are not available until a restricted Google Maps browser key and the required APIs are configured.

For production, configure a dedicated MySQL account with a password, HTTPS, secure backups, and a PHP/MySQL host. GitHub Pages serves static files only and cannot run this PHP API.

## Manual database backups and recovery

Run a manual backup from PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\xampp\htdocs\BiteRush\scripts\backup-database.ps1"
```

By default, the script uses XAMPP's `mysqldump.exe`, the local `biterush` database, and the default XAMPP `root` account, and writes a timestamped backup folder under `Documents\BiteRushBackups`. Each folder contains a SQL dump and, when present, a copy of `uploads\products`. Backups are kept outside the project so they cannot be committed accidentally.

If MySQL uses a password or non-default connection settings, pass `-DefaultsFile` with a MySQL client option file stored outside the repository. Include `[client]`, `user`, `password`, `host`, and `port` in that file, and restrict its Windows permissions to the account that runs the backup. Do not put database credentials in this repository or in a scheduled task's arguments.

To schedule backups, create a Windows Task Scheduler task that runs `powershell.exe` with `-NoProfile -ExecutionPolicy Bypass -File "C:\xampp\htdocs\BiteRush\scripts\backup-database.ps1" -BackupDirectory "D:\BiteRushBackups"` and, if needed, `-DefaultsFile "C:\path\outside\the\repository\mysql-backup.cnf"`. Run it as a Windows account that can access the option file and backup directory. The script does not create or schedule a task automatically.

To restore, first stop site writes and make a separate backup of the current database. From Command Prompt, import the selected `.sql` dump with XAMPP's `mysql.exe` (use the same protected defaults file if needed):

```text
"C:\xampp\mysql\bin\mysql.exe" -u root < "D:\BiteRushBackups\BiteRush-YYYYMMDD-HHMMSS-fff\biterush.sql"
```

For a password-protected database, add `--defaults-extra-file="C:\path\outside\the\repository\mysql-backup.cnf"` before `-u root`; this option must come first. Importing replaces tables in the `biterush` database. If the backup contains `uploads\products`, copy that folder back to the deployment's `uploads` directory as well; keep `api\config.php` separate and unchanged. Verify the site with `scripts\smoke-test.ps1` after recovery.

## Current scope

Menu edits are saved to MySQL with revision history and undo support. Dashboard exports and theme settings remain browser-local; the PowerShell backup script covers the MySQL database and uploaded product images. Menu-page favorite buttons keep a local cache and sync to MySQL when signed in. This setup is for local development and is not a complete production payment or deployment configuration.
