export type Lang = 'ar' | 'en';

export interface UserProfile {
  id: number;
  uid: string | null;
  username: string;
  email: string;
  fullName: string;
  roleCode: 'ADMIN' | 'DATA_ENTRY' | 'MANAGER' | string;
  roleNameAr: string;
  roleNameEn: string;
  isActive: boolean;
  permissions: string[];
}

export interface RoleItem {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  description: string | null;
}

export interface CategoryItem {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  productType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
  description: string | null;
  isActive: boolean;
}

export interface UnitItem {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
  symbol: string;
  allowFraction: boolean;
  isActive: boolean;
}

export interface UnitConversionItem {
  id: number;
  fromUnitId: number;
  toUnitId: number;
  factor: string;
  isActive: boolean;
}

export interface ProductItem {
  id: number;
  productCode: string;
  barcode: string | null;
  name: string;
  productType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
  categoryId: number;
  categoryNameAr: string;
  categoryNameEn: string;
  unitId: number;
  unitCode: string;
  unitNameAr: string;
  unitNameEn: string;
  unitSymbol: string;
  allowFraction: boolean;
  minimumStock: number;
  openingBalance?: number;
  totalIn?: number;
  totalOut?: number;
  currentStock: number;
  stockAlertStatus?: 'NORMAL' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  description: string | null;
  imageUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdByName?: string;
  createdAt?: string;
}

export interface StockTransactionItem {
  id: number;
  transactionNumber: string;
  productId: number;
  productCode: string;
  barcode?: string | null;
  productName: string;
  productType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
  unitCode: string;
  unitNameAr: string;
  unitNameEn?: string;
  transactionType: string;
  quantity: number;
  previousBalance: number;
  newBalance: number;
  reason: string;
  destination: string | null;
  referenceNumber: string | null;
  notes: string | null;
  reversedTransactionId: number | null;
  isReversed?: boolean;
  userId: number;
  employeeName: string;
  employeeUsername?: string;
  createdAt: string;
}

export interface StockReceipt {
  transaction: {
    id: number;
    transactionNumber: string;
    transactionType: string;
    quantity: string;
    previousBalance: string;
    newBalance: string;
    reason: string;
    destination: string | null;
    referenceNumber: string | null;
    notes: string | null;
    createdAt: string;
  };
  product: {
    id: number;
    productCode: string;
    name: string;
    productType: string;
    unitCode: string;
    unitNameAr: string;
    unitNameEn: string;
  };
  previousBalance: number;
  newBalance: number;
}

export interface StockAlertItem {
  productId: number;
  productCode: string;
  productName: string;
  productType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT';
  categoryNameAr?: string;
  unitNameAr: string;
  unitCode: string;
  currentStock: number;
  minimumStock: number;
  shortageAmount: number;
  alertType: 'LOW_STOCK' | 'OUT_OF_STOCK';
}

export interface NotificationItem {
  id: number;
  type: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  productId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface MetaResponse {
  roles: RoleItem[];
  categories: CategoryItem[];
  units: UnitItem[];
  warehouses: Array<{ id: number; code: string; nameAr: string; nameEn: string; isDefault: boolean }>;
  unitConversions: UnitConversionItem[];
  settings: Record<string, string>;
  unreadNotifications: number;
}
