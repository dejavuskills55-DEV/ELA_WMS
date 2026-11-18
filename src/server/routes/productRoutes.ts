import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  categories,
  inventoryBalances,
  products,
  units,
  users,
  warehouses,
} from '../../db/schema.ts';
import {
  type AuthRequest,
  requireAuth,
  requirePermission,
} from '../../middleware/auth.ts';
import { getClientIp, recordAuditLog } from '../audit.ts';
import { executeStockMovement } from '../inventoryEngine.ts';

const router = Router();

const createProductSchema = z.object({
  productCode: z.string().trim().min(2).max(50),
  barcode: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(2).max(160),
  productType: z.enum(['RAW_MATERIAL', 'FINISHED_PRODUCT']),
  categoryId: z.coerce.number().int().positive(),
  unitId: z.coerce.number().int().positive(),
  minimumStock: z.coerce.number().min(0).default(0),
  openingBalance: z.coerce.number().min(0).optional().default(0),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  generateBarcode: z.boolean().optional().default(false),
});

const updateProductSchema = z.object({
  barcode: z.string().trim().max(80).optional().nullable(),
  name: z.string().trim().min(2).max(160).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  minimumStock: z.coerce.number().min(0).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

function buildAutoBarcode(productCode: string): string {
  const clean = productCode.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `ELA${clean}${suffix}`;
}

async function getDefaultWarehouseId(): Promise<number> {
  const [wh] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.isDefault, true))
    .limit(1);
  if (!wh) throw new Error('Default warehouse missing');
  return wh.id;
}

