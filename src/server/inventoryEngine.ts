import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  inventoryBalances,
  notifications,
  products,
  stockTransactions,
  units,
  warehouses,
} from '../db/schema.ts';
import { recordAuditLog } from './audit.ts';

export type StockOperationType =
  | 'OPENING_BALANCE'
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'REVERSAL';

export class InventoryError extends Error {
  statusCode: number;
  messageAr: string;
  constructor(statusCode: number, messageEn: string, messageAr: string) {
    super(messageEn);
    this.statusCode = statusCode;
    this.messageAr = messageAr;
  }
}

function toMillis(val: string | number): number {
  const num = typeof val === 'string' ? Number(val) : val;
  if (!Number.isFinite(num)) {
    throw new InventoryError(400, 'Invalid numeric quantity', 'الكمية المدخلة غير صالحة');
  }
  return Math.round(num * 1000);
}

function fromMillis(m: number): string {
  return (m / 1000).toFixed(3);
}

function formatQtyDisplay(m: number): string {
  return (m / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function makeTransactionNumber(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `TXN-${y}${m}${d}-${rand}`;
}

export interface ExecuteStockMovementParams {
  productId: number;
  warehouseId?: number;
  transactionType: StockOperationType;
  quantity: number;
  reason: string;
  destination?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  reversedTransactionId?: number | null;
  userId: number;
  username: string;
  ipAddress?: string | null;
}

export async function executeStockMovement(params: ExecuteStockMovementParams) {
  const qtyMillis = toMillis(params.quantity);
  if (qtyMillis <= 0) {
    throw new InventoryError(
      400,
      'Quantity must be greater than zero',
      'يجب أن تكون الكمية أكبر من الصفر',
    );
  }

  return await db.transaction(async (tx) => {
    // 1. Idempotency check to prevent duplicate submissions
    if (params.idempotencyKey) {
      const existing = await tx
        .select()
        .from(stockTransactions)
        .where(eq(stockTransactions.idempotencyKey, params.idempotencyKey))
        .limit(1);

      if (existing.length > 0) {
        throw new InventoryError(
          409,
          'Duplicate transaction submission prevented',
          'تم منع تكرار إرسال نفس الحركة المخزنية',
        );
      }
    }

    // 2. Resolve warehouse (default central warehouse if omitted)
    let warehouseId = params.warehouseId;
    if (!warehouseId) {
      const [defaultWh] = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.isDefault, true))
        .limit(1);
      if (!defaultWh) {
        throw new InventoryError(500, 'Default warehouse not found', 'لم يتم العثور على المستودع الرئيسي');
      }
      warehouseId = defaultWh.id;
    }

    // 3. Load and verify product + unit
    const prodRows = await tx
      .select({
        id: products.id,
        productCode: products.productCode,
        name: products.name,
        productType: products.productType,
        status: products.status,
        minimumStock: products.minimumStock,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        allowFraction: units.allowFraction,
      })
      .from(products)
      .innerJoin(units, eq(products.unitId, units.id))
      .where(eq(products.id, params.productId))
      .limit(1);

    if (prodRows.length === 0) {
      throw new InventoryError(404, 'Product not found', 'المنتج غير موجود');
    }
    const product = prodRows[0];

    if (product.status !== 'ACTIVE') {
      throw new InventoryError(
        400,
        'Product is inactive and cannot have stock movements',
        'المنتج غير نشط ولا يمكن تسجيل حركات مخزنية عليه',
      );
    }

    if (!product.allowFraction && qtyMillis % 1000 !== 0) {
      throw new InventoryError(
        400,
        `Unit ${product.unitNameEn} does not allow fractional quantities`,
        `وحدة القياس (${product.unitNameAr}) لا تقبل الكسور العشرية`,
      );
    }

    // 4. Lock inventory balance row FOR UPDATE to serialize concurrent updates
    const balanceRows = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.warehouseId, warehouseId),
          eq(inventoryBalances.productId, product.id),
        ),
      )
      .for('update');

    let balance = balanceRows[0];
    if (!balance) {
      const [inserted] = await tx
        .insert(inventoryBalances)
        .values({
          warehouseId,
          productId: product.id,
          openingBalance: '0.000',
          totalIn: '0.000',
          totalOut: '0.000',
          currentStock: '0.000',
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) {
        balance = inserted;
      } else {
        const [locked] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouseId),
              eq(inventoryBalances.productId, product.id),
            ),
          )
          .for('update');
        balance = locked;
      }
    }

    const openingMillis = toMillis(balance.openingBalance);
    const totalInMillis = toMillis(balance.totalIn);
    const totalOutMillis = toMillis(balance.totalOut);
    const prevStockMillis = openingMillis + totalInMillis - totalOutMillis;

    let newOpeningMillis = openingMillis;
    let newTotalInMillis = totalInMillis;
    let newTotalOutMillis = totalOutMillis;

    const isOutgoing =
      params.transactionType === 'STOCK_OUT' || params.transactionType === 'ADJUSTMENT_OUT';

    if (params.transactionType === 'OPENING_BALANCE') {
      newOpeningMillis = openingMillis + qtyMillis;
    } else if (
      params.transactionType === 'STOCK_IN' ||
      params.transactionType === 'ADJUSTMENT_IN'
    ) {
      newTotalInMillis = totalInMillis + qtyMillis;
    } else if (isOutgoing) {
      if (qtyMillis > prevStockMillis) {
        throw new InventoryError(
          400,
          `Insufficient stock: requested ${formatQtyDisplay(qtyMillis)} ${product.unitCode}, only ${formatQtyDisplay(prevStockMillis)} ${product.unitCode} available`,
          `الرصيد المتاح لا يكفي: المطلوب ${formatQtyDisplay(qtyMillis)} ${product.unitNameAr} والمتاح فقط ${formatQtyDisplay(prevStockMillis)} ${product.unitNameAr}`,
        );
      }
      newTotalOutMillis = totalOutMillis + qtyMillis;
    } else if (params.transactionType === 'REVERSAL') {
      // Direction depends on reversedTransactionId handled in reverseStockTransaction
      throw new InventoryError(400, 'Use reversal workflow for reversals', 'يرجى استخدام إجراء العكس المخصص');
    }

    const newStockMillis = newOpeningMillis + newTotalInMillis - newTotalOutMillis;
    if (newStockMillis < 0) {
      throw new InventoryError(400, 'Resulting stock cannot be negative', 'لا يمكن أن يصبح الرصيد سالباً');
    }

    // 5. Update balance atomically
    await tx
      .update(inventoryBalances)
      .set({
        openingBalance: fromMillis(newOpeningMillis),
        totalIn: fromMillis(newTotalInMillis),
        totalOut: fromMillis(newTotalOutMillis),
        currentStock: fromMillis(newStockMillis),
        updatedAt: new Date(),
      })
      .where(eq(inventoryBalances.id, balance.id));

    // 6. Insert immutable transaction record
    let txnNumber = makeTransactionNumber();
    for (let attempt = 0; attempt < 3; attempt++) {
      const check = await tx
        .select({ id: stockTransactions.id })
        .from(stockTransactions)
        .where(eq(stockTransactions.transactionNumber, txnNumber))
        .limit(1);
      if (check.length === 0) break;
      txnNumber = makeTransactionNumber();
    }

    const [createdTx] = await tx
      .insert(stockTransactions)
      .values({
        transactionNumber: txnNumber,
        warehouseId,
        productId: product.id,
        transactionType: params.transactionType,
        quantity: fromMillis(qtyMillis),
        previousBalance: fromMillis(prevStockMillis),
        newBalance: fromMillis(newStockMillis),
        reason: params.reason,
        destination: params.destination || null,
        referenceNumber: params.referenceNumber || null,
        notes: params.notes || null,
        idempotencyKey: params.idempotencyKey || null,
        reversedTransactionId: params.reversedTransactionId ?? null,
        userId: params.userId,
      })
      .returning();

    // 7. Trigger Low Stock / Out of Stock Notifications if needed
    const minStockMillis = toMillis(product.minimumStock);
    if (newStockMillis === 0) {
      await tx.insert(notifications).values({
        type: 'OUT_OF_STOCK',
        titleAr: `نفاد المخزون: ${product.name}`,
        titleEn: `Out of Stock: ${product.name}`,
        messageAr: `المنتج ${product.productCode} (${product.name}) وصل إلى رصيد 0 ${product.unitNameAr}`,
        messageEn: `Product ${product.productCode} (${product.name}) reached 0 ${product.unitCode}`,
        productId: product.id,
        targetRole: 'MANAGER',
      });
    } else if (minStockMillis > 0 && newStockMillis <= minStockMillis && isOutgoing) {
      await tx.insert(notifications).values({
        type: 'LOW_STOCK',
        titleAr: `تنبيه نقص مخزون: ${product.name}`,
        titleEn: `Low Stock Alert: ${product.name}`,
        messageAr: `الرصيد الحالي للمنتج ${product.productCode} هو ${formatQtyDisplay(newStockMillis)} ${product.unitNameAr} (الحد الأدنى ${formatQtyDisplay(minStockMillis)})`,
        messageEn: `Current stock for ${product.productCode} is ${formatQtyDisplay(newStockMillis)} ${product.unitCode} (Min: ${formatQtyDisplay(minStockMillis)})`,
        productId: product.id,
        targetRole: 'MANAGER',
      });
    }

    // 8. Audit log inside same transaction
    await recordAuditLog(
      {
        userId: params.userId,
        username: params.username,
        action: `STOCK_${params.transactionType}`,
        entity: 'stock_transactions',
        entityId: createdTx.id,
        previousValue: { currentStock: fromMillis(prevStockMillis) },
        newValue: {
          transactionNumber: createdTx.transactionNumber,
          productCode: product.productCode,
          quantity: fromMillis(qtyMillis),
          newBalance: fromMillis(newStockMillis),
          reason: params.reason,
        },
        ipAddress: params.ipAddress,
      },
      tx as unknown as typeof db,
    );

    return {
      transaction: createdTx,
      product: {
        id: product.id,
        productCode: product.productCode,
        name: product.name,
        productType: product.productType,
        unitCode: product.unitCode,
        unitNameAr: product.unitNameAr,
        unitNameEn: product.unitNameEn,
      },
      previousBalance: Number(fromMillis(prevStockMillis)),
      newBalance: Number(fromMillis(newStockMillis)),
    };
  });
}

