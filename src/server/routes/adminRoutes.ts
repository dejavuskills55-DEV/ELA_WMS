import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { count, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  categories,
  inventoryBalances,
  notifications,
  products,
  roles,
  stockTransactions,
  systemSettings,
  unitConversions,
  units,
  users,
  warehouses,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
  requireRole,
} from '../../middleware/auth.ts';
import { getClientIp, recordAuditLog } from '../audit.ts';

const router = Router();

// Shared metadata for authenticated screens (roles, categories, units, settings, unread alerts)
router.get('/meta', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const [allRoles, allCategories, allUnits, allWarehouses, allConversions, allSettings, unreadRows] =
      await Promise.all([
        db.select().from(roles),
        db.select().from(categories).orderBy(categories.productType, categories.nameAr),
        db.select().from(units).orderBy(units.id),
        db.select().from(warehouses),
        db.select().from(unitConversions),
        db.select().from(systemSettings),
        db.select({ value: count() }).from(notifications).where(eq(notifications.isRead, false)),
      ]);

    const settingsObj: Record<string, string> = {};
    for (const s of allSettings) {
      settingsObj[s.key] = s.value;
    }

    res.json({
      roles: allRoles,
      categories: allCategories,
      units: allUnits,
      warehouses: allWarehouses,
      unitConversions: allConversions,
      settings: settingsObj,
      unreadNotifications: unreadRows[0]?.value || 0,
    });
  } catch (error) {
    console.error('Meta error:', error);
    res.status(500).json({ error: 'Failed to load metadata' });
  }
});

// Employee list (for dashboard filters when user has DASHBOARD_VIEW or USER_MANAGE)
router.get('/employees', requireAuth, async (req: AuthRequest, res) => {
  try {
    const canSee =
      req.currentUser!.permissions.includes('USER_MANAGE') ||
      req.currentUser!.permissions.includes('DASHBOARD_VIEW') ||
      req.currentUser!.permissions.includes('TX_VIEW_ALL');

    if (!canSee) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        username: users.username,
        roleCode: roles.code,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id));

    res.json({ employees: rows });
  } catch (error) {
    console.error('Employees list error:', error);
    res.status(500).json({ error: 'Failed to load employees' });
  }
});

// User Management (ADMIN only)
router.get('/users', requireAuth, requirePermission('USER_MANAGE'), async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        roleId: users.roleId,
        roleCode: roles.code,
        roleNameAr: roles.nameAr,
        roleNameEn: roles.nameEn,
        isActive: users.isActive,
        failedLoginAttempts: users.failedLoginAttempts,
        lockedUntil: users.lockedUntil,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .orderBy(desc(users.createdAt));

    res.json({ users: rows });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(128),
  roleCode: z.enum(['ADMIN', 'DATA_ENTRY', 'MANAGER']),
});

router.post('/users', requireAuth, requirePermission('USER_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid user payload',
        errorAr: 'بيانات المستخدم غير صالحة (كلمة المرور 8 أحرف على الأقل)',
        details: parsed.error.flatten(),
      });
    }

    const [role] = await db.select().from(roles).where(eq(roles.code, parsed.data.roleCode)).limit(1);
    if (!role) return res.status(400).json({ error: 'Invalid role' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [created] = await db
      .insert(users)
      .values({
        username: parsed.data.username.toLowerCase(),
        email: parsed.data.email.toLowerCase(),
        fullName: parsed.data.fullName,
        passwordHash,
        roleId: role.id,
        isActive: true,
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        fullName: users.fullName,
        isActive: users.isActive,
      });

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'USER_CREATE',
      entity: 'users',
      entityId: created.id,
      newValue: { username: created.username, email: created.email, roleCode: parsed.data.roleCode },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ user: created });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('unique')) {
      return res.status(409).json({
        error: 'Username or email already exists',
        errorAr: 'اسم المستخدم أو البريد الإلكتروني مسجل مسبقاً',
      });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  roleCode: z.enum(['ADMIN', 'DATA_ENTRY', 'MANAGER']).optional(),
  isActive: z.boolean().optional(),
  unlock: z.boolean().optional(),
  newPassword: z.string().min(8).max(128).optional(),
});

