import type { Lang } from '../types/wms.ts';

export const RAW_IN_REASONS = [
  { value: 'Purchase', ar: 'شراء / توريد جديد', en: 'Purchase' },
  { value: 'Supplier Return', ar: 'مرتجع من مورد', en: 'Supplier Return' },
  { value: 'Inventory Adjustment', ar: 'تسوية جردية', en: 'Inventory Adjustment' },
  { value: 'Other', ar: 'أخرى', en: 'Other' },
];

export const FIN_IN_REASONS = [
  { value: 'Production Completion', ar: 'استلام من خط الإنتاج (إتمام تصنيع)', en: 'Production Completion' },
  { value: 'Customer Return', ar: 'مرتجع من عميل', en: 'Customer Return' },
  { value: 'Inventory Adjustment', ar: 'تسوية جردية', en: 'Inventory Adjustment' },
  { value: 'Other', ar: 'أخرى', en: 'Other' },
];

export const RAW_OUT_REASONS = [
  { value: 'Production Consumption', ar: 'صرف للتشغيل / خط الإنتاج', en: 'Production Consumption' },
  { value: 'Supplier Return', ar: 'مرتجع إلى مورد', en: 'Supplier Return' },
  { value: 'Waste / Scrap', ar: 'هالك / تالف تشغيل', en: 'Waste / Scrap' },
  { value: 'Other', ar: 'أخرى', en: 'Other' },
];

export const FIN_OUT_REASONS = [
  { value: 'Sales / Delivery', ar: 'مبيعات / تسليم طلبية', en: 'Sales / Delivery' },
  { value: 'Samples', ar: 'عينات تجارية', en: 'Samples' },
  { value: 'Customer Shipment', ar: 'شحن للعميل', en: 'Customer Shipment' },
  { value: 'Waste / Damaged Products', ar: 'هالك / منتجات تالفة', en: 'Waste / Damaged Products' },
  { value: 'Other', ar: 'أخرى', en: 'Other' },
];

export const TX_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  OPENING_BALANCE: { ar: 'رصيد افتتاحي', en: 'Opening Balance' },
  STOCK_IN: { ar: 'وارد مخزني', en: 'Stock In' },
  STOCK_OUT: { ar: 'منصرف مخزني', en: 'Stock Out' },
  ADJUSTMENT_IN: { ar: 'تسوية بالزيادة', en: 'Adjustment (+)' },
  ADJUSTMENT_OUT: { ar: 'تسوية بالعجز', en: 'Adjustment (-)' },
  REVERSAL: { ar: 'قيد عكسي', en: 'Reversal' },
};

export function txTypeLabel(type: string, lang: Lang): string {
  const entry = TX_TYPE_LABELS[type];
  if (!entry) return type;
  return lang === 'ar' ? entry.ar : entry.en;
}

export function productTypeLabel(type: string, lang: Lang): string {
  if (type === 'RAW_MATERIAL') return lang === 'ar' ? 'مواد خام' : 'Raw Material';
  return lang === 'ar' ? 'منتج تام' : 'Finished Product';
}

export function formatLocalDateTime(iso: string | Date, timezone = 'Africa/Cairo', lang: Lang = 'ar'): string {
  try {
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
      timeZone: timezone || 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return String(iso);
  }
}

