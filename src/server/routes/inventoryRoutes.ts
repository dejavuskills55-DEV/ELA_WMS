import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  categories,
  inventoryBalances,
  products,
  stockTransactions,
  units,
  users,
  warehouses,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
} from '../../middleware/auth.ts';
import { getClientIp } from '../audit.ts';
import {
  InventoryError,
  executeStockMovement,
  reverseStockTransaction,
} from '../inventoryEngine.ts';

const router = Router();

const stockMovementSchema = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
  reason: z.string().trim().min(1).max(160),
  destination: z.string().trim().max(160).optional().nullable(),
  referenceNumber: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  idempotencyKey: z.string().trim().max(120).optional().nullable(),
});

const adjustmentSchema = stockMovementSchema.extend({
  adjustmentType: z.enum(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_BALANCE']),
});

const reversalSchema = z.object({
  reason: z.string().trim().min(3).max(250),
});

function handleInventoryError(res: import('express').Response, error: unknown) {
  if (error instanceof InventoryError) {
    return res.status(error.statusCode).json({
      error: error.message,
      errorAr: error.messageAr,
    });
  }
  console.error('Inventory route error:', error);
  return res.status(500).json({
    error: 'Internal inventory engine error',
    errorAr: 'حدث خطأ داخلي في محرك المخزون',
  });
}

// Stock In
router.post('/stock-in', requireAuth, requirePermission('STOCK_IN'), async (req: AuthRequest, res) => {
  try {
    const parsed = stockMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid stock-in fields',
        errorAr: 'يرجى التأكد من إدخال الكمية والسبب بشكل صحيح',
        details: parsed.error.flatten(),
      });
    }

    const result = await executeStockMovement({
      productId: parsed.data.productId,
      transactionType: 'STOCK_IN',
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      referenceNumber: parsed.data.referenceNumber,
      notes: parsed.data.notes,
      idempotencyKey: parsed.data.idempotencyKey,
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ receipt: result });
  } catch (error) {
    return handleInventoryError(res, error);
  }
});

// Stock Out
router.post('/stock-out', requireAuth, requirePermission('STOCK_OUT'), async (req: AuthRequest, res) => {
  try {
    const parsed = stockMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid stock-out fields',
        errorAr: 'يرجى التأكد من إدخال الكمية والسبب بشكل صحيح',
        details: parsed.error.flatten(),
      });
    }

    const result = await executeStockMovement({
      productId: parsed.data.productId,
      transactionType: 'STOCK_OUT',
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      destination: parsed.data.destination,
      referenceNumber: parsed.data.referenceNumber,
      notes: parsed.data.notes,
      idempotencyKey: parsed.data.idempotencyKey,
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ receipt: result });
  } catch (error) {
    return handleInventoryError(res, error);
  }
});

// Authorized Inventory Adjustment (ADMIN only)
router.post(
  '/adjustment',
  requireAuth,
  requirePermission('STOCK_ADJUST'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = adjustmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Invalid adjustment payload',
          errorAr: 'بيانات التسوية غير صالحة',
          details: parsed.error.flatten(),
        });
      }

      const result = await executeStockMovement({
        productId: parsed.data.productId,
        transactionType: parsed.data.adjustmentType,
        quantity: parsed.data.quantity,
        reason: parsed.data.reason,
        destination: parsed.data.destination,
        referenceNumber: parsed.data.referenceNumber,
        notes: parsed.data.notes,
        idempotencyKey: parsed.data.idempotencyKey,
        userId: req.currentUser!.id,
        username: req.currentUser!.username,
        ipAddress: getClientIp(req),
      });

      return res.status(201).json({ receipt: result });
    } catch (error) {
      return handleInventoryError(res, error);
    }
  },
);

// Immutable Transaction Reversal (ADMIN only)
router.post(
  '/reverse/:transactionId',
  requireAuth,
  requirePermission('STOCK_ADJUST'),
  async (req: AuthRequest, res) => {
    try {
      const txId = Number(req.params.transactionId);
      if (!Number.isInteger(txId) || txId <= 0) {
        return res.status(400).json({ error: 'Invalid transaction ID' });
      }

      const parsed = reversalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Reversal reason is required',
          errorAr: 'يرجى إدخال سبب عكس الحركة (3 أحرف على الأقل)',
        });
      }

      const reversalTx = await reverseStockTransaction({
        transactionId: txId,
        reason: parsed.data.reason,
        userId: req.currentUser!.id,
        username: req.currentUser!.username,
        ipAddress: getClientIp(req),
      });

      return res.status(201).json({ reversal: reversalTx });
    } catch (error) {
      return handleInventoryError(res, error);
    }
  },
);

