import bcrypt from 'bcryptjs';
import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  categories,
  permissions,
  rolePermissions,
  roles,
  systemSettings,
  units,
  users,
  warehouses,
} from './schema.ts';

let seedPromise: Promise<void> | null = null;

const DEFAULT_ROLES = [
  {
    code: 'ADMIN',
    nameAr: 'مدير النظام',
    nameEn: 'Administrator',
    description: 'Full permissions across users, products, inventory adjustments, settings, reports, and audit logs.',
  },
  {
    code: 'DATA_ENTRY',
    nameAr: 'موظف إدخال بيانات المستودع',
    nameEn: 'Warehouse Data Entry Employee',
    description: 'Register products, record incoming/outgoing stock, view current stock and personal transaction history.',
  },
  {
    code: 'MANAGER',
    nameAr: 'مدير / مشرف مراقبة',
    nameEn: 'Manager / Viewer',
    description: 'Monitor dashboard KPIs, stock balances, alerts, transactions, and export reports (read-only).',
  },
];

const DEFAULT_PERMISSIONS = [
  { code: 'USER_MANAGE', nameAr: 'إدارة المستخدمين والأدوار', nameEn: 'Manage Users & Roles', module: 'users' },
  { code: 'PRODUCT_CREATE', nameAr: 'إضافة منتجات', nameEn: 'Create Products', module: 'products' },
  { code: 'PRODUCT_EDIT', nameAr: 'تعديل وتعطيل المنتجات', nameEn: 'Edit & Deactivate Products', module: 'products' },
  { code: 'PRODUCT_VIEW', nameAr: 'عرض المنتجات والأرصدة', nameEn: 'View Products & Stock', module: 'products' },
  { code: 'STOCK_IN', nameAr: 'تسجيل وارد مخزني', nameEn: 'Record Stock In', module: 'inventory' },
  { code: 'STOCK_OUT', nameAr: 'تسجيل منصرف مخزني', nameEn: 'Record Stock Out', module: 'inventory' },
  { code: 'STOCK_ADJUST', nameAr: 'تسوية وعكس الحركات', nameEn: 'Inventory Adjustments & Reversals', module: 'inventory' },
  { code: 'TX_VIEW_ALL', nameAr: 'عرض جميع الحركات', nameEn: 'View All Transactions', module: 'transactions' },
  { code: 'TX_VIEW_OWN', nameAr: 'عرض الحركات الشخصية', nameEn: 'View Personal Transactions', module: 'transactions' },
  { code: 'CATEGORY_MANAGE', nameAr: 'إدارة التصنيفات', nameEn: 'Manage Categories', module: 'settings' },
  { code: 'UNIT_MANAGE', nameAr: 'إدارة الوحدات', nameEn: 'Manage Units', module: 'settings' },
  { code: 'SETTINGS_MANAGE', nameAr: 'إدارة إعدادات النظام', nameEn: 'Manage System Settings', module: 'settings' },
  { code: 'DASHBOARD_VIEW', nameAr: 'عرض لوحة المعلومات', nameEn: 'View Management Dashboard', module: 'dashboard' },
  { code: 'REPORTS_VIEW', nameAr: 'عرض وتصدير التقارير', nameEn: 'View & Export Reports', module: 'reports' },
  { code: 'AUDIT_VIEW', nameAr: 'عرض سجل التدقيق', nameEn: 'View Audit Logs', module: 'audit' },
  { code: 'EXCEL_IMPORT', nameAr: 'استيراد وتصدير إكسل', nameEn: 'Excel Import & Export', module: 'import' },
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  ADMIN: DEFAULT_PERMISSIONS.map((p) => p.code),
  DATA_ENTRY: [
    'PRODUCT_CREATE',
    'PRODUCT_VIEW',
    'STOCK_IN',
    'STOCK_OUT',
    'TX_VIEW_OWN',
  ],
  MANAGER: [
    'PRODUCT_VIEW',
    'TX_VIEW_ALL',
    'DASHBOARD_VIEW',
    'REPORTS_VIEW',
  ],
};

const DEFAULT_UNITS = [
  { code: 'PCS', nameAr: 'قطعة', nameEn: 'Piece', symbol: 'قطعة', allowFraction: false },
  { code: 'KG', nameAr: 'كيلوجرام', nameEn: 'Kilogram', symbol: 'كجم', allowFraction: true },
  { code: 'G', nameAr: 'جرام', nameEn: 'Gram', symbol: 'جم', allowFraction: true },
  { code: 'M', nameAr: 'متر', nameEn: 'Meter', symbol: 'م', allowFraction: true },
  { code: 'ROLL', nameAr: 'رول', nameEn: 'Roll', symbol: 'رول', allowFraction: true },
  { code: 'BOX', nameAr: 'علبة', nameEn: 'Box', symbol: 'علبة', allowFraction: false },
  { code: 'CARTON', nameAr: 'كرتونة', nameEn: 'Carton', symbol: 'كرتونة', allowFraction: false },
  { code: 'L', nameAr: 'لتر', nameEn: 'Liter', symbol: 'لتر', allowFraction: true },
  { code: 'TON', nameAr: 'طن', nameEn: 'Ton', symbol: 'طن', allowFraction: true },
];

