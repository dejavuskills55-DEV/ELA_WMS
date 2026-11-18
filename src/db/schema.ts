import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Roles
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // 'ADMIN' | 'DATA_ENTRY' | 'MANAGER'
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Permissions
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  module: text('module').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: serial('id').primaryKey(),
    roleId: integer('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: integer('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [uniqueIndex('role_permissions_unique_idx').on(table.roleId, table.permissionId)],
);

// 3. Users
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').unique(), // Firebase Auth UID when linked with Google Sign-In
    username: text('username').notNull().unique(),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('users_role_id_idx').on(table.roleId),
    index('users_email_idx').on(table.email),
  ],
);

// User Sessions (HTTP-only cookie session store)
export const userSessions = pgTable(
  'user_sessions',
  {
    id: serial('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('user_sessions_user_id_idx').on(table.userId)],
);

// 4. Warehouses (future-ready for multiple warehouses)
export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  location: text('location'),
  isDefault: boolean('is_default').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 5. Categories
export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    productType: text('product_type').notNull(), // 'RAW_MATERIAL' | 'FINISHED_PRODUCT'
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('categories_type_idx').on(table.productType)],
);

// 6. Units
export const units = pgTable('units', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  symbol: text('symbol').notNull(),
  allowFraction: boolean('allow_fraction').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Optional authorized unit conversion rules
export const unitConversions = pgTable(
  'unit_conversions',
  {
    id: serial('id').primaryKey(),
    fromUnitId: integer('from_unit_id')
      .references(() => units.id)
      .notNull(),
    toUnitId: integer('to_unit_id')
      .references(() => units.id)
      .notNull(),
    factor: numeric('factor', { precision: 18, scale: 6 }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unit_conv_pair_idx').on(table.fromUnitId, table.toUnitId)],
);

// 7. Products
export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    productCode: text('product_code').notNull().unique(),
    barcode: text('barcode').unique(),
    name: text('name').notNull(),
    productType: text('product_type').notNull(), // 'RAW_MATERIAL' | 'FINISHED_PRODUCT'
    categoryId: integer('category_id')
      .references(() => categories.id)
      .notNull(),
    unitId: integer('unit_id')
      .references(() => units.id)
      .notNull(),
    minimumStock: numeric('minimum_stock', { precision: 14, scale: 3 }).default('0').notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    status: text('status').default('ACTIVE').notNull(), // 'ACTIVE' | 'INACTIVE'
    createdById: integer('created_by_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('products_type_idx').on(table.productType),
    index('products_status_idx').on(table.status),
    index('products_category_idx').on(table.categoryId),
    index('products_name_idx').on(table.name),
  ],
);

// 8. InventoryBalances
export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: serial('id').primaryKey(),
    warehouseId: integer('warehouse_id')
      .references(() => warehouses.id)
      .notNull(),
    productId: integer('product_id')
      .references(() => products.id)
      .notNull(),
    openingBalance: numeric('opening_balance', { precision: 14, scale: 3 }).default('0').notNull(),
    totalIn: numeric('total_in', { precision: 14, scale: 3 }).default('0').notNull(),
    totalOut: numeric('total_out', { precision: 14, scale: 3 }).default('0').notNull(),
    currentStock: numeric('current_stock', { precision: 14, scale: 3 }).default('0').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inventory_balances_wh_prod_idx').on(table.warehouseId, table.productId),
    index('inventory_balances_product_idx').on(table.productId),
  ],
);

// 9. StockTransactions (Immutable ledger)
export const stockTransactions = pgTable(
  'stock_transactions',
  {
    id: serial('id').primaryKey(),
    transactionNumber: text('transaction_number').notNull().unique(),
    warehouseId: integer('warehouse_id')
      .references(() => warehouses.id)
      .notNull(),
    productId: integer('product_id')
      .references(() => products.id)
      .notNull(),
    transactionType: text('transaction_type').notNull(), // 'OPENING_BALANCE' | 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'REVERSAL'
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    previousBalance: numeric('previous_balance', { precision: 14, scale: 3 }).notNull(),
    newBalance: numeric('new_balance', { precision: 14, scale: 3 }).notNull(),
    reason: text('reason').notNull(),
    destination: text('destination'),
    referenceNumber: text('reference_number'),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').unique(),
    reversedTransactionId: integer('reversed_transaction_id'),
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('stock_tx_product_idx').on(table.productId),
    index('stock_tx_type_idx').on(table.transactionType),
    index('stock_tx_user_idx').on(table.userId),
    index('stock_tx_ref_idx').on(table.referenceNumber),
    index('stock_tx_created_idx').on(table.createdAt),
  ],
);

// 10. AuditLogs
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    username: text('username'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_user_idx').on(table.userId),
    index('audit_logs_entity_idx').on(table.entity),
    index('audit_logs_created_idx').on(table.createdAt),
  ],
);

// 11. Notifications
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    type: text('type').notNull(), // 'LOW_STOCK' | 'OUT_OF_STOCK' | 'SYSTEM'
    titleAr: text('title_ar').notNull(),
    titleEn: text('title_en').notNull(),
    messageAr: text('message_ar').notNull(),
    messageEn: text('message_en').notNull(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
    isRead: boolean('is_read').default(false).notNull(),
    targetRole: text('target_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notifications_is_read_idx').on(table.isRead),
    index('notifications_product_idx').on(table.productId),
  ],
);

// 12. SystemSettings
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedById: integer('updated_by_id').references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  sessions: many(userSessions),
  createdProducts: many(products),
  stockTransactions: many(stockTransactions),
  auditLogs: many(auditLogs),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const unitsRelations = relations(units, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  unit: one(units, { fields: [products.unitId], references: [units.id] }),
  createdBy: one(users, { fields: [products.createdById], references: [users.id] }),
  balances: many(inventoryBalances),
  transactions: many(stockTransactions),
}));

export const inventoryBalancesRelations = relations(inventoryBalances, ({ one }) => ({
  warehouse: one(warehouses, {
    fields: [inventoryBalances.warehouseId],
    references: [warehouses.id],
  }),
  product: one(products, {
    fields: [inventoryBalances.productId],
    references: [products.id],
  }),
}));

export const stockTransactionsRelations = relations(stockTransactions, ({ one }) => ({
  warehouse: one(warehouses, {
    fields: [stockTransactions.warehouseId],
    references: [warehouses.id],
  }),
  product: one(products, {
    fields: [stockTransactions.productId],
    references: [products.id],
  }),
  user: one(users, {
    fields: [stockTransactions.userId],
    references: [users.id],
  }),
}));