router.patch('/users/:id', requireAuth, requirePermission('USER_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update fields' });
    }

    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    let nextRoleId = existing.roleId;
    if (parsed.data.roleCode) {
      const [role] = await db.select().from(roles).where(eq(roles.code, parsed.data.roleCode)).limit(1);
      if (role) nextRoleId = role.id;
    }

    const nextHash = parsed.data.newPassword
      ? await bcrypt.hash(parsed.data.newPassword, 12)
      : existing.passwordHash;

    await db
      .update(users)
      .set({
        fullName: parsed.data.fullName ?? existing.fullName,
        roleId: nextRoleId,
        isActive: parsed.data.isActive ?? existing.isActive,
        failedLoginAttempts: parsed.data.unlock ? 0 : existing.failedLoginAttempts,
        lockedUntil: parsed.data.unlock ? null : existing.lockedUntil,
        passwordHash: nextHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'USER_UPDATE',
      entity: 'users',
      entityId: id,
      previousValue: { isActive: existing.isActive, roleId: existing.roleId },
      newValue: {
        isActive: parsed.data.isActive ?? existing.isActive,
        roleId: nextRoleId,
        passwordReset: Boolean(parsed.data.newPassword),
        unlocked: Boolean(parsed.data.unlock),
      },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Categories CRUD (ADMIN only)
const categorySchema = z.object({
  code: z.string().trim().min(2).max(40),
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  productType: z.enum(['RAW_MATERIAL', 'FINISHED_PRODUCT']),
  description: z.string().trim().max(300).optional().nullable(),
});

router.post('/categories', requireAuth, requirePermission('CATEGORY_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const parsed = categorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid category payload', errorAr: 'بيانات التصنيف غير صالحة' });
    }
    const [created] = await db
      .insert(categories)
      .values({
        code: parsed.data.code.toUpperCase(),
        nameAr: parsed.data.nameAr,
        nameEn: parsed.data.nameEn,
        productType: parsed.data.productType,
        description: parsed.data.description || null,
      })
      .returning();

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'CATEGORY_CREATE',
      entity: 'categories',
      entityId: created.id,
      newValue: created,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ category: created });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(409).json({ error: 'Category code already exists', errorAr: 'كود التصنيف مستخدم بالفعل' });
  }
});

router.patch('/categories/:id', requireAuth, requirePermission('CATEGORY_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { nameAr, nameEn, isActive, description } = req.body;
    const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const [updated] = await db
      .update(categories)
      .set({
        nameAr: nameAr ?? existing.nameAr,
        nameEn: nameEn ?? existing.nameEn,
        description: description !== undefined ? description : existing.description,
        isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
      })
      .where(eq(categories.id, id))
      .returning();

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'CATEGORY_UPDATE',
      entity: 'categories',
      entityId: id,
      previousValue: existing,
      newValue: updated,
      ipAddress: getClientIp(req),
    });

    res.json({ category: updated });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Units CRUD (ADMIN only)
const unitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  nameAr: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(20),
  allowFraction: z.boolean().default(false),
});

router.post('/units', requireAuth, requirePermission('UNIT_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const parsed = unitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid unit payload', errorAr: 'بيانات الوحدة غير صالحة' });
    }
    const [created] = await db
      .insert(units)
      .values({
        code: parsed.data.code.toUpperCase(),
        nameAr: parsed.data.nameAr,
        nameEn: parsed.data.nameEn,
        symbol: parsed.data.symbol,
        allowFraction: parsed.data.allowFraction,
      })
      .returning();

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'UNIT_CREATE',
      entity: 'units',
      entityId: created.id,
      newValue: created,
      ipAddress: getClientIp(req),
    });
    res.status(201).json({ unit: created });
  } catch (error) {
    console.error('Create unit error:', error);
    res.status(409).json({ error: 'Unit code already exists', errorAr: 'كود الوحدة موجود بالفعل' });
  }
});

// Authorized unit conversion rule (ADMIN only)
router.post('/unit-conversions', requireAuth, requirePermission('UNIT_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const fromUnitId = Number(req.body?.fromUnitId);
    const toUnitId = Number(req.body?.toUnitId);
    const factor = Number(req.body?.factor);
    if (!fromUnitId || !toUnitId || fromUnitId === toUnitId || !Number.isFinite(factor) || factor <= 0) {
      return res.status(400).json({ error: 'Invalid conversion rule', errorAr: 'قاعدة التحويل غير صالحة' });
    }

    const [created] = await db
      .insert(unitConversions)
      .values({ fromUnitId, toUnitId, factor: factor.toFixed(6) })
      .returning();

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'UNIT_CONVERSION_CREATE',
      entity: 'unit_conversions',
      entityId: created.id,
      newValue: created,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ conversion: created });
  } catch (error) {
    console.error('Unit conversion error:', error);
    res.status(409).json({ error: 'Conversion rule already exists' });
  }
});

