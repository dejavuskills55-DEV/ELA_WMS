import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
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

const router = Router();

async function getDefaultWarehouseId(): Promise<number> {
  const [wh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.isDefault, true))
    .limit(1);
  if (!wh) throw new Error('Default warehouse missing');
  return wh.id;
}

// Management Dashboard (real DB aggregations only)
router.get(
  '/',
  requireAuth,
  requirePermission('DASHBOARD_VIEW'),
  async (req: AuthRequest, res) => {
    try {
      const warehouseId = await getDefaultWarehouseId();
      const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : '';
      const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : '';
      const productType = typeof req.query.productType === 'string' ? req.query.productType : '';
      const productId = req.query.productId ? Number(req.query.productId) : null;
      const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
      const transactionType =
        typeof req.query.transactionType === 'string' ? req.query.transactionType : '';
      const referenceNumber =
        typeof req.query.referenceNumber === 'string' ? req.query.referenceNumber.trim() : '';

      // 1. All products + balances for KPI & Breakdown & Alerts & Top Stock
      const allProducts = await db
        .select({
          id: products.id,
          productCode: products.productCode,
          name: products.name,
          productType: products.productType,
          status: products.status,
          minimumStock: products.minimumStock,
          categoryNameAr: categories.nameAr,
          categoryNameEn: categories.nameEn,
          unitCode: units.code,
          unitNameAr: units.nameAr,
          currentStock: sql<string>`COALESCE(${inventoryBalances.currentStock}, 0)`,
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .innerJoin(units, eq(products.unitId, units.id))
        .leftJoin(
          inventoryBalances,
          and(
            eq(inventoryBalances.productId, products.id),
            eq(inventoryBalances.warehouseId, warehouseId),
          ),
        );

      const activeProducts = allProducts.filter((p) => p.status === 'ACTIVE');
      const totalProducts = activeProducts.length;
      const totalRawMaterials = activeProducts.filter((p) => p.productType === 'RAW_MATERIAL').length;
      const totalFinishedProducts = activeProducts.filter(
        (p) => p.productType === 'FINISHED_PRODUCT',
      ).length;

      let totalInventoryQuantity = 0;
      let rawQty = 0;
      let finishedQty = 0;
      const alerts: Array<{
        productId: number;
        productCode: string;
        productName: string;
        productType: string;
        unitNameAr: string;
        unitCode: string;
        currentStock: number;
        minimumStock: number;
        shortageAmount: number;
        alertType: 'LOW_STOCK' | 'OUT_OF_STOCK';
      }> = [];

      for (const p of activeProducts) {
        const cur = Number(p.currentStock);
        const min = Number(p.minimumStock);
        totalInventoryQuantity += cur;
        if (p.productType === 'RAW_MATERIAL') rawQty += cur;
        else finishedQty += cur;

        if (cur === 0) {
          alerts.push({
            productId: p.id,
            productCode: p.productCode,
            productName: p.name,
            productType: p.productType,
            unitNameAr: p.unitNameAr,
            unitCode: p.unitCode,
            currentStock: 0,
            minimumStock: min,
            shortageAmount: min,
            alertType: 'OUT_OF_STOCK',
          });
        } else if (min > 0 && cur <= min) {
          alerts.push({
            productId: p.id,
            productCode: p.productCode,
            productName: p.name,
            productType: p.productType,
            unitNameAr: p.unitNameAr,
            unitCode: p.unitCode,
            currentStock: cur,
            minimumStock: min,
            shortageAmount: Number((min - cur).toFixed(3)),
            alertType: 'LOW_STOCK',
          });
        }
      }

      const lowStockProductsCount = alerts.filter((a) => a.alertType === 'LOW_STOCK').length;
      const outOfStockProductsCount = alerts.filter((a) => a.alertType === 'OUT_OF_STOCK').length;

      // 2. Today's Stock In & Out
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);

      const todayRows = await db
        .select({
          stockInToday: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
          stockOutToday: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
        })
        .from(stockTransactions)
        .where(gte(stockTransactions.createdAt, startOfToday));

      const stockInToday = Number(todayRows[0]?.stockInToday || 0);
      const stockOutToday = Number(todayRows[0]?.stockOutToday || 0);

      // 3. Daily movement chart (Incoming vs Outgoing by day)
      const txConds = [];
      if (fromDate) txConds.push(gte(stockTransactions.createdAt, new Date(`${fromDate}T00:00:00.000Z`)));
      if (toDate) txConds.push(lte(stockTransactions.createdAt, new Date(`${toDate}T23:59:59.999Z`)));
      if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
        txConds.push(eq(products.productType, productType));
      }
      if (productId) txConds.push(eq(stockTransactions.productId, productId));
      if (employeeId) txConds.push(eq(stockTransactions.userId, employeeId));
      if (transactionType) txConds.push(eq(stockTransactions.transactionType, transactionType));
      if (referenceNumber) txConds.push(ilike(stockTransactions.referenceNumber, `%${referenceNumber}%`));

      const dailyRows = await db
        .select({
          day: sql<string>`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
          incoming: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
          outgoing: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
        })
        .from(stockTransactions)
        .innerJoin(products, eq(stockTransactions.productId, products.id))
        .where(txConds.length > 0 ? and(...txConds) : undefined)
        .groupBy(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
        .orderBy(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
        .limit(31);

      // 4. Monthly movement chart
      const monthlyRows = await db
        .select({
          month: sql<string>`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`,
          incoming: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
          outgoing: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
        })
        .from(stockTransactions)
        .innerJoin(products, eq(stockTransactions.productId, products.id))
        .where(txConds.length > 0 ? and(...txConds) : undefined)
        .groupBy(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`)
        .limit(12);

      // 5. Top 10 Most Used Products (highest outgoing volume)
      const topUsedRows = await db
        .select({
          productCode: products.productCode,
          name: products.name,
          unitCode: units.code,
          totalUsed: sql<string>`COALESCE(SUM(${stockTransactions.quantity}), 0)`,
        })
        .from(stockTransactions)
        .innerJoin(products, eq(stockTransactions.productId, products.id))
        .innerJoin(units, eq(products.unitId, units.id))
        .where(
          sql`${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT')`,
        )
        .groupBy(products.id, products.productCode, products.name, units.code)
        .orderBy(desc(sql`COALESCE(SUM(${stockTransactions.quantity}), 0)`))
        .limit(10);

      // 6. Top 10 Products by Stock Quantity
      const topStockProducts = [...activeProducts]
        .sort((a, b) => Number(b.currentStock) - Number(a.currentStock))
        .slice(0, 10)
        .map((p) => ({
          productCode: p.productCode,
          name: p.name,
          quantity: Number(p.currentStock),
          unitCode: p.unitCode,
        }));

      // 7. Recent Filtered Transactions
      const recentTransactions = await db
        .select({
          id: stockTransactions.id,
          transactionNumber: stockTransactions.transactionNumber,
          productCode: products.productCode,
          productName: products.name,
          productType: products.productType,
          transactionType: stockTransactions.transactionType,
          quantity: stockTransactions.quantity,
          unitCode: units.code,
          unitNameAr: units.nameAr,
          employeeName: users.fullName,
          reason: stockTransactions.reason,
          referenceNumber: stockTransactions.referenceNumber,
          createdAt: stockTransactions.createdAt,
        })
        .from(stockTransactions)
        .innerJoin(products, eq(stockTransactions.productId, products.id))
        .innerJoin(units, eq(products.unitId, units.id))
        .innerJoin(users, eq(stockTransactions.userId, users.id))
        .where(txConds.length > 0 ? and(...txConds) : undefined)
        .orderBy(desc(stockTransactions.createdAt))
        .limit(25);

      res.json({
        kpis: {
          totalProducts,
          totalRawMaterials,
          totalFinishedProducts,
          totalInventoryQuantity: Number(totalInventoryQuantity.toFixed(3)),
          stockInToday: Number(stockInToday.toFixed(3)),
          stockOutToday: Number(stockOutToday.toFixed(3)),
          lowStockProducts: lowStockProductsCount,
          outOfStockProducts: outOfStockProductsCount,
        },
        charts: {
          dailyMovement: dailyRows.map((d) => ({
            day: d.day,
            incoming: Number(d.incoming),
            outgoing: Number(d.outgoing),
          })),
          monthlyMovement: monthlyRows.map((m) => ({
            month: m.month,
            incoming: Number(m.incoming),
            outgoing: Number(m.outgoing),
          })),
          typeBreakdown: [
            {
              type: 'RAW_MATERIAL',
              nameAr: 'مواد خام',
              nameEn: 'Raw Materials',
              count: totalRawMaterials,
              quantity: Number(rawQty.toFixed(3)),
            },
            {
              type: 'FINISHED_PRODUCT',
              nameAr: 'منتج تام',
              nameEn: 'Finished Products',
              count: totalFinishedProducts,
              quantity: Number(finishedQty.toFixed(3)),
            },
          ],
          topUsedProducts: topUsedRows.map((t) => ({
            productCode: t.productCode,
            name: t.name,
            unitCode: t.unitCode,
            totalUsed: Number(t.totalUsed),
          })),
          topStockProducts,
        },
        alerts,
        recentTransactions: recentTransactions.map((t) => ({
          ...t,
          quantity: Number(t.quantity),
        })),
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({ error: 'Failed to load dashboard data' });
    }
  },
);

// 11 Reports endpoint
router.get(
  '/reports/:reportType',
  requireAuth,
  requirePermission('REPORTS_VIEW'),
  async (req: AuthRequest, res) => {
    try {
      const reportType = String(req.params.reportType);
      const warehouseId = await getDefaultWarehouseId();
      const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : '';
      const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : '';
      const productType = typeof req.query.productType === 'string' ? req.query.productType : '';
      const productId = req.query.productId ? Number(req.query.productId) : null;

      if (
        reportType === 'current-inventory' ||
        reportType === 'raw-materials' ||
        reportType === 'finished-products' ||
        reportType === 'low-stock' ||
        reportType === 'out-of-stock'
      ) {
        const conds = [eq(products.status, 'ACTIVE')];
        if (reportType === 'raw-materials') conds.push(eq(products.productType, 'RAW_MATERIAL'));
        else if (reportType === 'finished-products') conds.push(eq(products.productType, 'FINISHED_PRODUCT'));
        else if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
          conds.push(eq(products.productType, productType));
        }

        const rows = await db
          .select({
            productCode: products.productCode,
            barcode: products.barcode,
            name: products.name,
            productType: products.productType,
            categoryNameAr: categories.nameAr,
            categoryNameEn: categories.nameEn,
            unitCode: units.code,
            unitNameAr: units.nameAr,
            openingBalance: sql<string>`COALESCE(${inventoryBalances.openingBalance}, 0)`,
            totalIn: sql<string>`COALESCE(${inventoryBalances.totalIn}, 0)`,
            totalOut: sql<string>`COALESCE(${inventoryBalances.totalOut}, 0)`,
            currentStock: sql<string>`COALESCE(${inventoryBalances.currentStock}, 0)`,
            minimumStock: products.minimumStock,
          })
          .from(products)
          .innerJoin(categories, eq(products.categoryId, categories.id))
          .innerJoin(units, eq(products.unitId, units.id))
          .leftJoin(
            inventoryBalances,
            and(
              eq(inventoryBalances.productId, products.id),
              eq(inventoryBalances.warehouseId, warehouseId),
            ),
          )
          .where(and(...conds))
          .orderBy(products.productCode);

        const mapped = rows
          .map((r) => {
            const cur = Number(r.currentStock);
            const min = Number(r.minimumStock);
            return {
              ...r,
              openingBalance: Number(r.openingBalance),
              totalIn: Number(r.totalIn),
              totalOut: Number(r.totalOut),
              currentStock: cur,
              minimumStock: min,
              shortageAmount: Math.max(0, Number((min - cur).toFixed(3))),
            };
          })
          .filter((r) => {
            if (reportType === 'low-stock') return r.minimumStock > 0 && r.currentStock <= r.minimumStock && r.currentStock > 0;
            if (reportType === 'out-of-stock') return r.currentStock === 0;
            return true;
          });

        return res.json({ reportType, rows: mapped });
      }

      if (
        reportType === 'incoming-transactions' ||
        reportType === 'outgoing-transactions' ||
        reportType === 'product-movement'
      ) {
        const conds = [];
        if (reportType === 'incoming-transactions') {
          conds.push(sql`${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE')`);
        } else if (reportType === 'outgoing-transactions') {
          conds.push(sql`${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT')`);
        }
        if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
          conds.push(eq(products.productType, productType));
        }
        if (productId) conds.push(eq(stockTransactions.productId, productId));
        if (fromDate) conds.push(gte(stockTransactions.createdAt, new Date(`${fromDate}T00:00:00.000Z`)));
        if (toDate) conds.push(lte(stockTransactions.createdAt, new Date(`${toDate}T23:59:59.999Z`)));

        const rows = await db
          .select({
            transactionNumber: stockTransactions.transactionNumber,
            productCode: products.productCode,
            productName: products.name,
            productType: products.productType,
            unitNameAr: units.nameAr,
            transactionType: stockTransactions.transactionType,
            quantity: stockTransactions.quantity,
            previousBalance: stockTransactions.previousBalance,
            newBalance: stockTransactions.newBalance,
            reason: stockTransactions.reason,
            destination: stockTransactions.destination,
            referenceNumber: stockTransactions.referenceNumber,
            employeeName: users.fullName,
            createdAt: stockTransactions.createdAt,
          })
          .from(stockTransactions)
          .innerJoin(products, eq(stockTransactions.productId, products.id))
          .innerJoin(units, eq(products.unitId, units.id))
          .innerJoin(users, eq(stockTransactions.userId, users.id))
          .where(conds.length > 0 ? and(...conds) : undefined)
          .orderBy(desc(stockTransactions.createdAt))
          .limit(500);

        return res.json({
          reportType,
          rows: rows.map((r) => ({
            ...r,
            quantity: Number(r.quantity),
            previousBalance: Number(r.previousBalance),
            newBalance: Number(r.newBalance),
          })),
        });
      }

      if (reportType === 'employee-activity') {
        const conds = [];
        if (fromDate) conds.push(gte(stockTransactions.createdAt, new Date(`${fromDate}T00:00:00.000Z`)));
        if (toDate) conds.push(lte(stockTransactions.createdAt, new Date(`${toDate}T23:59:59.999Z`)));
        if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
          conds.push(eq(products.productType, productType));
        }

        const rows = await db
          .select({
            employeeId: users.id,
            employeeName: users.fullName,
            username: users.username,
            totalTransactions: sql<number>`COUNT(*)::int`,
            totalInQty: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
            totalOutQty: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
            lastActivityAt: sql<string>`MAX(${stockTransactions.createdAt})`,
          })
          .from(stockTransactions)
          .innerJoin(users, eq(stockTransactions.userId, users.id))
          .innerJoin(products, eq(stockTransactions.productId, products.id))
          .where(conds.length > 0 ? and(...conds) : undefined)
          .groupBy(users.id, users.fullName, users.username);

        return res.json({
          reportType,
          rows: rows.map((r) => ({
            ...r,
            totalInQty: Number(r.totalInQty),
            totalOutQty: Number(r.totalOutQty),
          })),
        });
      }

      if (reportType === 'daily-inventory' || reportType === 'monthly-inventory') {
        const format = reportType === 'daily-inventory' ? 'YYYY-MM-DD' : 'YYYY-MM';
        const conds = [];
        if (fromDate) conds.push(gte(stockTransactions.createdAt, new Date(`${fromDate}T00:00:00.000Z`)));
        if (toDate) conds.push(lte(stockTransactions.createdAt, new Date(`${toDate}T23:59:59.999Z`)));
        if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
          conds.push(eq(products.productType, productType));
        }

        const rows = await db
          .select({
            period: sql<string>`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', '${sql.raw(format)}')`,
            transactionCount: sql<number>`COUNT(*)::int`,
            incomingQty: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_IN', 'ADJUSTMENT_IN', 'OPENING_BALANCE') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
            outgoingQty: sql<string>`COALESCE(SUM(CASE WHEN ${stockTransactions.transactionType} IN ('STOCK_OUT', 'ADJUSTMENT_OUT') THEN ${stockTransactions.quantity} ELSE 0 END), 0)`,
          })
          .from(stockTransactions)
          .innerJoin(products, eq(stockTransactions.productId, products.id))
          .where(conds.length > 0 ? and(...conds) : undefined)
          .groupBy(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', '${sql.raw(format)}')`)
          .orderBy(desc(sql`TO_CHAR(${stockTransactions.createdAt} AT TIME ZONE 'UTC', '${sql.raw(format)}')`));

        return res.json({
          reportType,
          rows: rows.map((r) => ({
            ...r,
            incomingQty: Number(r.incomingQty),
            outgoingQty: Number(r.outgoingQty),
            netChange: Number((Number(r.incomingQty) - Number(r.outgoingQty)).toFixed(3)),
          })),
        });
      }

      return res.status(400).json({ error: 'Unknown report type' });
    } catch (error) {
      console.error('Report error:', error);
      return res.status(500).json({ error: 'Failed to generate report' });
    }
  },
);

export default router;
