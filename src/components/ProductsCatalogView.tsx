import {
  Barcode,
  Edit3,
  Plus,
  Printer,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { T, productTypeLabel } from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import type {
  CategoryItem,
  Lang,
  ProductItem,
  UnitItem,
  UserProfile,
} from '../types/wms.ts';
import { BarcodeSvg } from './BarcodeSvg.tsx';

interface ProductsCatalogViewProps {
  lang: Lang;
  user: UserProfile;
  products: ProductItem[];
  categories: CategoryItem[];
  units: UnitItem[];
  onRefresh: () => Promise<void>;
}

export function ProductsCatalogView({
  lang,
  user,
  products,
  categories,
  units,
  onRefresh,
}: ProductsCatalogViewProps) {
  const t = T[lang];
  const canCreate = user.permissions.includes('PRODUCT_CREATE');
  const canEdit = user.permissions.includes('PRODUCT_EDIT');
  const canAdjust = user.permissions.includes('STOCK_ADJUST');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [stockFilter, setStockFilter] = useState('');

  const [barcodeModalProduct, setBarcodeModalProduct] = useState<ProductItem | null>(null);
  const [editModalProduct, setEditModalProduct] = useState<ProductItem | null>(null);
  const [adjustModalProduct, setAdjustModalProduct] = useState<ProductItem | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Add/Edit form states
  const [formType, setFormType] = useState<'RAW_MATERIAL' | 'FINISHED_PRODUCT'>('RAW_MATERIAL');
  const [formCode, setFormCode] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<number>(0);
  const [formUnitId, setFormUnitId] = useState<number>(0);
  const [formMinStock, setFormMinStock] = useState('0');
  const [formOpening, setFormOpening] = useState('0');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // Adjustment modal states
  const [adjType, setAdjType] = useState<'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'OPENING_BALANCE'>(
    'ADJUSTMENT_IN',
  );
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjRef, setAdjRef] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter && p.productType !== typeFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (stockFilter && p.stockAlertStatus !== stockFilter) return false;
      if (q) {
        return (
          p.productCode.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, search, typeFilter, statusFilter, stockFilter]);

  const openAddModal = async () => {
    setError('');
    setFormType('RAW_MATERIAL');
    setFormBarcode('');
    setFormName('');
    setFormMinStock('0');
    setFormOpening('0');
    setFormDesc('');
    const defaultCat = categories.find((c) => c.productType === 'RAW_MATERIAL' && c.isActive);
    setFormCategoryId(defaultCat?.id || categories[0]?.id || 0);
    const kg = units.find((u) => u.code === 'KG') || units[0];
    setFormUnitId(kg?.id || 0);
    setShowAddModal(true);
    try {
      const res = await apiRequest<{ suggestedCode: string }>(
        '/api/products/suggest-code?type=RAW_MATERIAL',
      );
      setFormCode(res.suggestedCode);
    } catch {
      setFormCode('RAW-0001');
    }
  };

  const handleTypeSwitchInAdd = async (nextType: 'RAW_MATERIAL' | 'FINISHED_PRODUCT') => {
    setFormType(nextType);
    const matchingCat = categories.find((c) => c.productType === nextType && c.isActive);
    if (matchingCat) setFormCategoryId(matchingCat.id);
    try {
      const res = await apiRequest<{ suggestedCode: string }>(
        `/api/products/suggest-code?type=${nextType}`,
      );
      setFormCode(res.suggestedCode);
    } catch {
      // ignore
    }
  };

  const openEditModal = (p: ProductItem) => {
    setError('');
    setEditModalProduct(p);
    setFormName(p.name);
    setFormBarcode(p.barcode || '');
    setFormCategoryId(p.categoryId);
    setFormUnitId(p.unitId);
    setFormMinStock(String(p.minimumStock));
    setFormDesc(p.description || '');
    setFormStatus(p.status);
  };

  const handleSaveAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiRequest('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          productType: formType,
          productCode: formCode.trim(),
          barcode: formBarcode.trim() || null,
          generateBarcode: !formBarcode.trim(),
          name: formName.trim(),
          categoryId: formCategoryId,
          unitId: formUnitId,
          minimumStock: Number(formMinStock || 0),
          openingBalance: Number(formOpening || 0),
          description: formDesc.trim() || null,
        }),
      });
      await onRefresh();
      setShowAddModal(false);
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalProduct) return;
    setError('');
    setSaving(true);
    try {
      await apiRequest(`/api/products/${editModalProduct.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: formName.trim(),
          barcode: formBarcode.trim() || null,
          categoryId: formCategoryId,
          unitId: formUnitId,
          minimumStock: Number(formMinStock || 0),
          description: formDesc.trim() || null,
          status: formStatus,
        }),
      });
      await onRefresh();
      setEditModalProduct(null);
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustModalProduct) return;
    setError('');
    setSaving(true);
    try {
      await apiRequest('/api/inventory/adjustment', {
        method: 'POST',
        body: JSON.stringify({
          productId: adjustModalProduct.id,
          adjustmentType: adjType,
          quantity: Number(adjQty),
          reason: adjReason.trim(),
          referenceNumber: adjRef.trim() || null,
          idempotencyKey: `ADJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      await onRefresh();
      setAdjustModalProduct(null);
      setAdjQty('');
      setAdjReason('');
      setAdjRef('');
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.navProducts}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {lang === 'ar'
              ? `إجمالي الأصناف المسجلة: ${products.length}`
              : `Total registered catalog items: ${products.length}`}
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={() => void openAddModal()}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t.btnAddProduct}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.scanOrSearch}
          className="h-10 px-3.5 border border-slate-200 rounded-lg text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">{lang === 'ar' ? 'كل الأنواع' : 'All Types'}</option>
          <option value="RAW_MATERIAL">{t.rawMaterial}</option>
          <option value="FINISHED_PRODUCT">{t.finishedProduct}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">{lang === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
          <option value="ACTIVE">{t.statusActive}</option>
          <option value="INACTIVE">{t.statusInactive}</option>
        </select>
        <select
          value={stockFilter}
          onChange={(e) => setStockFilter(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">{lang === 'ar' ? 'كل مستويات المخزون' : 'All Stock Levels'}</option>
          <option value="NORMAL">{t.normalStock}</option>
          <option value="LOW_STOCK">{t.lowStock}</option>
          <option value="OUT_OF_STOCK">{t.outOfStock}</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-3 px-4 text-start font-semibold">{t.productCode}</th>
              <th className="py-3 px-4 text-start font-semibold">{t.barcode}</th>
              <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
              <th className="py-3 px-4 text-start font-semibold">{t.productType}</th>
              <th className="py-3 px-4 text-start font-semibold">{t.category}</th>
              <th className="py-3 px-4 text-end font-semibold">{t.currentStock}</th>
              <th className="py-3 px-4 text-end font-semibold">{t.minStock}</th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'الحالة' : 'Status'}
              </th>
              <th className="py-3 px-4 text-end font-semibold">
                {lang === 'ar' ? 'إجراءات' : 'Actions'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="py-3 px-4 font-mono font-bold text-slate-900">{p.productCode}</td>
                <td className="py-3 px-4 font-mono text-xs text-slate-600">{p.barcode || '—'}</td>
                <td className="py-3 px-4 font-semibold text-slate-900">{p.name}</td>
                <td className="py-3 px-4 text-slate-600">
                  {productTypeLabel(p.productType, lang)}
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {lang === 'ar' ? p.categoryNameAr : p.categoryNameEn}
                </td>
                <td className="py-3 px-4 text-end font-mono font-bold text-slate-900">
                  {p.currentStock} {lang === 'ar' ? p.unitNameAr : p.unitCode}
                </td>
                <td className="py-3 px-4 text-end font-mono text-slate-600">{p.minimumStock}</td>
                <td className="py-3 px-4 text-xs font-semibold">
                  {p.status === 'INACTIVE' ? (
                    <span className="text-slate-400">{t.statusInactive}</span>
                  ) : p.stockAlertStatus === 'OUT_OF_STOCK' ? (
                    <span className="text-red-700">{t.outOfStock}</span>
                  ) : p.stockAlertStatus === 'LOW_STOCK' ? (
                    <span className="text-amber-700">{t.lowStock}</span>
                  ) : (
                    <span className="text-emerald-700">{t.normalStock}</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      title={t.printBarcode}
                      onClick={() => setBarcodeModalProduct(p)}
                      className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                    >
                      <Barcode className="w-4 h-4" />
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        title={lang === 'ar' ? 'تعديل المنتج' : 'Edit Product'}
                        onClick={() => openEditModal(p)}
                        className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    {canAdjust && (
                      <button
                        type="button"
                        title={lang === 'ar' ? 'تسوية جردية' : 'Stock Adjustment'}
                        onClick={() => {
                          setError('');
                          setAdjustModalProduct(p);
                        }}
                        className="p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                      >
                        <SlidersHorizontal className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500">
                  {t.noData}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Barcode Label Modal */}
      {barcodeModalProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{t.printBarcode}</h3>
              <button
                type="button"
                onClick={() => setBarcodeModalProduct(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="border border-slate-300 rounded-lg p-5 text-center space-y-2">
              <div className="text-xs text-slate-500 font-semibold">{t.brandName}</div>
              <div className="font-bold text-slate-900">{barcodeModalProduct.name}</div>
              <div className="text-xs font-mono text-slate-600">
                {barcodeModalProduct.productCode}
              </div>
              <div className="flex justify-center pt-2">
                <BarcodeSvg
                  value={barcodeModalProduct.barcode || barcodeModalProduct.productCode}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full h-11 bg-slate-900 text-white rounded-lg font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>{lang === 'ar' ? 'طباعة الملصق' : 'Print Label'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAdd}
            className="bg-white rounded-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{t.btnAddProduct}</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleTypeSwitchInAdd('RAW_MATERIAL')}
                className={`h-10 rounded-lg text-sm font-bold border cursor-pointer ${
                  formType === 'RAW_MATERIAL'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                {t.rawMaterial}
              </button>
              <button
                type="button"
                onClick={() => void handleTypeSwitchInAdd('FINISHED_PRODUCT')}
                className={`h-10 rounded-lg text-sm font-bold border cursor-pointer ${
                  formType === 'FINISHED_PRODUCT'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200'
                }`}
              >
                {t.finishedProduct}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.productCode} *
                </label>
                <input
                  type="text"
                  required
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  dir="ltr"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.barcode}
                </label>
                <input
                  type="text"
                  value={formBarcode}
                  onChange={(e) => setFormBarcode(e.target.value)}
                  dir="ltr"
                  placeholder={lang === 'ar' ? 'توليد تلقائي' : 'Auto if empty'}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.productName} *
              </label>
              <input
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.category} *
                </label>
                <select
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(Number(e.target.value))}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {categories
                    .filter((c) => c.productType === formType && c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {lang === 'ar' ? c.nameAr : c.nameEn}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.unit} *
                </label>
                <select
                  value={formUnitId}
                  onChange={(e) => setFormUnitId(Number(e.target.value))}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {units
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {lang === 'ar' ? u.nameAr : u.nameEn}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.minStock}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={formMinStock}
                  onChange={(e) => setFormMinStock(e.target.value)}
                  dir="ltr"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.openingBalance}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={formOpening}
                  onChange={(e) => setFormOpening(e.target.value)}
                  dir="ltr"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.description}
              </label>
              <textarea
                rows={2}
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 h-10 border border-slate-300 rounded-lg text-sm font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {saving ? t.loading : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Product Modal (ADMIN) */}
      {editModalProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'تعديل الصنف' : 'Edit Product'} · {editModalProduct.productCode}
              </h3>
              <button
                type="button"
                onClick={() => setEditModalProduct(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.productName}
              </label>
              <input
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.barcode}
                </label>
                <input
                  type="text"
                  value={formBarcode}
                  onChange={(e) => setFormBarcode(e.target.value)}
                  dir="ltr"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.minStock}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={formMinStock}
                  onChange={(e) => setFormMinStock(e.target.value)}
                  dir="ltr"
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t.category}
                </label>
                <select
                  value={formCategoryId}
                  onChange={(e) => setFormCategoryId(Number(e.target.value))}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  {categories
                    .filter((c) => c.productType === editModalProduct.productType)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {lang === 'ar' ? c.nameAr : c.nameEn}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {lang === 'ar' ? 'الحالة' : 'Status'}
                </label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
                >
                  <option value="ACTIVE">{t.statusActive}</option>
                  <option value="INACTIVE">{t.statusInactive}</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditModalProduct(null)}
                className="px-4 h-10 border border-slate-300 rounded-lg text-sm font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold cursor-pointer"
              >
                {saving ? t.loading : t.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Adjustment Modal (ADMIN) */}
      {adjustModalProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAdjustment}
            className="bg-white rounded-xl max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'تسوية جردية معتمدة' : 'Authorized Stock Adjustment'}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustModalProduct(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              <div className="font-bold text-slate-900">{adjustModalProduct.name}</div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono">
                {t.currentStock}: {adjustModalProduct.currentStock}{' '}
                {lang === 'ar' ? adjustModalProduct.unitNameAr : adjustModalProduct.unitCode}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {lang === 'ar' ? 'نوع التسوية' : 'Adjustment Type'}
              </label>
              <select
                value={adjType}
                onChange={(e) =>
                  setAdjType(
                    e.target.value as 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'OPENING_BALANCE',
                  )
                }
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="ADJUSTMENT_IN">
                  {lang === 'ar' ? 'تسوية بالزيادة (+)' : 'Adjustment Increase (+)'}
                </option>
                <option value="ADJUSTMENT_OUT">
                  {lang === 'ar' ? 'تسوية بالعجز (-)' : 'Adjustment Decrease (-)'}
                </option>
                <option value="OPENING_BALANCE">
                  {lang === 'ar' ? 'رصيد افتتاحي موثق' : 'Documented Opening Balance'}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.quantity} *
              </label>
              <input
                type="number"
                required
                min="0.001"
                step={adjustModalProduct.allowFraction ? '0.001' : '1'}
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                dir="ltr"
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.reason} *
              </label>
              <input
                type="text"
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder={lang === 'ar' ? 'سبب التسوية الجردية' : 'Audit / count justification'}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t.referenceNumber}
              </label>
              <input
                type="text"
                value={adjRef}
                onChange={(e) => setAdjRef(e.target.value)}
                dir="ltr"
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setAdjustModalProduct(null)}
                className="px-4 h-10 border border-slate-300 rounded-lg text-sm font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold cursor-pointer"
              >
                {saving ? t.loading : t.confirmSave}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