// System Settings (ADMIN only)
router.patch('/settings', requireAuth, requirePermission('SETTINGS_MANAGE'), async (req: AuthRequest, res) => {
  try {
    const updates = req.body?.settings;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings object' });
    }

    for (const [key, value] of Object.entries(updates)) {
      await db
        .insert(systemSettings)
        .values({
          key,
          value: String(value),
          updatedById: req.currentUser!.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value: String(value),
            updatedById: req.currentUser!.id,
            updatedAt: new Date(),
          },
        });
    }

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'SETTINGS_UPDATE',
      entity: 'system_settings',
      newValue: updates,
      ipAddress: getClientIp(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Audit Logs (ADMIN only)
router.get('/audit-logs', requireAuth, requirePermission('AUDIT_VIEW'), async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit || 100)));
    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    res.json({ logs: rows });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

// Notifications
router.get('/notifications', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json({ notifications: rows });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/notifications/:id/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error('Notification mark read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.post('/notifications/mark-all-read', requireAuth, async (_req: AuthRequest, res) => {
  try {
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.isRead, false));
    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

const BACKUP_SYSTEM_ID = 'ELA Inventory Management System (WMS)';
const BACKUP_SCHEMA_VERSION = '1.0';

function getBackupSigningSecret(): string {
  return process.env.SESSION_SECRET || 'ela-wms-backup-integrity-key';
}

function computeBackupChecksums(tables: Record<string, unknown>) {
  const canonical = JSON.stringify(tables);
  const sha256 = crypto.createHash('sha256').update(canonical).digest('hex');
  const signature = crypto
    .createHmac('sha256', getBackupSigningSecret())
    .update(sha256)
    .digest('hex');
  return { sha256, signature };
}

const backupTablesSchema = z.object({
  warehouses: z.array(z.record(z.string(), z.unknown())).min(1),
  categories: z.array(z.record(z.string(), z.unknown())),
  units: z.array(z.record(z.string(), z.unknown())),
  unitConversions: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  products: z.array(z.record(z.string(), z.unknown())),
  inventoryBalances: z.array(z.record(z.string(), z.unknown())),
  stockTransactions: z.array(z.record(z.string(), z.unknown())),
  systemSettings: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  notifications: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  users: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});

const backupEnvelopeSchema = z.object({
  system: z.literal(BACKUP_SYSTEM_ID),
  schemaVersion: z.string().optional().default('1.0'),
  exportedAt: z.string(),
  exportedBy: z.string().optional(),
  sha256: z.string().optional(),
  signature: z.string().optional(),
  tables: backupTablesSchema,
});

function validateSnapshotPayload(raw: unknown) {
  const parsed = backupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false as const,
      checksumVerified: false,
      signatureVerified: false,
      errors: [
        {
          ar: 'صيغة ملف النسخة الاحتياطية غير صالحة أو لا تخص نظام إيلا للمخازن',
          en: 'Invalid backup snapshot format or unrecognized system identifier',
        },
      ],
      warnings: [] as Array<{ ar: string; en: string }>,
    };
  }

  const envelope = parsed.data;
  const { sha256, signature } = computeBackupChecksums(envelope.tables);
  const checksumVerified = envelope.sha256 ? envelope.sha256 === sha256 : true;
  const signatureVerified = envelope.signature ? envelope.signature === signature : false;

  const errors: Array<{ ar: string; en: string }> = [];
  const warnings: Array<{ ar: string; en: string }> = [];

  if (envelope.sha256 && !checksumVerified) {
    errors.push({
      ar: 'فشل التحقق من بصمة SHA-256: الملف تالف أو تم تعديله يدوياً',
      en: 'SHA-256 integrity verification failed: snapshot is corrupted or tampered with',
    });
  }

  if (envelope.signature && !signatureVerified) {
    warnings.push({
      ar: 'تم تصدير النسخة من بيئة أو مفتاح توقيع مختلف، سيتم التحقق عبر بصمة SHA-256',
      en: 'Snapshot signature was created with a different environment key; SHA-256 digest verified',
    });
  }

  // Referential integrity checks inside snapshot
  const whIds = new Set(envelope.tables.warehouses.map((w) => Number(w.id)));
  const catIds = new Set(envelope.tables.categories.map((c) => Number(c.id)));
  const unitIds = new Set(envelope.tables.units.map((u) => Number(u.id)));
  const prodIds = new Set(envelope.tables.products.map((p) => Number(p.id)));

  for (const prod of envelope.tables.products) {
    if (!catIds.has(Number(prod.categoryId))) {
      errors.push({
        ar: `المنتج ${String(prod.productCode)} يشير إلى تصنيف غير موجود في النسخة`,
        en: `Product ${String(prod.productCode)} references a missing category`,
      });
      break;
    }
    if (!unitIds.has(Number(prod.unitId))) {
      errors.push({
        ar: `المنتج ${String(prod.productCode)} يشير إلى وحدة غير موجودة في النسخة`,
        en: `Product ${String(prod.productCode)} references a missing unit`,
      });
      break;
    }
  }

  for (const bal of envelope.tables.inventoryBalances) {
    if (!whIds.has(Number(bal.warehouseId)) || !prodIds.has(Number(bal.productId))) {
      errors.push({
        ar: 'توجد أرصدة مخزون تشير إلى منتجات أو مستودعات غير موجودة في النسخة',
        en: 'Inventory balances reference missing products or warehouses',
      });
      break;
    }
    if (Number(bal.currentStock) < 0) {
      errors.push({
        ar: 'تحتوي النسخة على أرصدة سالبة غير مسموح بها',
        en: 'Snapshot contains invalid negative stock balances',
      });
      break;
    }
  }

  for (const tx of envelope.tables.stockTransactions) {
    if (!whIds.has(Number(tx.warehouseId)) || !prodIds.has(Number(tx.productId))) {
      errors.push({
        ar: 'توجد حركات مخزنية تشير إلى منتجات أو مستودعات غير موجودة في النسخة',
        en: 'Stock transactions reference missing products or warehouses',
      });
      break;
    }
  }

  const counts = {
    warehouses: envelope.tables.warehouses.length,
    categories: envelope.tables.categories.length,
    units: envelope.tables.units.length,
    unitConversions: envelope.tables.unitConversions.length,
    products: envelope.tables.products.length,
    inventoryBalances: envelope.tables.inventoryBalances.length,
    stockTransactions: envelope.tables.stockTransactions.length,
    systemSettings: envelope.tables.systemSettings.length,
    users: envelope.tables.users.length,
  };

  return {
    valid: errors.length === 0,
    checksumVerified,
    signatureVerified,
    exportedAt: envelope.exportedAt,
    exportedBy: envelope.exportedBy || 'unknown',
    schemaVersion: envelope.schemaVersion,
    counts,
    warnings,
    errors,
    envelope,
  };
}