const DEFAULT_CATEGORIES = [
  {
    code: 'CAT-RAW-YARN',
    nameAr: 'خيوط وغزول',
    nameEn: 'Yarns & Threads',
    productType: 'RAW_MATERIAL',
    description: 'خيوط قطنية وبوليستر وفسكوز وخيوط الحياكة',
  },
  {
    code: 'CAT-RAW-FABRIC',
    nameAr: 'أقمشة خام',
    nameEn: 'Greige & Raw Fabrics',
    productType: 'RAW_MATERIAL',
    description: 'أقمشة خام غير مصبوغة أو قبل التجهيز النهائي',
  },
  {
    code: 'CAT-RAW-DYE',
    nameAr: 'أصباغ ومواد كيميائية',
    nameEn: 'Dyes & Auxiliaries',
    productType: 'RAW_MATERIAL',
    description: 'أصباغ ومثبتات ومواد معالجة الأنسجة',
  },
  {
    code: 'CAT-RAW-ACC',
    nameAr: 'إكسسوارات ومستلزمات تغليف',
    nameEn: 'Trims & Packaging',
    productType: 'RAW_MATERIAL',
    description: 'سوست، أزرار، ملصقات، وأكياس تعبئة',
  },
  {
    code: 'CAT-FIN-FABRIC',
    nameAr: 'أقمشة منسوجة جاهزة',
    nameEn: 'Finished Woven Fabrics',
    productType: 'FINISHED_PRODUCT',
    description: 'أقمشة مصبوغة ومجهزة جاهزة للتسليم',
  },
  {
    code: 'CAT-FIN-KNIT',
    nameAr: 'منسوجات تريكو جاهزة',
    nameEn: 'Finished Knitted Textiles',
    productType: 'FINISHED_PRODUCT',
    description: 'أقمشة ومنتجات التريكو النهائية',
  },
  {
    code: 'CAT-FIN-GARMENT',
    nameAr: 'منتجات ومفروشات نهائية',
    nameEn: 'Finished Apparel & Home Textiles',
    productType: 'FINISHED_PRODUCT',
    description: 'منتجات نسيجية تامة الصنع ومغلفة للبيع',
  },
];

const DEFAULT_SETTINGS = [
  { key: 'company_name_ar', value: 'إيلا لصناعة المنسوجات', description: 'اسم الشركة بالعربية' },
  { key: 'company_name_en', value: 'ELA Textile Manufacturing Co.', description: 'Company name in English' },
  { key: 'timezone', value: 'Africa/Cairo', description: 'التوقيت المحلي المعتمد للنظام' },
  { key: 'default_language', value: 'ar', description: 'اللغة الافتراضية للنظام' },
  { key: 'max_login_attempts', value: '5', description: 'الحد الأقصى لمحاولات تسجيل الدخول الفاشلة' },
  { key: 'lockout_minutes', value: '15', description: 'مدة قفل الحساب بالدقائق بعد تجاوز المحاولات' },
  { key: 'auto_generate_barcode', value: 'true', description: 'توليد باركود تلقائي عند ترك الحقل فارغاً' },
];

async function runSeed() {
  // 1. Seed Roles
  for (const role of DEFAULT_ROLES) {
    await db
      .insert(roles)
      .values(role)
      .onConflictDoUpdate({
        target: roles.code,
        set: {
          nameAr: role.nameAr,
          nameEn: role.nameEn,
          description: role.description,
        },
      });
  }

  // 2. Seed Permissions
  for (const perm of DEFAULT_PERMISSIONS) {
    await db
      .insert(permissions)
      .values(perm)
      .onConflictDoUpdate({
        target: permissions.code,
        set: {
          nameAr: perm.nameAr,
          nameEn: perm.nameEn,
          module: perm.module,
        },
      });
  }

  // 3. Link Role -> Permissions
  const allRoles = await db.select().from(roles);
  const allPerms = await db.select().from(permissions);
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  for (const role of allRoles) {
    const allowedCodes = ROLE_PERMISSION_MAP[role.code] ?? [];
    for (const permCode of allowedCodes) {
      const permId = permByCode.get(permCode);
      if (permId) {
        await db
          .insert(rolePermissions)
          .values({ roleId: role.id, permissionId: permId })
          .onConflictDoNothing();
      }
    }
  }

  // 4. Seed Default Central Warehouse
  await db
    .insert(warehouses)
    .values({
      code: 'WH-MAIN',
      nameAr: 'المستودع المركزي الرئيسي',
      nameEn: 'Central Main Warehouse',
      location: 'المنطقة الصناعية - مصنع إيلا',
      isDefault: true,
      isActive: true,
    })
    .onConflictDoNothing();

  // 5. Seed Default Units
  for (const unit of DEFAULT_UNITS) {
    await db
      .insert(units)
      .values(unit)
      .onConflictDoNothing();
  }

  // 6. Seed Default Categories
  for (const cat of DEFAULT_CATEGORIES) {
    await db
      .insert(categories)
      .values(cat)
      .onConflictDoNothing();
  }

  // 7. Seed Default System Settings
  for (const setting of DEFAULT_SETTINGS) {
    await db
      .insert(systemSettings)
      .values(setting)
      .onConflictDoNothing();
  }

  // 8. Optional ENV-based Initial Admin Bootstrap (never hardcoded)
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  if (adminEmail && adminPassword) {
    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    if (userCount === 0) {
      const [adminRole] = await db.select().from(roles).where(eq(roles.code, 'ADMIN'));
      if (adminRole) {
        const passwordHash = await bcrypt.hash(adminPassword, 12);
        await db
          .insert(users)
          .values({
            username: adminEmail.split('@')[0] || 'admin',
            email: adminEmail.toLowerCase(),
            fullName: 'مدير النظام الرئيسي',
            passwordHash,
            roleId: adminRole.id,
            isActive: true,
          })
          .onConflictDoNothing();
      }
    }
  }
}

export async function ensureSeedData(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      console.error('Failed to seed reference data:', err);
      throw new Error('Database initialization failed', { cause: err });
    });
  }
  return seedPromise;
}