export async function reverseStockTransaction(params: {
  transactionId: number;
  reason: string;
  userId: number;
  username: string;
  ipAddress?: string | null;
}) {
  return await db.transaction(async (tx) => {
    const [orig] = await tx
      .select()
      .from(stockTransactions)
      .where(eq(stockTransactions.id, params.transactionId))
      .limit(1);

    if (!orig) {
      throw new InventoryError(404, 'Transaction not found', 'الحركة المخزنية غير موجودة');
    }

    if (orig.transactionType === 'REVERSAL') {
      throw new InventoryError(400, 'Cannot reverse a reversal transaction', 'لا يمكن عكس حركة عكسية');
    }

    const alreadyReversed = await tx
      .select({ id: stockTransactions.id })
      .from(stockTransactions)
      .where(eq(stockTransactions.reversedTransactionId, orig.id))
      .limit(1);

    if (alreadyReversed.length > 0) {
      throw new InventoryError(
        409,
        'This transaction has already been reversed',
        'تم عكس هذه الحركة مسبقاً',
      );
    }

    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.warehouseId, orig.warehouseId),
          eq(inventoryBalances.productId, orig.productId),
        ),
      )
      .for('update');

    if (!balance) {
      throw new InventoryError(404, 'Inventory balance not found', 'سجل الرصيد غير موجود');
    }

    const [product] = await tx
      .select()
      .from(products)
      .where(eq(products.id, orig.productId))
      .limit(1);

    const qtyMillis = toMillis(orig.quantity);
    const openingMillis = toMillis(balance.openingBalance);
    const totalInMillis = toMillis(balance.totalIn);
    const totalOutMillis = toMillis(balance.totalOut);
    const prevStockMillis = openingMillis + totalInMillis - totalOutMillis;

    let newOpeningMillis = openingMillis;
    let newTotalInMillis = totalInMillis;
    let newTotalOutMillis = totalOutMillis;

    if (orig.transactionType === 'OPENING_BALANCE') {
      if (prevStockMillis - qtyMillis < 0) {
        throw new InventoryError(
          400,
          'Cannot reverse opening balance because stock has already been consumed',
          'لا يمكن عكس الرصيد الافتتاحي لأن جزءاً منه قد تم صرفه بالفعل',
        );
      }
      newOpeningMillis = openingMillis - qtyMillis;
    } else if (orig.transactionType === 'STOCK_IN' || orig.transactionType === 'ADJUSTMENT_IN') {
      if (prevStockMillis - qtyMillis < 0) {
        throw new InventoryError(
          400,
          'Cannot reverse incoming stock because available balance would become negative',
          'لا يمكن عكس حركة الإدخال لأن الرصيد الحالي لا يكفي',
        );
      }
      newTotalOutMillis = totalOutMillis + qtyMillis;
    } else {
      // Reversing an outgoing transaction returns stock
      newTotalInMillis = totalInMillis + qtyMillis;
    }

    const newStockMillis = newOpeningMillis + newTotalInMillis - newTotalOutMillis;
    if (newStockMillis < 0) {
      throw new InventoryError(400, 'Reversal would result in negative stock', 'العكس سيؤدي إلى رصيد سالب');
    }

    await tx
      .update(inventoryBalances)
      .set({
        openingBalance: fromMillis(newOpeningMillis),
        totalIn: fromMillis(newTotalInMillis),
        totalOut: fromMillis(newTotalOutMillis),
        currentStock: fromMillis(newStockMillis),
        updatedAt: new Date(),
      })
      .where(eq(inventoryBalances.id, balance.id));

    const txnNumber = makeTransactionNumber();
    const [reversalTx] = await tx
      .insert(stockTransactions)
      .values({
        transactionNumber: txnNumber,
        warehouseId: orig.warehouseId,
        productId: orig.productId,
        transactionType: 'REVERSAL',
        quantity: fromMillis(qtyMillis),
        previousBalance: fromMillis(prevStockMillis),
        newBalance: fromMillis(newStockMillis),
        reason: `${params.reason} (Reversal of ${orig.transactionNumber})`,
        referenceNumber: orig.transactionNumber,
        notes: `عكس الحركة رقم ${orig.transactionNumber}`,
        reversedTransactionId: orig.id,
        userId: params.userId,
      })
      .returning();

    await recordAuditLog(
      {
        userId: params.userId,
        username: params.username,
        action: 'TRANSACTION_REVERSAL',
        entity: 'stock_transactions',
        entityId: reversalTx.id,
        previousValue: { reversedTransactionId: orig.id, previousBalance: fromMillis(prevStockMillis) },
        newValue: {
          reversalTransactionNumber: reversalTx.transactionNumber,
          productCode: product?.productCode,
          newBalance: fromMillis(newStockMillis),
        },
        ipAddress: params.ipAddress,
      },
      tx as unknown as typeof db,
    );

    return reversalTx;
  });
}

export async function recalculateInventoryBalance(productId: number, warehouseId?: number) {
  const result = await db
    .select({
      opening: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} = 'OPENING_BALANCE' THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
      totalIn: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
      totalOut: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
    })
    .from(stockTransactions)
    .where(
      warehouseId
        ? and(eq(stockTransactions.productId, productId), eq(stockTransactions.warehouseId, warehouseId))
        : eq(stockTransactions.productId, productId),
    );
  return result[0];
}