// Live database summary for Admin Backup Console
router.get(
  '/backup/summary',
  requireAuth,
  requireRole('ADMIN'),
  requirePermission('SETTINGS_MANAGE'),
  async (_req: AuthRequest, res) => {
    try {
      const [
        whCount,
        catCount,
        unitCount,
        prodCount,
        balCount,
        txCount,
        userCount,
        recentEvents,
      ] = await Promise.all([
        db.select({ value: count() }).from(warehouses),
        db.select({ value: count() }).from(categories),
        db.select({ value: count() }).from(units),
        db.select({ value: count() }).from(products),
        db.select({ value: count() }).from(inventoryBalances),
        db.select({ value: count() }).from(stockTransactions),
        db.select({ value: count() }).from(users),
        db
          .select({
            id: auditLogs.id,
            username: auditLogs.username,
            action: auditLogs.action,
            newValue: auditLogs.newValue,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(
            sql`${auditLogs.action} IN ('DATABASE_BACKUP_EXPORT', 'DATABASE_BACKUP_RESTORE')`,
          )
          .orderBy(desc(auditLogs.createdAt))
          .limit(10),
      ]);

      res.json({
        counts: {
          warehouses: whCount[0]?.value || 0,
          categories: catCount[0]?.value || 0,
          units: unitCount[0]?.value || 0,
          products: prodCount[0]?.value || 0,
          inventoryBalances: balCount[0]?.value || 0,
          stockTransactions: txCount[0]?.value || 0,
          users: userCount[0]?.value || 0,
        },
        recentEvents,
      });
    } catch (error) {
      console.error('Backup summary error:', error);
      res.status(500).json({ error: 'Failed to load backup summary' });
    }
  },
);

// Database JSON Snapshot Export (ADMIN only, never includes password hashes or session tokens)
router.get(
  '/backup',
  requireAuth,
  requireRole('ADMIN'),
  requirePermission('SETTINGS_MANAGE'),
  async (req: AuthRequest, res) => {
    try {
      const [
        allWarehouses,
        allCategories,
        allUnits,
        allConversions,
        allProducts,
        allBalances,
        allTransactions,
        allSettings,
        allNotifications,
        allUsersSafe,
      ] = await Promise.all([
        db.select().from(warehouses).orderBy(warehouses.id),
        db.select().from(categories).orderBy(categories.id),
        db.select().from(units).orderBy(units.id),
        db.select().from(unitConversions).orderBy(unitConversions.id),
        db.select().from(products).orderBy(products.id),
        db.select().from(inventoryBalances).orderBy(inventoryBalances.id),
        db.select().from(stockTransactions).orderBy(stockTransactions.id),
        db.select().from(systemSettings).orderBy(systemSettings.id),
        db.select().from(notifications).orderBy(notifications.id),
        db
          .select({
            id: users.id,
            uid: users.uid,
            username: users.username,
            email: users.email,
            fullName: users.fullName,
            roleId: users.roleId,
            roleCode: roles.code,
            isActive: users.isActive,
            createdAt: users.createdAt,
          })
          .from(users)
          .innerJoin(roles, eq(users.roleId, roles.id))
          .orderBy(users.id),
      ]);

      const tables = {
        warehouses: allWarehouses,
        categories: allCategories,
        units: allUnits,
        unitConversions: allConversions,
        products: allProducts,
        inventoryBalances: allBalances,
        stockTransactions: allTransactions,
        systemSettings: allSettings,
        notifications: allNotifications,
        users: allUsersSafe,
      };

      const { sha256, signature } = computeBackupChecksums(tables);
      const counts = {
        warehouses: allWarehouses.length,
        categories: allCategories.length,
        units: allUnits.length,
        unitConversions: allConversions.length,
        products: allProducts.length,
        inventoryBalances: allBalances.length,
        stockTransactions: allTransactions.length,
        systemSettings: allSettings.length,
        notifications: allNotifications.length,
        users: allUsersSafe.length,
      };

      await recordAuditLog({
        userId: req.currentUser!.id,
        username: req.currentUser!.username,
        action: 'DATABASE_BACKUP_EXPORT',
        entity: 'system',
        newValue: { sha256, counts },
        ipAddress: getClientIp(req),
      });

      const snapshot = {
        system: BACKUP_SYSTEM_ID,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: req.currentUser!.username,
        sha256,
        signature,
        counts,
        tables,
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="ELA_WMS_Snapshot_${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.send(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      console.error('Backup export error:', error);
      res.status(500).json({
        error: 'Failed to export database snapshot',
        errorAr: 'فشل تصدير النسخة الاحتياطية لقاعدة البيانات',
      });
    }
  },
);

// Validate Uploaded Backup Snapshot (Dry-run, ADMIN only)
router.post(
  '/backup/validate',
  requireAuth,
  requireRole('ADMIN'),
  requirePermission('SETTINGS_MANAGE'),
  async (req: AuthRequest, res) => {
    try {
      const result = validateSnapshotPayload(req.body?.snapshot);
      if (!result.valid) {
        return res.status(400).json({
          valid: false,
          checksumVerified: result.checksumVerified,
          signatureVerified: result.signatureVerified,
          warnings: result.warnings,
          errors: result.errors,
        });
      }

      return res.json({
        valid: true,
        checksumVerified: result.checksumVerified,
        signatureVerified: result.signatureVerified,
        exportedAt: result.exportedAt,
        exportedBy: result.exportedBy,
        schemaVersion: result.schemaVersion,
        counts: result.counts,
        warnings: result.warnings,
        errors: [],
      });
    } catch (error) {
      console.error('Backup validation error:', error);
      return res.status(500).json({
        error: 'Failed to validate backup file',
        errorAr: 'فشل فحص ملف النسخة الاحتياطية',
      });
    }
  },
);

// Restore Database from Authorized Backup Snapshot (Atomic transaction, ADMIN only)
const restoreSchema = z.object({
  mode: z.enum(['MERGE', 'REPLACE']),
  confirmationPhrase: z.string().optional(),
  snapshot: z.unknown(),
});

router.post(
  '/backup/restore',
  requireAuth,
  requireRole('ADMIN'),
  requirePermission('SETTINGS_MANAGE'),
  async (req: AuthRequest, res) => {
    try {
      const parsedReq = restoreSchema.safeParse(req.body);
      if (!parsedReq.success) {
        return res.status(400).json({
          error: 'Invalid restore request',
          errorAr: 'طلب الاستعادة غير صالح',
        });
      }

      const { mode, confirmationPhrase, snapshot } = parsedReq.data;
      if (mode === 'REPLACE') {
        const phrase = (confirmationPhrase || '').trim().toUpperCase();
        if (phrase !== 'RESTORE' && phrase !== 'استعادة') {
          return res.status(400).json({
            error: 'Please type RESTORE to confirm full maintenance restore',
            errorAr: 'يرجى كتابة كلمة (استعادة) أو (RESTORE) لتأكيد الاستعادة الكاملة',
          });
        }
      }

      const validation = validateSnapshotPayload(snapshot);
      if (!validation.valid || !validation.envelope) {
        return res.status(400).json({
          error: validation.errors[0]?.en || 'Invalid snapshot',
          errorAr: validation.errors[0]?.ar || 'ملف النسخة الاحتياطية غير صالح',
          errors: validation.errors,
        });
      }

      const tables = validation.envelope.tables;
      const currentAdminId = req.currentUser!.id;

      const summary = await db.transaction(async (tx) => {
        if (mode === 'REPLACE') {
          // Clear operational & catalog tables in FK order while preserving roles, permissions, and current admin session
          await tx.delete(notifications);
          await tx.delete(stockTransactions);
          await tx.delete(inventoryBalances);
          await tx.delete(products);
          await tx.delete(unitConversions);
          await tx.delete(categories);
          await tx.delete(units);
          await tx.delete(warehouses);
          await tx.delete(systemSettings);
        }

        // 1. Warehouses (map old id -> new id via code)
        const whIdMap = new Map<number, number>();
        for (const w of tables.warehouses) {
          const code = String(w.code);
          const [upserted] = await tx
            .insert(warehouses)
            .values({
              code,
              nameAr: String(w.nameAr),
              nameEn: String(w.nameEn),
              location: w.location ? String(w.location) : null,
              isDefault: Boolean(w.isDefault),
              isActive: w.isActive !== undefined ? Boolean(w.isActive) : true,
            })
            .onConflictDoUpdate({
              target: warehouses.code,
              set: {
                nameAr: String(w.nameAr),
                nameEn: String(w.nameEn),
                location: w.location ? String(w.location) : null,
                isDefault: Boolean(w.isDefault),
                isActive: w.isActive !== undefined ? Boolean(w.isActive) : true,
              },
            })
            .returning();
          whIdMap.set(Number(w.id), upserted.id);
        }

        // 2. Categories (map old id -> new id via code)
        const catIdMap = new Map<number, number>();
        for (const c of tables.categories) {
          const code = String(c.code);
          const [upserted] = await tx
            .insert(categories)
            .values({
              code,
              nameAr: String(c.nameAr),
              nameEn: String(c.nameEn),
              productType: String(c.productType),
              description: c.description ? String(c.description) : null,
              isActive: c.isActive !== undefined ? Boolean(c.isActive) : true,
            })
            .onConflictDoUpdate({
              target: categories.code,
              set: {
                nameAr: String(c.nameAr),
                nameEn: String(c.nameEn),
                productType: String(c.productType),
                description: c.description ? String(c.description) : null,
                isActive: c.isActive !== undefined ? Boolean(c.isActive) : true,
              },
            })
            .returning();
          catIdMap.set(Number(c.id), upserted.id);
        }

        // 3. Units (map old id -> new id via code)
        const unitIdMap = new Map<number, number>();
        for (const u of tables.units) {
          const code = String(u.code);
          const [upserted] = await tx
            .insert(units)
            .values({
              code,
              nameAr: String(u.nameAr),
              nameEn: String(u.nameEn),
              symbol: String(u.symbol),
              allowFraction: Boolean(u.allowFraction),
              isActive: u.isActive !== undefined ? Boolean(u.isActive) : true,
            })
            .onConflictDoUpdate({
              target: units.code,
              set: {
                nameAr: String(u.nameAr),
                nameEn: String(u.nameEn),
                symbol: String(u.symbol),
                allowFraction: Boolean(u.allowFraction),
                isActive: u.isActive !== undefined ? Boolean(u.isActive) : true,
              },
            })
            .returning();
          unitIdMap.set(Number(u.id), upserted.id);
        }

        // 4. Unit Conversions
        for (const conv of tables.unitConversions) {
          const fromId = unitIdMap.get(Number(conv.fromUnitId));
          const toId = unitIdMap.get(Number(conv.toUnitId));
          if (fromId && toId) {
            await tx
              .insert(unitConversions)
              .values({
                fromUnitId: fromId,
                toUnitId: toId,
                factor: Number(conv.factor).toFixed(6),
                isActive: conv.isActive !== undefined ? Boolean(conv.isActive) : true,
              })
              .onConflictDoNothing();
          }
        }

        // 5. Users mapping (map old userId -> current DB userId by username/email, fallback to currentAdminId)
        const allDbRoles = await tx.select().from(roles);
        const roleByCode = new Map(allDbRoles.map((r) => [r.code, r.id]));
        const existingUsers = await tx.select().from(users);
        const userByUsername = new Map(existingUsers.map((u) => [u.username.toLowerCase(), u.id]));
        const userByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u.id]));
        const userIdMap = new Map<number, number>();

        for (const bu of tables.users) {
          const uname = String(bu.username || '').toLowerCase();
          const uemail = String(bu.email || '').toLowerCase();
          const existingId = userByUsername.get(uname) ?? userByEmail.get(uemail);
          if (existingId) {
            userIdMap.set(Number(bu.id), existingId);
          } else if (uname && uemail) {
            const targetRoleId =
              roleByCode.get(String(bu.roleCode || 'MANAGER')) ??
              roleByCode.get('MANAGER')!;
            const [createdUser] = await tx
              .insert(users)
              .values({
                uid: bu.uid ? String(bu.uid) : null,
                username: uname,
                email: uemail,
                fullName: String(bu.fullName || uname),
                roleId: targetRoleId,
                isActive: bu.isActive !== undefined ? Boolean(bu.isActive) : true,
              })
              .onConflictDoNothing()
              .returning();
            if (createdUser) {
              userIdMap.set(Number(bu.id), createdUser.id);
              userByUsername.set(uname, createdUser.id);
            }
          }
        }

        // 6. Products (map old productId -> new productId via productCode)
        const prodIdMap = new Map<number, number>();
        let restoredProducts = 0;
        for (const p of tables.products) {
          const mappedCatId = catIdMap.get(Number(p.categoryId));
          const mappedUnitId = unitIdMap.get(Number(p.unitId));
          if (!mappedCatId || !mappedUnitId) continue;

          const createdById = userIdMap.get(Number(p.createdById)) ?? currentAdminId;
          const productCode = String(p.productCode).toUpperCase();
          const [upserted] = await tx
            .insert(products)
            .values({
              productCode,
              barcode: p.barcode ? String(p.barcode) : null,
              name: String(p.name),
              productType: String(p.productType),
              categoryId: mappedCatId,
              unitId: mappedUnitId,
              minimumStock: Number(p.minimumStock || 0).toFixed(3),
              description: p.description ? String(p.description) : null,
              imageUrl: p.imageUrl ? String(p.imageUrl) : null,
              status: p.status ? String(p.status) : 'ACTIVE',
              createdById,
            })
            .onConflictDoUpdate({
              target: products.productCode,
              set: {
                barcode: p.barcode ? String(p.barcode) : null,
                name: String(p.name),
                categoryId: mappedCatId,
                unitId: mappedUnitId,
                minimumStock: Number(p.minimumStock || 0).toFixed(3),
                description: p.description ? String(p.description) : null,
                imageUrl: p.imageUrl ? String(p.imageUrl) : null,
                status: p.status ? String(p.status) : 'ACTIVE',
                updatedAt: new Date(),
              },
            })
            .returning();
          prodIdMap.set(Number(p.id), upserted.id);
          restoredProducts++;
        }

        // 7. Stock Transactions (immutable insert on conflict do nothing by transactionNumber)
        let restoredTransactions = 0;
        const txIdMap = new Map<number, number>();
        if (mode === 'MERGE') {
          const existingTxs = await tx
            .select({ id: stockTransactions.id, transactionNumber: stockTransactions.transactionNumber })
            .from(stockTransactions);
          const existingByNum = new Map(existingTxs.map((et) => [et.transactionNumber, et.id]));
          for (const t of tables.stockTransactions) {
            const matchId = existingByNum.get(String(t.transactionNumber));
            if (matchId) txIdMap.set(Number(t.id), matchId);
          }
        }

        const orderedTransactions = [...tables.stockTransactions].sort(
          (a, b) => Number(a.id || 0) - Number(b.id || 0),
        );
        for (const t of orderedTransactions) {
          const whId = whIdMap.get(Number(t.warehouseId));
          const prodId = prodIdMap.get(Number(t.productId));
          if (!whId || !prodId) continue;
          const txUserId = userIdMap.get(Number(t.userId)) ?? currentAdminId;
          const mappedReversedId = t.reversedTransactionId
            ? (txIdMap.get(Number(t.reversedTransactionId)) ?? null)
            : null;

          const inserted = await tx
            .insert(stockTransactions)
            .values({
              transactionNumber: String(t.transactionNumber),
              warehouseId: whId,
              productId: prodId,
              transactionType: String(t.transactionType),
              quantity: Number(t.quantity).toFixed(3),
              previousBalance: Number(t.previousBalance).toFixed(3),
              newBalance: Number(t.newBalance).toFixed(3),
              reason: String(t.reason),
              destination: t.destination ? String(t.destination) : null,
              referenceNumber: t.referenceNumber ? String(t.referenceNumber) : null,
              notes: t.notes ? String(t.notes) : null,
              idempotencyKey: t.idempotencyKey ? String(t.idempotencyKey) : null,
              reversedTransactionId: mappedReversedId,
              userId: txUserId,
              createdAt: t.createdAt ? new Date(String(t.createdAt)) : new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: stockTransactions.id });

          if (inserted.length > 0) {
            txIdMap.set(Number(t.id), inserted[0].id);
            restoredTransactions++;
          }
        }

        // 8. Inventory Balances (reconcile from snapshot in REPLACE mode, or safely recalculate from ledger in MERGE mode)
        let restoredBalances = 0;
        for (const b of tables.inventoryBalances) {
          const whId = whIdMap.get(Number(b.warehouseId));
          const prodId = prodIdMap.get(Number(b.productId));
          if (!whId || !prodId) continue;

          if (mode === 'REPLACE') {
            await tx
              .insert(inventoryBalances)
              .values({
                warehouseId: whId,
                productId: prodId,
                openingBalance: Number(b.openingBalance || 0).toFixed(3),
                totalIn: Number(b.totalIn || 0).toFixed(3),
                totalOut: Number(b.totalOut || 0).toFixed(3),
                currentStock: Number(b.currentStock || 0).toFixed(3),
              })
              .onConflictDoUpdate({
                target: [inventoryBalances.warehouseId, inventoryBalances.productId],
                set: {
                  openingBalance: Number(b.openingBalance || 0).toFixed(3),
                  totalIn: Number(b.totalIn || 0).toFixed(3),
                  totalOut: Number(b.totalOut || 0).toFixed(3),
                  currentStock: Number(b.currentStock || 0).toFixed(3),
                  updatedAt: new Date(),
                },
              });
            restoredBalances++;
          } else {
            // In MERGE mode, recompute authoritative balance from stock_transactions if transactions exist, else insert snapshot balance if missing
            const ledgerAgg = await tx
              .select({
                opening: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} = 'OPENING_BALANCE' THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
                totalIn: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
                totalOut: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
                txCount: count(),
              })
              .from(stockTransactions)
              .where(
                sql`${stockTransactions.warehouseId} = ${whId} AND ${stockTransactions.productId} = ${prodId}`,
              );

            const agg = ledgerAgg[0];
            if (agg && agg.txCount > 0) {
              const op = Number(agg.opening);
              const ti = Number(agg.totalIn);
              const to = Number(agg.totalOut);
              const cur = Math.max(0, op + ti - to);
              await tx
                .insert(inventoryBalances)
                .values({
                  warehouseId: whId,
                  productId: prodId,
                  openingBalance: op.toFixed(3),
                  totalIn: ti.toFixed(3),
                  totalOut: to.toFixed(3),
                  currentStock: cur.toFixed(3),
                })
                .onConflictDoUpdate({
                  target: [inventoryBalances.warehouseId, inventoryBalances.productId],
                  set: {
                    openingBalance: op.toFixed(3),
                    totalIn: ti.toFixed(3),
                    totalOut: to.toFixed(3),
                    currentStock: cur.toFixed(3),
                    updatedAt: new Date(),
                  },
                });
            } else {
              await tx
                .insert(inventoryBalances)
                .values({
                  warehouseId: whId,
                  productId: prodId,
                  openingBalance: Number(b.openingBalance || 0).toFixed(3),
                  totalIn: Number(b.totalIn || 0).toFixed(3),
                  totalOut: Number(b.totalOut || 0).toFixed(3),
                  currentStock: Number(b.currentStock || 0).toFixed(3),
                })
                .onConflictDoNothing();
            }
            restoredBalances++;
          }
        }

        // 9. System Settings
        for (const s of tables.systemSettings) {
          if (!s.key) continue;
          await tx
            .insert(systemSettings)
            .values({
              key: String(s.key),
              value: String(s.value ?? ''),
              description: s.description ? String(s.description) : null,
              updatedById: currentAdminId,
            })
            .onConflictDoUpdate({
              target: systemSettings.key,
              set: {
                value: String(s.value ?? ''),
                updatedById: currentAdminId,
                updatedAt: new Date(),
              },
            });
        }

        await recordAuditLog(
          {
            userId: currentAdminId,
            username: req.currentUser!.username,
            action: 'DATABASE_BACKUP_RESTORE',
            entity: 'system',
            newValue: {
              mode,
              snapshotExportedAt: validation.exportedAt,
              restoredProducts,
              restoredBalances,
              restoredTransactions,
            },
            ipAddress: getClientIp(req),
          },
          tx as unknown as typeof db,
        );

        return {
          restoredProducts,
          restoredBalances,
          restoredTransactions,
        };
      });

      return res.json({
        success: true,
        mode,
        summary,
      });
    } catch (error) {
      console.error('Backup restore error:', error);
      return res.status(500).json({
        error: 'Failed to restore backup snapshot',
        errorAr: 'فشلت عملية استعادة النسخة الاحتياطية؛ لم يتم تطبيق أي تغييرات جزئية',
      });
    }
  },
);

export default router;