// Suggest next RAW-0001 or FIN-0001 code
router.get('/suggest-code', requireAuth, async (req: AuthRequest, res) => {
  try {
    const productType = req.query.type === 'FINISHED_PRODUCT' ? 'FINISHED_PRODUCT' : 'RAW_MATERIAL';
    const prefix = productType === 'RAW_MATERIAL' ? 'RAW-' : 'FIN-';

    const existing = await db
      .select({ productCode: products.productCode })
      .from(products)
      .where(ilike(products.productCode, `${prefix}%`));

    let maxNum = 0;
    const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');
    for (const row of existing) {
      const m = row.productCode.match(regex);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const nextCode = `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
    res.json({ suggestedCode: nextCode });
  } catch (error) {
    console.error('Suggest code error:', error);
    res.status(500).json({ error: 'Failed to suggest product code' });
  }
});

// Check immediate uniqueness for productCode or barcode
router.get('/check-unique', requireAuth, async (req: AuthRequest, res) => {
  try {
    const productCode = typeof req.query.productCode === 'string' ? req.query.productCode.trim() : '';
    const barcode = typeof req.query.barcode === 'string' ? req.query.barcode.trim() : '';
    const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;

    let codeExists = false;
    let barcodeExists = false;

    if (productCode) {
      const conds = [sql`LOWER(${products.productCode}) = LOWER(${productCode})`];
      if (excludeId) conds.push(ne(products.id, excludeId));
      const found = await db.select({ id: products.id }).from(products).where(and(...conds)).limit(1);
      codeExists = found.length > 0;
    }

    if (barcode) {
      const conds = [sql`LOWER(${products.barcode}) = LOWER(${barcode})`];
      if (excludeId) conds.push(ne(products.id, excludeId));
      const found = await db.select({ id: products.id }).from(products).where(and(...conds)).limit(1);
      barcodeExists = found.length > 0;
    }

    res.json({ codeExists, barcodeExists });
  } catch (error) {
    console.error('Check unique error:', error);
    res.status(500).json({ error: 'Failed to check uniqueness' });
  }
});

// Lookup product by exact code or barcode (USB barcode scanner endpoint)
router.get('/lookup/:code', requireAuth, async (req: AuthRequest, res) => {
  try {
    const code = decodeURIComponent(String(req.params.code)).trim();
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const warehouseId = await getDefaultWarehouseId();
    const rows = await db
      .select({
        id: products.id,
        productCode: products.productCode,
        barcode: products.barcode,
        name: products.name,
        productType: products.productType,
        categoryId: products.categoryId,
        categoryNameAr: categories.nameAr,
        categoryNameEn: categories.nameEn,
        unitId: products.unitId,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        unitSymbol: units.symbol,
        allowFraction: units.allowFraction,
        minimumStock: products.minimumStock,
        description: products.description,
        status: products.status,
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
      )
      .where(
        or(
          sql`LOWER(${products.productCode}) = LOWER(${code})`,
          sql`LOWER(${products.barcode}) = LOWER(${code})`,
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Product not found for this code or barcode',
        errorAr: 'لم يتم العثور على منتج بهذا الكود أو الباركود',
      });
    }

    const row = rows[0];
    return res.json({
      product: {
        ...row,
        minimumStock: Number(row.minimumStock),
        currentStock: Number(row.currentStock),
      },
    });
  } catch (error) {
    console.error('Lookup error:', error);
    return res.status(500).json({ error: 'Failed to lookup product' });
  }
});

// Download Excel Import Template
router.get('/import/template', requireAuth, requirePermission('EXCEL_IMPORT'), (_req, res) => {
  const sampleRows = [
    {
      'Product Code': 'RAW-0001',
      Barcode: '622100000001',
      'Product Name': 'خيط قطن ممشط نمرة 30/1',
      'Product Type': 'RAW_MATERIAL',
      Category: 'خيوط وغزول',
      Unit: 'KG',
      'Minimum Stock': 100,
      Description: 'خيط قطن مصري عالي الجودة',
      'Opening Balance': 500,
    },
    {
      'Product Code': 'FIN-0001',
      Barcode: '622100000002',
      'Product Name': 'قماش جيرسي قطن 100% كحلي',
      'Product Type': 'FINISHED_PRODUCT',
      Category: 'منسوجات تريكو جاهزة',
      Unit: 'M',
      'Minimum Stock': 200,
      Description: 'قماش مصبوغ ومجهز عرض 180 سم',
      'Opening Balance': 0,
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Products_Template');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ELA_Products_Import_Template.xlsx"');
  res.send(buf);
});

// Export full product catalog & balances as Excel
router.get('/export/excel', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const warehouseId = await getDefaultWarehouseId();
    const rows = await db
      .select({
        productCode: products.productCode,
        barcode: products.barcode,
        name: products.name,
        productType: products.productType,
        categoryNameAr: categories.nameAr,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        openingBalance: sql<string>`COALESCE(${inventoryBalances.openingBalance}, 0)`,
        totalIn: sql<string>`COALESCE(${inventoryBalances.totalIn}, 0)`,
        totalOut: sql<string>`COALESCE(${inventoryBalances.totalOut}, 0)`,
        currentStock: sql<string>`COALESCE(${inventoryBalances.currentStock}, 0)`,
        minimumStock: products.minimumStock,
        status: products.status,
        description: products.description,
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
      .orderBy(products.productCode);

    const exportData = rows.map((r) => ({
      'كود المنتج / Product Code': r.productCode,
      'الباركود / Barcode': r.barcode || '',
      'اسم المنتج / Name': r.name,
      'النوع / Type': r.productType === 'RAW_MATERIAL' ? 'مواد خام (RAW)' : 'منتج تام (FINISHED)',
      'التصنيف / Category': r.categoryNameAr,
      'الوحدة / Unit': `${r.unitNameAr} (${r.unitCode})`,
      'رصيد أول المدة / Opening': Number(r.openingBalance),
      'إجمالي الوارد / Total In': Number(r.totalIn),
      'إجمالي المنصرف / Total Out': Number(r.totalOut),
      'الرصيد الحالي / Current Stock': Number(r.currentStock),
      'الحد الأدنى / Min Stock': Number(r.minimumStock),
      'الحالة / Status': r.status,
      'الوصف / Description': r.description || '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Catalog_Inventory');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ELA_Catalog_Inventory.xlsx"');
    res.send(buf);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ error: 'Failed to export Excel catalog' });
  }
});

// List products with balances & filtering
router.get('/', requireAuth, requirePermission('PRODUCT_VIEW'), async (req: AuthRequest, res) => {
  try {
    const warehouseId = await getDefaultWarehouseId();
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const productType = typeof req.query.productType === 'string' ? req.query.productType : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const stockState = typeof req.query.stockState === 'string' ? req.query.stockState : '';

    const conditions = [];
    if (productType === 'RAW_MATERIAL' || productType === 'FINISHED_PRODUCT') {
      conditions.push(eq(products.productType, productType));
    }
    if (status === 'ACTIVE' || status === 'INACTIVE') {
      conditions.push(eq(products.status, status));
    }
    if (categoryId) {
      conditions.push(eq(products.categoryId, categoryId));
    }
    if (search) {
      conditions.push(
        or(
          ilike(products.productCode, `%${search}%`),
          ilike(products.barcode, `%${search}%`),
          ilike(products.name, `%${search}%`),
        ),
      );
    }

    const rows = await db
      .select({
        id: products.id,
        productCode: products.productCode,
        barcode: products.barcode,
        name: products.name,
        productType: products.productType,
        categoryId: products.categoryId,
        categoryNameAr: categories.nameAr,
        categoryNameEn: categories.nameEn,
        unitId: products.unitId,
        unitCode: units.code,
        unitNameAr: units.nameAr,
        unitNameEn: units.nameEn,
        unitSymbol: units.symbol,
        allowFraction: units.allowFraction,
        minimumStock: products.minimumStock,
        description: products.description,
        imageUrl: products.imageUrl,
        status: products.status,
        createdByName: users.fullName,
        createdAt: products.createdAt,
        updatedAt: products.updatedAt,
        openingBalance: sql<string>`COALESCE(${inventoryBalances.openingBalance}, 0)`,
        totalIn: sql<string>`COALESCE(${inventoryBalances.totalIn}, 0)`,
        totalOut: sql<string>`COALESCE(${inventoryBalances.totalOut}, 0)`,
        currentStock: sql<string>`COALESCE(${inventoryBalances.currentStock}, 0)`,
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .innerJoin(units, eq(products.unitId, units.id))
      .innerJoin(users, eq(products.createdById, users.id))
      .leftJoin(
        inventoryBalances,
        and(
          eq(inventoryBalances.productId, products.id),
          eq(inventoryBalances.warehouseId, warehouseId),
        ),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(products.createdAt));

    const enriched = rows
      .map((r) => {
        const currentStock = Number(r.currentStock);
        const minimumStock = Number(r.minimumStock);
        const stockAlertStatus =
          currentStock === 0
            ? 'OUT_OF_STOCK'
            : minimumStock > 0 && currentStock <= minimumStock
              ? 'LOW_STOCK'
              : 'NORMAL';
        return {
          ...r,
          minimumStock,
          openingBalance: Number(r.openingBalance),
          totalIn: Number(r.totalIn),
          totalOut: Number(r.totalOut),
          currentStock,
          stockAlertStatus,
        };
      })
      .filter((r) => {
        if (!stockState) return true;
        return r.stockAlertStatus === stockState;
      });

    res.json({ products: enriched });
  } catch (error) {
    console.error('List products error:', error);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

// Create product
router.post('/', requireAuth, requirePermission('PRODUCT_CREATE'), async (req: AuthRequest, res) => {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid product data',
        errorAr: 'بيانات المنتج غير مكتملة أو غير صالحة',
        details: parsed.error.flatten(),
      });
    }

    const data = parsed.data;
    const normalizedCode = data.productCode.toUpperCase();
    let finalBarcode = data.barcode?.trim() || null;
    if (!finalBarcode && data.generateBarcode) {
      finalBarcode = buildAutoBarcode(normalizedCode);
    }

    // Check duplicate productCode
    const dupCode = await db
      .select({ id: products.id })
      .from(products)
      .where(sql`LOWER(${products.productCode}) = LOWER(${normalizedCode})`)
      .limit(1);
    if (dupCode.length > 0) {
      return res.status(409).json({
        error: `Product code ${normalizedCode} already exists`,
        errorAr: `كود المنتج ${normalizedCode} مسجل مسبقاً ولا يمكن تكراره`,
      });
    }

    // Check duplicate barcode
    if (finalBarcode) {
      const dupBarcode = await db
        .select({ id: products.id })
        .from(products)
        .where(sql`LOWER(${products.barcode}) = LOWER(${finalBarcode})`)
        .limit(1);
      if (dupBarcode.length > 0) {
        return res.status(409).json({
          error: `Barcode ${finalBarcode} already exists`,
          errorAr: `الباركود ${finalBarcode} مسجل مسبقاً لمنتج آخر`,
        });
      }
    }

    // Verify category matches productType
    const [cat] = await db.select().from(categories).where(eq(categories.id, data.categoryId)).limit(1);
    if (!cat) {
      return res.status(400).json({ error: 'Category not found', errorAr: 'التصنيف غير موجود' });
    }
    if (cat.productType !== data.productType) {
      return res.status(400).json({
        error: 'Selected category does not match product type',
        errorAr: 'التصنيف المختار لا يتطابق مع نوع المنتج (مواد خام / منتج تام)',
      });
    }

    const [unit] = await db.select().from(units).where(eq(units.id, data.unitId)).limit(1);
    if (!unit) {
      return res.status(400).json({ error: 'Unit not found', errorAr: 'وحدة القياس غير موجودة' });
    }

    const warehouseId = await getDefaultWarehouseId();

    const createdProduct = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(products)
        .values({
          productCode: normalizedCode,
          barcode: finalBarcode,
          name: data.name,
          productType: data.productType,
          categoryId: data.categoryId,
          unitId: data.unitId,
          minimumStock: data.minimumStock.toFixed(3),
          description: data.description || null,
          imageUrl: data.imageUrl || null,
          status: 'ACTIVE',
          createdById: req.currentUser!.id,
        })
        .returning();

      await tx.insert(inventoryBalances).values({
        warehouseId,
        productId: inserted.id,
        openingBalance: '0.000',
        totalIn: '0.000',
        totalOut: '0.000',
        currentStock: '0.000',
      });

      await recordAuditLog(
        {
          userId: req.currentUser!.id,
          username: req.currentUser!.username,
          action: 'PRODUCT_CREATE',
          entity: 'products',
          entityId: inserted.id,
          newValue: {
            productCode: inserted.productCode,
            barcode: inserted.barcode,
            name: inserted.name,
            productType: inserted.productType,
            minimumStock: inserted.minimumStock,
          },
          ipAddress: getClientIp(req),
        },
        tx as unknown as typeof db,
      );

      return inserted;
    });

    if (data.openingBalance && data.openingBalance > 0) {
      await executeStockMovement({
        productId: createdProduct.id,
        warehouseId,
        transactionType: 'OPENING_BALANCE',
        quantity: data.openingBalance,
        reason: 'رصيد افتتاحي عند تعريف الصنف / Initial Opening Balance',
        userId: req.currentUser!.id,
        username: req.currentUser!.username,
        ipAddress: getClientIp(req),
      });
    }

    return res.status(201).json({ product: createdProduct });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({ error: 'Failed to create product' });
  }
});

// Edit / deactivate product (ADMIN only)
router.patch('/:id', requireAuth, requirePermission('PRODUCT_EDIT'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }

    const [existing] = await db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found', errorAr: 'المنتج غير موجود' });
    }

    const data = parsed.data;
    if (data.barcode) {
      const dup = await db
        .select({ id: products.id })
        .from(products)
        .where(and(sql`LOWER(${products.barcode}) = LOWER(${data.barcode})`, ne(products.id, id)))
        .limit(1);
      if (dup.length > 0) {
        return res.status(409).json({
          error: 'Barcode already assigned to another product',
          errorAr: 'الباركود مستخدم بالفعل لمنتج آخر',
        });
      }
    }

    if (data.categoryId) {
      const [cat] = await db.select().from(categories).where(eq(categories.id, data.categoryId)).limit(1);
      if (!cat || cat.productType !== existing.productType) {
        return res.status(400).json({
          error: 'Category must match product type',
          errorAr: 'التصنيف يجب أن يطابق نوع المنتج',
        });
      }
    }

    const [updated] = await db
      .update(products)
      .set({
        barcode: data.barcode !== undefined ? data.barcode || null : existing.barcode,
        name: data.name ?? existing.name,
        categoryId: data.categoryId ?? existing.categoryId,
        unitId: data.unitId ?? existing.unitId,
        minimumStock:
          data.minimumStock !== undefined ? data.minimumStock.toFixed(3) : existing.minimumStock,
        description: data.description !== undefined ? data.description : existing.description,
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : existing.imageUrl,
        status: data.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    await recordAuditLog({
      userId: req.currentUser!.id,
      username: req.currentUser!.username,
      action: 'PRODUCT_UPDATE',
      entity: 'products',
      entityId: id,
      previousValue: existing,
      newValue: updated,
      ipAddress: getClientIp(req),
    });

    return res.json({ product: updated });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({ error: 'Failed to update product' });
  }
});

// Excel Import Validation
const importRowSchema = z.object({
  rowNumber: z.number(),
  productCode: z.string().trim(),
  barcode: z.string().trim().optional().default(''),
  name: z.string().trim(),
  productType: z.string().trim(),
  category: z.string().trim(),
  unit: z.string().trim(),
  minimumStock: z.union([z.number(), z.string()]),
  description: z.string().trim().optional().default(''),
  openingBalance: z.union([z.number(), z.string()]).optional().default(0),
});

router.post(
  '/import/validate',
  requireAuth,
  requirePermission('EXCEL_IMPORT'),
  async (req: AuthRequest, res) => {
    try {
      const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (rawRows.length === 0) {
        return res.status(400).json({ error: 'No rows provided', errorAr: 'الملف لا يحتوي على صفوف' });
      }

      const existingProducts = await db
        .select({ productCode: products.productCode, barcode: products.barcode })
        .from(products);
      const dbCodes = new Set(existingProducts.map((p) => p.productCode.toLowerCase()));
      const dbBarcodes = new Set(
        existingProducts.filter((p) => p.barcode).map((p) => p.barcode!.toLowerCase()),
      );

      const allCats = await db.select().from(categories);
      const allUnits = await db.select().from(units);

      const seenCodes = new Set<string>();
      const seenBarcodes = new Set<string>();

      const validRows: Array<{
        rowNumber: number;
        productCode: string;
        barcode: string | null;
        name: string;
        productType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
        categoryId: number;
        categoryLabel: string;
        unitId: number;
        unitLabel: string;
        minimumStock: number;
        description: string | null;
        openingBalance: number;
      }> = [];
      const errors: Array<{ rowNumber: number; productCode: string; errorAr: string; errorEn: string }> = [];

      for (const raw of rawRows) {
        const parsed = importRowSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push({
            rowNumber: Number(raw?.rowNumber || 0),
            productCode: String(raw?.productCode || ''),
            errorAr: 'صيغة الصف غير صالحة',
            errorEn: 'Invalid row structure',
          });
          continue;
        }

        const r = parsed.data;
        const rowErrorsAr: string[] = [];
        const rowErrorsEn: string[] = [];

        const code = r.productCode.toUpperCase();
        if (!code || code.length < 2) {
          rowErrorsAr.push('كود المنتج مطلوب');
          rowErrorsEn.push('Product Code is required');
        } else if (dbCodes.has(code.toLowerCase())) {
          rowErrorsAr.push(`كود المنتج ${code} موجود بالفعل في قاعدة البيانات`);
          rowErrorsEn.push(`Product Code ${code} already exists in database`);
        } else if (seenCodes.has(code.toLowerCase())) {
          rowErrorsAr.push(`كود المنتج ${code} مكرر داخل الملف`);
          rowErrorsEn.push(`Duplicate Product Code ${code} in Excel file`);
        }
        if (code) seenCodes.add(code.toLowerCase());

        const barcode = r.barcode.trim();
        if (barcode) {
          if (dbBarcodes.has(barcode.toLowerCase())) {
            rowErrorsAr.push(`الباركود ${barcode} مسجل مسبقاً في قاعدة البيانات`);
            rowErrorsEn.push(`Barcode ${barcode} already exists in database`);
          } else if (seenBarcodes.has(barcode.toLowerCase())) {
            rowErrorsAr.push(`الباركود ${barcode} مكرر داخل الملف`);
            rowErrorsEn.push(`Duplicate Barcode ${barcode} in Excel file`);
          }
          seenBarcodes.add(barcode.toLowerCase());
        }

        if (!r.name || r.name.length < 2) {
          rowErrorsAr.push('اسم المنتج مطلوب');
          rowErrorsEn.push('Product Name is required');
        }

        const rawType = r.productType.toUpperCase();
        let normalizedType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT' | null = null;
        if (rawType === 'RAW_MATERIAL' || rawType === 'RAW' || rawType.includes('خام')) {
          normalizedType = 'RAW_MATERIAL';
        } else if (
          rawType === 'FINISHED_PRODUCT' ||
          rawType === 'FINISHED' ||
          rawType.includes('تام')
        ) {
          normalizedType = 'FINISHED_PRODUCT';
        } else {
          rowErrorsAr.push('نوع المنتج يجب أن يكون RAW_MATERIAL أو FINISHED_PRODUCT');
          rowErrorsEn.push('Product Type must be RAW_MATERIAL or FINISHED_PRODUCT');
        }

        const matchedCat = allCats.find(
          (c) =>
            c.nameAr.toLowerCase() === r.category.toLowerCase() ||
            c.nameEn.toLowerCase() === r.category.toLowerCase() ||
            c.code.toLowerCase() === r.category.toLowerCase(),
        );
        if (!matchedCat) {
          rowErrorsAr.push(`التصنيف "${r.category}" غير معرف في النظام`);
          rowErrorsEn.push(`Category "${r.category}" not found`);
        } else if (normalizedType && matchedCat.productType !== normalizedType) {
          rowErrorsAr.push(`التصنيف "${r.category}" لا يطابق نوع المنتج`);
          rowErrorsEn.push(`Category "${r.category}" does not match product type`);
        }

        const matchedUnit = allUnits.find(
          (u) =>
            u.code.toLowerCase() === r.unit.toLowerCase() ||
            u.nameAr.toLowerCase() === r.unit.toLowerCase() ||
            u.nameEn.toLowerCase() === r.unit.toLowerCase() ||
            u.symbol.toLowerCase() === r.unit.toLowerCase(),
        );
        if (!matchedUnit) {
          rowErrorsAr.push(`الوحدة "${r.unit}" غير معرفة في النظام`);
          rowErrorsEn.push(`Unit "${r.unit}" not found`);
        }

        const minStock = Number(r.minimumStock || 0);
        if (!Number.isFinite(minStock) || minStock < 0) {
          rowErrorsAr.push('الحد الأدنى للمخزون غير صالح');
          rowErrorsEn.push('Minimum stock must be >= 0');
        }

        const opening = Number(r.openingBalance || 0);
        if (!Number.isFinite(opening) || opening < 0) {
          rowErrorsAr.push('الرصيد الافتتاحي غير صالح');
          rowErrorsEn.push('Opening balance must be >= 0');
        }

        if (rowErrorsAr.length > 0) {
          errors.push({
            rowNumber: r.rowNumber,
            productCode: code || '(فارغ)',
            errorAr: rowErrorsAr.join(' • '),
            errorEn: rowErrorsEn.join(' • '),
          });
        } else if (normalizedType && matchedCat && matchedUnit) {
          validRows.push({
            rowNumber: r.rowNumber,
            productCode: code,
            barcode: barcode || null,
            name: r.name,
            productType: normalizedType,
            categoryId: matchedCat.id,
            categoryLabel: matchedCat.nameAr,
            unitId: matchedUnit.id,
            unitLabel: matchedUnit.nameAr,
            minimumStock: minStock,
            description: r.description || null,
            openingBalance: opening,
          });
        }
      }

      res.json({
        totalRows: rawRows.length,
        validCount: validRows.length,
        errorCount: errors.length,
        validRows,
        errors,
      });
    } catch (error) {
      console.error('Import validation error:', error);
      res.status(500).json({ error: 'Validation failed' });
    }
  },
);

router.post(
  '/import/commit',
  requireAuth,
  requirePermission('EXCEL_IMPORT'),
  async (req: AuthRequest, res) => {
    try {
      const validRows = Array.isArray(req.body?.validRows) ? req.body.validRows : [];
      if (validRows.length === 0) {
        return res.status(400).json({ error: 'No valid rows to import', errorAr: 'لا توجد صفوف صالحة للاستيراد' });
      }

      const warehouseId = await getDefaultWarehouseId();
      const importedProducts: Array<{ id: number; productCode: string; openingBalance: number }> = [];

      await db.transaction(async (tx) => {
        for (const row of validRows) {
          const [created] = await tx
            .insert(products)
            .values({
              productCode: String(row.productCode).toUpperCase(),
              barcode: row.barcode || null,
              name: String(row.name),
              productType: row.productType,
              categoryId: Number(row.categoryId),
              unitId: Number(row.unitId),
              minimumStock: Number(row.minimumStock || 0).toFixed(3),
              description: row.description || null,
              status: 'ACTIVE',
              createdById: req.currentUser!.id,
            })
            .returning();

          await tx.insert(inventoryBalances).values({
            warehouseId,
            productId: created.id,
            openingBalance: '0.000',
            totalIn: '0.000',
            totalOut: '0.000',
            currentStock: '0.000',
          });

          importedProducts.push({
            id: created.id,
            productCode: created.productCode,
            openingBalance: Number(row.openingBalance || 0),
          });
        }

        await recordAuditLog(
          {
            userId: req.currentUser!.id,
            username: req.currentUser!.username,
            action: 'EXCEL_IMPORT_COMMIT',
            entity: 'products',
            newValue: { importedCount: importedProducts.length },
            ipAddress: getClientIp(req),
          },
          tx as unknown as typeof db,
        );
      });

      for (const item of importedProducts) {
        if (item.openingBalance > 0) {
          await executeStockMovement({
            productId: item.id,
            warehouseId,
            transactionType: 'OPENING_BALANCE',
            quantity: item.openingBalance,
            reason: 'رصيد افتتاحي عبر استيراد إكسل / Excel Import Opening Balance',
            userId: req.currentUser!.id,
            username: req.currentUser!.username,
            ipAddress: getClientIp(req),
          });
        }
      }

      return res.status(201).json({ importedCount: importedProducts.length });
    } catch (error) {
      console.error('Excel import commit error:', error);
      return res.status(500).json({
        error: 'Failed to commit Excel import',
        errorAr: 'فشل حفظ البيانات المستوردة (قد يوجد كود مكرر)',
      });
    }
  },
);

export default router;
