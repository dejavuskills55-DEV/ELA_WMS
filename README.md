# ELA Inventory Management System (WMS)

Production-oriented Warehouse Management System for Textile Manufacturing (**Raw Materials** & **Finished Products**), featuring Arabic RTL default UI with English toggle, role-based access control, atomic PostgreSQL transactions, USB barcode scanner support, Excel import/export, and Arabic RTL PDF reports.

## Architecture & Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Recharts, JsBarcode, XLSX, jsPDF + html2canvas-pro
- **Backend**: Node.js, Express
- **Database**: PostgreSQL (Cloud SQL) via Drizzle ORM (`drizzle-orm` + `pg`)
- **Authentication**: Firebase Authentication (Google Sign-In) + Secure HTTP-only PostgreSQL-backed sessions (`bcryptjs` password hashing & brute-force lockout protection)

## User Roles

1. **Administrator (`ADMIN`)**: Full access to user management, roles, product editing/deactivation, inventory adjustments, transaction reversals, categories/units, Excel import, system settings, database backups, and audit logs.
2. **Warehouse Data Entry Employee (`DATA_ENTRY`)**: Ultra-simple 3-button portal (`Add New Product`, `Stock In`, `Stock Out`), USB barcode lookup, current stock view, and personal transaction history. Cannot edit/delete products or historical transactions, nor access admin settings.
3. **Manager / Viewer (`MANAGER`)**: Read-only access to the real-time KPI dashboard, charts, low-stock alerts, product balances, transaction history, and 11 operational reports (Excel & PDF).

## Environment Configuration

Configure environment variables based on `.env.example`:

- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD`: Runtime PostgreSQL connection parameters.
- `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD`: Drizzle Kit schema migration credentials.
- `SESSION_SECRET`: Cryptographic HMAC key for session tokens.
- `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` (optional): Automatically provisions the first Administrator account on startup if no users exist. Otherwise, use the interactive first-time setup screen on first launch.

## Database Setup & Migrations

The schema is defined in `src/db/schema.ts` and configured in `src/db/drizzle.config.ts`.

To push schema updates:
```bash
npx drizzle-kit push --config=src/db/drizzle.config.ts
```

Reference data (roles, permissions, central warehouse `WH-MAIN`, 9 default measurement units, textile categories, and system settings) is seeded idempotently via `ensureSeedData()` without overwriting existing inventory data.

## Running Locally & Building for Production

- **Development**:
  ```bash
  npm run dev
  ```
- **Type Check**:
  ```bash
  npm run lint
  ```
- **Production Build & Start**:
  ```bash
  npm run build
  NODE_ENV=production npm start
  ```

## Database Backups

- Administrators can export a sanitized full JSON database snapshot at any time from **Administration -> Settings & Backup** (`GET /api/backup`), or run standard `pg_dump` backups against the PostgreSQL instance.
- All historical `stock_transactions` are immutable; corrections are performed strictly through documented `REVERSAL` or `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` transactions.