export const T = {
  ar: {
    brandName: 'إيلا للمخازن',
    brandSub: 'نظام إدارة مستودعات النسيج',
    loginTitle: 'تسجيل الدخول إلى نظام المستودع',
    loginSubtitle: 'نظام إدارة المخزون المركزي لشركة إيلا لصناعة المنسوجات',
    setupTitle: 'الإعداد الأولي لحساب مدير النظام',
    setupSubtitle: 'لا توجد حسابات مسجلة حالياً. قم بإنشاء حساب المدير العام الأول للبدء.',
    usernameOrEmail: 'اسم المستخدم أو البريد الإلكتروني',
    username: 'اسم المستخدم',
    email: 'البريد الإلكتروني',
    fullName: 'الاسم الكامل',
    password: 'كلمة المرور',
    signIn: 'تسجيل الدخول',
    createAdmin: 'إنشاء حساب المدير وبدء التشغيل',
    googleSignIn: 'الدخول بحساب جوجل',
    orDivider: 'أو عبر حساب العمل',
    logout: 'تسجيل الخروج',
    // Nav
    navDataEntry: 'بوابة الإدخال السريع',
    navDashboard: 'لوحة الإدارة والمؤشرات',
    navProducts: 'كتالوج المنتجات والأرصدة',
    navTransactions: 'سجل الحركات المخزنية',
    navReports: 'التقارير والتصدير',
    navImportExport: 'استيراد وتصدير إكسل',
    navAdmin: 'الإدارة والإعدادات',
    navNotifications: 'التنبيهات',
    // Data Entry Home
    deWelcome: 'واجهة موظف المستودع السريعة',
    deSubtitle: 'اختر العملية المطلوبة لتسجيلها مباشرة في المستودع المركزي',
    btnAddProduct: 'إضافة منتج جديد',
    btnAddProductDesc: 'تعريف مادة خام أو منتج تام مع الباركود والحد الأدنى',
    btnStockIn: 'تسجيل وارد للمخزون',
    btnStockInDesc: 'إضافة كميات واردة من الموردين أو خطوط الإنتاج',
    btnStockOut: 'تسجيل منصرف من المخزون',
    btnStockOutDesc: 'صرف خامات للتشغيل أو شحن منتجات تامة للعملاء',
    btnCurrentStock: 'عرض الأرصدة الحالية',
    btnMyHistory: 'سجل حركاتي',
    // Common fields
    productType: 'نوع الصنف',
    rawMaterial: 'مواد خام',
    finishedProduct: 'منتج تام',
    productCode: 'كود المنتج',
    barcode: 'الباركود',
    autoGenerateBarcode: 'توليد باركود تلقائي إذا تُرك فارغاً',
    productName: 'اسم المنتج',
    category: 'التصنيف',
    unit: 'وحدة القياس',
    minStock: 'الحد الأدنى للمخزون',
    openingBalance: 'الرصيد الافتتاحي (اختياري)',
    description: 'الوصف (اختياري)',
    currentStock: 'الرصيد المتاح حالياً',
    quantity: 'الكمية',
    reason: 'السبب',
    destination: 'الجهة / القسم المستلم',
    referenceNumber: 'رقم المستند المرجعي',
    notes: 'ملاحظات إضافية (اختياري)',
    scanOrSearch: 'امسح الباركود أو أدخل كود المنتج أو ابحث بالاسم',
    scanPlaceholder: 'امسح الباركود هنا (USB Scanner) أو اكتب الكود ثم Enter...',
    previewAndConfirm: 'معاينة وتأكيد قبل الحفظ',
    confirmSave: 'تأكيد وحفظ نهائي',
    back: 'رجوع',
    cancel: 'إلغاء',
    save: 'حفظ',
    search: 'بحث',
    filter: 'تصفية',
    resetFilters: 'مسح الفلاتر',
    exportExcel: 'تصدير Excel',
    exportPdf: 'تصدير PDF',
    startAnother: 'تسجيل حركة أخرى فوراً',
    printBarcode: 'طباعة ملصق باركود',
    statusActive: 'نشط',
    statusInactive: 'موقوف',
    lowStock: 'نقص مخزون',
    outOfStock: 'نفد المخزون',
    normalStock: 'متوفر',
    noData: 'لا توجد بيانات مطابقة حالياً',
    loading: 'جاري التحميل...',
  },
  en: {
    brandName: 'ELA WMS',
    brandSub: 'Textile Warehouse Management',
    loginTitle: 'Sign In to Warehouse System',
    loginSubtitle: 'Central Inventory Control for ELA Textile Manufacturing',
    setupTitle: 'Initial Administrator Account Setup',
    setupSubtitle: 'No users exist yet. Create the primary Administrator account to begin.',
    usernameOrEmail: 'Username or Email',
    username: 'Username',
    email: 'Email Address',
    fullName: 'Full Name',
    password: 'Password',
    signIn: 'Sign In',
    createAdmin: 'Create Admin & Initialize System',
    googleSignIn: 'Sign in with Google',
    orDivider: 'or use employee credentials',
    logout: 'Sign Out',
    // Nav
    navDataEntry: 'Quick Data Entry',
    navDashboard: 'Management Dashboard',
    navProducts: 'Products & Stock',
    navTransactions: 'Transaction History',
    navReports: 'Reports & Export',
    navImportExport: 'Excel Import / Export',
    navAdmin: 'Administration',
    navNotifications: 'Alerts',
    // Data Entry Home
    deWelcome: 'Warehouse Data Entry Portal',
    deSubtitle: 'Select an operation to record directly into the central warehouse',
    btnAddProduct: 'ADD NEW PRODUCT',
    btnAddProductDesc: 'Register a raw material or finished product with barcode',
    btnStockIn: 'STOCK IN',
    btnStockInDesc: 'Record incoming stock from suppliers or production lines',
    btnStockOut: 'STOCK OUT',
    btnStockOutDesc: 'Issue materials to production or ship finished products',
    btnCurrentStock: 'View Current Stock',
    btnMyHistory: 'My Transactions',
    // Common fields
    productType: 'Product Type',
    rawMaterial: 'Raw Material',
    finishedProduct: 'Finished Product',
    productCode: 'Product Code',
    barcode: 'Barcode',
    autoGenerateBarcode: 'Auto-generate barcode if left blank',
    productName: 'Product Name',
    category: 'Category',
    unit: 'Unit of Measure',
    minStock: 'Minimum Stock Level',
    openingBalance: 'Opening Balance (Optional)',
    description: 'Description (Optional)',
    currentStock: 'Current Available Stock',
    quantity: 'Quantity',
    reason: 'Reason',
    destination: 'Destination / Department',
    referenceNumber: 'Reference Document No.',
    notes: 'Optional Notes',
    scanOrSearch: 'Scan barcode, enter code, or search by name',
    scanPlaceholder: 'Scan barcode (USB Scanner) or enter code & press Enter...',
    previewAndConfirm: 'Preview & Confirm Before Saving',
    confirmSave: 'Confirm & Submit',
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    search: 'Search',
    filter: 'Filter',
    resetFilters: 'Reset',
    exportExcel: 'Export Excel',
    exportPdf: 'Export PDF',
    startAnother: 'Start Another Transaction',
    printBarcode: 'Print Barcode Label',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    lowStock: 'Low Stock',
    outOfStock: 'Out of Stock',
    normalStock: 'In Stock',
    noData: 'No matching records found',
    loading: 'Loading...',
  },
} as const;