// Transaction History (enforces personal-only view for DATA_ENTRY)
router.get('/transactions', requireAuth, async (req: AuthRequest, res) => {
  try {
    const canViewAll = req.currentUser!.permissions.includes('TX_VIEW_ALL');
    const canViewOwn = req.currentUser!.permissions.includes('TX_VIEW_OWN');
    if (!canViewAll && !canViewOwn) {
      return res.status(403).json({
        error: 'Access denied',
        errorAr: 'ليس لديك صلاحية عرض سجل الحركات',
      });
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const productType = typeof req.query.productType === 'string' ? req.query.productType : '';
    const transactionType =
      typeof req.query.transactionType === 'string' ? req.query.transactionType : '';
    const productId = req.query.productId ? Number(req.query.productId) : null;
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const referenceNumber =
      typeof req.query.referenceNumber === 'string' ? req.query.referenceNumber.trim() : '';
    const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : '';
    const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : '';
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));

    const conditions = [];

    // Strict backend isolation: Data Entry employees ONLY see their own transactions
    if (!canViewAll) {
      conditions.push(eq(stockTransactions.userId, req.currentUser!.id));
    } else if (employeeId) {
      conditions.push(eq(stockTransactions.userId, employeeId));
    }

    if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
      conditions.push(eq(products.productType, productType));
    }
    if (transactionType) {
      conditions.push(eq(stockTransactions.transactionType, transactionType));
    }
    if (productId) {
      conditions.push(eq(stockTransactions.productId, productId));
    }
    if (referenceNumber) {
      conditions.push(ilike(stockTransactions.referenceNumber, `%${referenceNumber}%`));
    }
    if (fromDate) {
      conditions.push(gte(stockTransactions.createdAt, new Date(`${fromDate}T00:00:00.000Z`)));
    }
    if (toDate) {
      conditions.push(lte(stockTransactions.createdAt, new Date(`${toDate}T23:59:59.999Z`)));
    }
    if (search) {
      conditions.push(
        or(
          ilike(stockTransactions.transactionNumber, `%${search}%`),
          ilike(products.productCode, `%${search}%`),
          ilike(products.barcode, `%${search}%`),
          ilike(products.name, `%${search}%`),
          ilike(users.fullName, `%${search}%`),
          ilike(stockTransactions.referenceNumber, `%${search}%`),
        ),
      );
    }

    const rows = await db
      .select({
        id: stockTransactions.id,
        transactionNumber: stockTransactions.transactionNumber,
        productId: stockTransactions.productId,
        productCode: products.productCode,
        barcode: products.barcode,
        productName: products.name,
        productType: products.productType,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        transactionType: stockTransactions.transactionType,
        quantity: stockTransactions.quantity,
        previousBalance: stockTransactions.previousBalance,
        newBalance: stockTransactions.newBalance,
        reason: stockTransactions.reason,
        destination: stockTransactions.destination,
        referenceNumber: stockTransactions.referenceNumber,
        notes: stockTransactions.notes,
        reversedTransactionId: stockTransactions.reversedTransactionId,
        userId: stockTransactions.userId,
        employeeName: users.fullName,
        employeeUsername: users.username,
        createdAt: stockTransactions.createdAt,
      })
      .from(stockTransactions)
      .innerJoin(products, eq(stockTransactions.productId, products.id))
      .innerJoin(units, eq(products.unitId, units.id))
      .innerJoin(users, eq(stockTransactions.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(stockTransactions.createdAt))
      .limit(limit);

    // Also identify which transactions have already been reversed
    const reversedRows = await db
      .select({ reversedTransactionId: stockTransactions.reversedTransactionId })
      .from(stockTransactions)
      .where(sql`${stockTransactions.reversedTransactionId} IS NOT NULL`);
    const reversedSet = new Set(reversedRows.map((r) => r.reversedTransactionId));

    res.json({
      transactions: rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        previousBalance: Number(r.previousBalance),
        newBalance: Number(r.newBalance),
        isReversed: reversedSet.has(r.id),
      })),
    });
  } catch (error) {
    console.error('Transactions query error:', error);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

// Low Stock & Out of Stock Alerts
router.get('/alerts', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const [defaultWh] = await db
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.isDefault, true))
      .limit(1);
    if (!defaultWh) return res.json({ alerts: [] });

    const rows = await db
      .select({
        productId: products.id,
        productCode: products.productCode,
        productName: products.name,
        productType: products.productType,
        categoryNameAr: categories.nameAr,
        unitNameAr: units.nameAr,
        unitCode: units.code,
        minimumStock: products.minimumStock,
        currentStock: sql<string>`COALESCE(${inventoryBalances.currentStock}, 0)`,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .innerJoin(units, eq(products.unitId, units.id))
      .leftJoin(
        inventoryBalances,
        and(
          eq(inventoryBalances.productId, products.id),
          eq(inventoryBalances.warehouseId, defaultWh.id),
        ),
      )
      .where(eq(products.status, 'ACTIVE'));

    const alerts = rows
      .map((r) => {
        const current = Number(r.currentStock);
        const min = Number(r.minimumStock);
        const alertType =
          current === 0 ? 'OUT_OF_STOCK' : min > 0 && current <= min ? 'LOW_STOCK' : null;
        if (!alertType) return null;
        return {
          ...r,
          currentStock: current,
          minimumStock: min,
          shortageAmount: Math.max(0, Number((min - current).toFixed(3))),
          alertType,
        };
      })
      .filter(Boolean);

    res.json({ alerts });
  } catch (error) {
    console.error('Alerts query error:', error);
    res.status(500).json({ error: 'Failed to load stock alerts' });
  }
});

export default router;
