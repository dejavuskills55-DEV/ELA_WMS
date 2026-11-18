import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  CheckCircle2,
  ClipboardList,
  Package,
  PackagePlus,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  FIN_IN_REASONS,
  FIN_OUT_REASONS,
  RAW_IN_REASONS,
  RAW_OUT_REASONS,
  T,
  formatLocalDateTime,
  productTypeLabel,
  txTypeLabel,
} from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import type {
  CategoryItem,
  Lang,
  ProductItem,
  StockReceipt,
  StockTransactionItem,
  UnitItem,
  UserProfile,
} from '../types/wms.ts';
import { BarcodeSvg } from './BarcodeSvg.tsx';
import { SearchableProductSelect } from './SearchableProductSelect.tsx';

type Mode = 'HOME' | 'ADD_PRODUCT' | 'STOCK_IN' | 'STOCK_OUT' | 'CURRENT_STOCK' | 'MY_HISTORY';

interface DataEntryModuleProps {
  lang: Lang;
  user: UserProfile;
  categories: CategoryItem[];
  units: UnitItem[];
  products: ProductItem[];
  timezone: string;
  onRefreshData: () => Promise<void>;
}

export function DataEntryModule({
  lang,
  user,
  categories,
  units,
  products,
  timezone,
  onRefreshData,
}: DataEntryModuleProps) {
  const t = T[lang];
  const [mode, setMode] = useState<Mode>('HOME');
  const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;

  // --- ADD NEW PRODUCT STATE ---
  const [prodType, setProdType] = useState<'RAW_MATERIAL' | 'FINISHED_PRODUCT'>('RAW_MATERIAL');
  const [prodCode, setProdCode] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [autoBarcode, setAutoBarcode] = useState(true);
  const [prodName, setProdName] = useState('');
  const [prodCategoryId, setProdCategoryId] = useState<number | ''>('');
  const [prodUnitId, setProdUnitId] = useState<number | ''>('');
  const [prodMinStock, setProdMinStock] = useState('0');
  const [prodOpening, setProdOpening] = useState('0');
  const [prodDesc, setProdDesc] = useState('');
  const [uniqueWarn, setUniqueWarn] = useState<{ codeExists: boolean; barcodeExists: boolean }>({
    codeExists: false,
    barcodeExists: false,
  });
  const [showProdPreview, setShowProdPreview] = useState(false);
  const [prodSavedSuccess, setProdSavedSuccess] = useState<string | null>(null);

  // --- STOCK IN / OUT STATE ---
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [receipt, setReceipt] = useState<StockReceipt | null>(null);

  // --- CURRENT STOCK / MY HISTORY ---
  const [stockSearch, setStockSearch] = useState('');
  const [myTransactions, setMyTransactions] = useState<StockTransactionItem[]>([]);
  const [loadingMyTx, setLoadingMyTx] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.isActive && c.productType === prodType),
    [categories, prodType],
  );

  // Suggest product code when entering ADD_PRODUCT or switching prodType
  useEffect(() => {
    if (mode !== 'ADD_PRODUCT') return;
    let active = true;
    (async () => {
      try {
        const res = await apiRequest<{ suggestedCode: string }>(
          `/api/products/suggest-code?type=${prodType}`,
        );
        if (active) setProdCode(res.suggestedCode);
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, prodType]);

  // Default category & unit for ADD_PRODUCT
  useEffect(() => {
    if (filteredCategories.length > 0 && !filteredCategories.some((c) => c.id === prodCategoryId)) {
      setProdCategoryId(filteredCategories[0].id);
    }
  }, [filteredCategories, prodCategoryId]);

  useEffect(() => {
    if (units.length > 0 && !prodUnitId) {
      const kg = units.find((u) => u.code === 'KG');
      setProdUnitId(kg ? kg.id : units[0].id);
    }
  }, [units, prodUnitId]);

  // Immediate duplicate check
  useEffect(() => {
    if (mode !== 'ADD_PRODUCT' || (!prodCode.trim() && !prodBarcode.trim())) return;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (prodCode.trim()) params.set('productCode', prodCode.trim());
        if (prodBarcode.trim()) params.set('barcode', prodBarcode.trim());
        const res = await apiRequest<{ codeExists: boolean; barcodeExists: boolean }>(
          `/api/products/check-unique?${params.toString()}`,
        );
        setUniqueWarn(res);
      } catch {
        // ignore
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, prodCode, prodBarcode]);

  // Load personal history
  useEffect(() => {
    if (mode !== 'MY_HISTORY') return;
    setLoadingMyTx(true);
    apiRequest<{ transactions: StockTransactionItem[] }>('/api/inventory/transactions?limit=100')
      .then((res) => setMyTransactions(res.transactions))
      .catch(() => {})
      .finally(() => setLoadingMyTx(false));
  }, [mode]);

  const reasonOptions = useMemo(() => {
    if (!selectedProduct) return [];
    if (mode === 'STOCK_IN') {
      return selectedProduct.productType === 'RAW_MATERIAL' ? RAW_IN_REASONS : FIN_IN_REASONS;
    }
    return selectedProduct.productType === 'RAW_MATERIAL' ? RAW_OUT_REASONS : FIN_OUT_REASONS;
  }, [mode, selectedProduct]);

  useEffect(() => {
    if (reasonOptions.length > 0 && !reasonOptions.some((r) => r.value === reason)) {
      setReason(reasonOptions[0].value);
    }
  }, [reasonOptions, reason]);

  const resetStockWorkflow = () => {
    setSelectedProduct(null);
    setQty('');
    setReason('');
    setDestination('');
    setReferenceNumber('');
    setNotes('');
    setConfirmStep(false);
    setReceipt(null);
    setErrorMsg('');
    setIdempotencyKey(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  };

  const resetAddProduct = () => {
    setProdName('');
    setProdBarcode('');
    setProdMinStock('0');
    setProdOpening('0');
    setProdDesc('');
    setShowProdPreview(false);
    setProdSavedSuccess(null);
    setErrorMsg('');
    setUniqueWarn({ codeExists: false, barcodeExists: false });
  };

  const openMode = (next: Mode) => {
    setMode(next);
    setErrorMsg('');
    if (next === 'STOCK_IN' || next === 'STOCK_OUT') {
      resetStockWorkflow();
    } else if (next === 'ADD_PRODUCT') {
      resetAddProduct();
    }
  };

  const handleSaveNewProduct = async () => {
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ product: { productCode: string; name: string } }>('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          productType: prodType,
          productCode: prodCode.trim(),
          barcode: prodBarcode.trim() || null,
          generateBarcode: autoBarcode && !prodBarcode.trim(),
          name: prodName.trim(),
          categoryId: Number(prodCategoryId),
          unitId: Number(prodUnitId),
          minimumStock: Number(prodMinStock || 0),
          openingBalance: Number(prodOpening || 0),
          description: prodDesc.trim() || null,
        }),
      });
      await onRefreshData();
      setShowProdPreview(false);
      setProdSavedSuccess(
        lang === 'ar'
          ? `تم تسجيل المنتج (${res.product.productCode} - ${res.product.name}) بنجاح`
          : `Product (${res.product.productCode} - ${res.product.name}) registered successfully`,
      );
      setProdName('');
      setProdBarcode('');
      setProdDesc('');
      setProdOpening('0');
      const next = await apiRequest<{ suggestedCode: string }>(
        `/api/products/suggest-code?type=${prodType}`,
      );
      setProdCode(next.suggestedCode);
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitStockMovement = async () => {
    if (!selectedProduct) return;
    setErrorMsg('');
    setSubmitting(true);
    try {
      const endpoint = mode === 'STOCK_IN' ? '/api/inventory/stock-in' : '/api/inventory/stock-out';
      const res = await apiRequest<{ receipt: StockReceipt }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity: Number(qty),
          reason,
          destination: mode === 'STOCK_OUT' ? destination.trim() || null : null,
          referenceNumber: referenceNumber.trim() || null,
          notes: notes.trim() || null,
          idempotencyKey,
        }),
      });
      setReceipt(res.receipt);
      setConfirmStep(false);
      await onRefreshData();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setSubmitting(false);
    }
  };

  // HOME SCREEN: 3 LARGE ACTION BUTTONS
  if (mode === 'HOME') {
    return (
      <div className="max-w-5xl mx-auto py-4 space-y-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.deWelcome}</h1>
          <p className="text-slate-600 mt-1 text-base">{t.deSubtitle}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <button
            type="button"
            onClick={() => openMode('ADD_PRODUCT')}
            className="group p-7 bg-white border-2 border-slate-200 hover:border-slate-900 rounded-xl text-start transition-colors flex flex-col justify-between min-h-[210px] cursor-pointer"
          >
            <div className="w-14 h-14 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <PackagePlus className="w-7 h-7" />
            </div>
            <div className="mt-6">
              <div className="text-xl font-bold text-slate-900">{t.btnAddProduct}</div>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                {t.btnAddProductDesc}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => openMode('STOCK_IN')}
            className="group p-7 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-start transition-colors flex flex-col justify-between min-h-[210px] cursor-pointer"
          >
            <div className="w-14 h-14 rounded-xl bg-white/15 text-white flex items-center justify-center">
              <ArrowDownToLine className="w-7 h-7" />
            </div>
            <div className="mt-6">
              <div className="text-xl font-bold">{t.btnStockIn}</div>
              <p className="text-sm text-emerald-100 mt-1.5 leading-relaxed">
                {t.btnStockInDesc}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => openMode('STOCK_OUT')}
            className="group p-7 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-start transition-colors flex flex-col justify-between min-h-[210px] cursor-pointer"
          >
            <div className="w-14 h-14 rounded-xl bg-white/15 text-white flex items-center justify-center">
              <ArrowUpFromLine className="w-7 h-7" />
            </div>
            <div className="mt-6">
              <div className="text-xl font-bold">{t.btnStockOut}</div>
              <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">
                {t.btnStockOutDesc}
              </p>
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <button
            type="button"
            onClick={() => openMode('CURRENT_STOCK')}
            className="p-4 bg-white border border-slate-200 hover:border-slate-400 rounded-lg flex items-center gap-3 text-start cursor-pointer"
          >
            <Package className="w-5 h-5 text-slate-700 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">{t.btnCurrentStock}</div>
              <div className="text-xs text-slate-500">
                {lang === 'ar' ? 'البحث السريع عن الكميات المتوفرة' : 'Quick lookup of current quantities'}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => openMode('MY_HISTORY')}
            className="p-4 bg-white border border-slate-200 hover:border-slate-400 rounded-lg flex items-center gap-3 text-start cursor-pointer"
          >
            <ClipboardList className="w-5 h-5 text-slate-700 shrink-0" />
            <div>
              <div className="font-semibold text-slate-900">{t.btnMyHistory}</div>
              <div className="text-xs text-slate-500">
                {lang === 'ar' ? 'عرض الحركات التي قمت بتسجيلها' : 'View transactions recorded by you'}
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ADD NEW PRODUCT WORKFLOW
  if (mode === 'ADD_PRODUCT') {
    const selectedCategory = categories.find((c) => c.id === Number(prodCategoryId));
    const selectedUnit = units.find((u) => u.id === Number(prodUnitId));
    const canPreview =
      prodCode.trim().length >= 2 &&
      prodName.trim().length >= 2 &&
      Boolean(prodCategoryId) &&
      Boolean(prodUnitId) &&
      !uniqueWarn.codeExists &&
      !uniqueWarn.barcodeExists;

    return (
      <div className="max-w-3xl mx-auto py-2 space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMode('HOME')}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
          >
            <BackIcon className="w-4 h-4" />
            <span>{t.back}</span>
          </button>
          <h2 className="text-xl font-bold text-slate-900">{t.btnAddProduct}</h2>
        </div>

        {prodSavedSuccess && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-emerald-800 font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{prodSavedSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setProdSavedSuccess(null)}
              className="text-xs font-semibold text-emerald-700 underline cursor-pointer"
            >
              {lang === 'ar' ? 'إغلاق' : 'Dismiss'}
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700">
            {errorMsg}
          </div>
        )}

        {!showProdPreview ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            {/* Product Type Segmented Buttons */}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                {t.productType}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setProdType('RAW_MATERIAL')}
                  className={`h-12 rounded-lg font-bold text-sm border-2 transition-colors cursor-pointer ${
                    prodType === 'RAW_MATERIAL'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {t.rawMaterial} (RAW)
                </button>
                <button
                  type="button"
                  onClick={() => setProdType('FINISHED_PRODUCT')}
                  className={`h-12 rounded-lg font-bold text-sm border-2 transition-colors cursor-pointer ${
                    prodType === 'FINISHED_PRODUCT'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  {t.finishedProduct} (FIN)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.productCode} *
                </label>
                <input
                  type="text"
                  value={prodCode}
                  onChange={(e) => setProdCode(e.target.value.toUpperCase())}
                  dir="ltr"
                  className={`w-full h-12 px-3.5 border-2 rounded-lg text-base font-mono focus:outline-none ${
                    uniqueWarn.codeExists
                      ? 'border-red-500 bg-red-50'
                      : 'border-slate-300 focus:border-slate-900'
                  }`}
                />
                {uniqueWarn.codeExists && (
                  <p className="text-xs text-red-600 font-semibold mt-1">
                    {lang === 'ar' ? 'كود المنتج مسجل مسبقاً!' : 'Product code already exists!'}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.barcode}
                </label>
                <input
                  type="text"
                  value={prodBarcode}
                  onChange={(e) => setProdBarcode(e.target.value)}
                  dir="ltr"
                  placeholder={lang === 'ar' ? 'امسح أو اتركه للتوليد التلقائي' : 'Scan or leave blank'}
                  className={`w-full h-12 px-3.5 border-2 rounded-lg text-base font-mono focus:outline-none ${
                    uniqueWarn.barcodeExists
                      ? 'border-red-500 bg-red-50'
                      : 'border-slate-300 focus:border-slate-900'
                  }`}
                />
                {uniqueWarn.barcodeExists && (
                  <p className="text-xs text-red-600 font-semibold mt-1">
                    {lang === 'ar' ? 'الباركود مسجل مسبقاً!' : 'Barcode already exists!'}
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-slate-600 mt-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoBarcode}
                    onChange={(e) => setAutoBarcode(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>{t.autoGenerateBarcode}</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                {t.productName} *
              </label>
              <input
                type="text"
                value={prodName}
                onChange={(e) => setProdName(e.target.value)}
                placeholder={
                  lang === 'ar'
                    ? 'مثال: خيط قطن ممشط 30/1 أو قماش جيرسي كحلي'
                    : 'e.g. Combed Cotton Yarn 30/1'
                }
                className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base focus:outline-none focus:border-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.category} *
                </label>
                <select
                  value={prodCategoryId}
                  onChange={(e) => setProdCategoryId(Number(e.target.value))}
                  className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base bg-white focus:outline-none focus:border-slate-900"
                >
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {lang === 'ar' ? c.nameAr : c.nameEn}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.unit} *
                </label>
                <select
                  value={prodUnitId}
                  onChange={(e) => setProdUnitId(Number(e.target.value))}
                  className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base bg-white focus:outline-none focus:border-slate-900"
                >
                  {units
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {lang === 'ar' ? `${u.nameAr} (${u.code})` : `${u.nameEn} (${u.code})`}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.minStock}
                </label>
                <input
                  type="number"
                  min="0"
                  step={selectedUnit?.allowFraction ? '0.001' : '1'}
                  value={prodMinStock}
                  onChange={(e) => setProdMinStock(e.target.value)}
                  dir="ltr"
                  className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base font-mono focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  {t.openingBalance}
                </label>
                <input
                  type="number"
                  min="0"
                  step={selectedUnit?.allowFraction ? '0.001' : '1'}
                  value={prodOpening}
                  onChange={(e) => setProdOpening(e.target.value)}
                  dir="ltr"
                  className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base font-mono focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                {t.description}
              </label>
              <textarea
                rows={2}
                value={prodDesc}
                onChange={(e) => setProdDesc(e.target.value)}
                className="w-full p-3 border-2 border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
              />
            </div>

            <button
              type="button"
              disabled={!canPreview}
              onClick={() => setShowProdPreview(true)}
              className="w-full h-13 bg-slate-900 text-white rounded-lg text-base font-bold hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              {t.previewAndConfirm}
            </button>
          </div>
        ) : (
          <div className="bg-white border-2 border-slate-900 rounded-xl p-6 space-y-5">
            <h3 className="text-lg font-bold text-slate-900">
              {lang === 'ar' ? 'معاينة بيانات المنتج قبل الحفظ' : 'Product Preview Before Saving'}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <div className="text-slate-500">{t.productCode}</div>
                <div className="font-mono font-bold text-slate-900">{prodCode}</div>
              </div>
              <div>
                <div className="text-slate-500">{t.productType}</div>
                <div className="font-bold text-slate-900">{productTypeLabel(prodType, lang)}</div>
              </div>
              <div className="col-span-2">
                <div className="text-slate-500">{t.productName}</div>
                <div className="font-bold text-slate-900 text-base">{prodName}</div>
              </div>
              <div>
                <div className="text-slate-500">{t.category}</div>
                <div className="font-semibold text-slate-900">
                  {selectedCategory
                    ? lang === 'ar'
                      ? selectedCategory.nameAr
                      : selectedCategory.nameEn
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">{t.unit}</div>
                <div className="font-semibold text-slate-900">
                  {selectedUnit ? (lang === 'ar' ? selectedUnit.nameAr : selectedUnit.nameEn) : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">{t.minStock}</div>
                <div className="font-mono font-bold text-slate-900">{prodMinStock || 0}</div>
              </div>
              <div>
                <div className="text-slate-500">{t.openingBalance}</div>
                <div className="font-mono font-bold text-slate-900">{prodOpening || 0}</div>
              </div>
            </div>

            {prodBarcode.trim() && (
              <div className="flex justify-center p-3 border border-slate-200 rounded-lg">
                <BarcodeSvg value={prodBarcode.trim()} />
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowProdPreview(false)}
                className="flex-1 h-12 bg-white border-2 border-slate-300 text-slate-800 rounded-lg font-bold cursor-pointer"
              >
                {t.back}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSaveNewProduct()}
                className="flex-1 h-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold disabled:opacity-50 cursor-pointer"
              >
                {submitting ? t.loading : t.confirmSave}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // STOCK IN & STOCK OUT WORKFLOWS
  if (mode === 'STOCK_IN' || mode === 'STOCK_OUT') {
    const isOut = mode === 'STOCK_OUT';
    const qtyNum = Number(qty);
    const exceedsStock = Boolean(
      isOut && selectedProduct && Number.isFinite(qtyNum) && qtyNum > selectedProduct.currentStock,
    );
    const invalidFraction = Boolean(
      selectedProduct &&
        !selectedProduct.allowFraction &&
        Number.isFinite(qtyNum) &&
        qtyNum > 0 &&
        !Number.isInteger(qtyNum),
    );
    const canProceed =
      Boolean(selectedProduct) &&
      Number.isFinite(qtyNum) &&
      qtyNum > 0 &&
      !exceedsStock &&
      !invalidFraction &&
      Boolean(reason);

    return (
      <div className="max-w-3xl mx-auto py-2 space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMode('HOME')}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
          >
            <BackIcon className="w-4 h-4" />
            <span>{t.back}</span>
          </button>
          <h2 className="text-xl font-bold text-slate-900">
            {isOut ? t.btnStockOut : t.btnStockIn}
          </h2>
        </div>

        {/* RECEIPT VIEW AFTER SUCCESS */}
        {receipt ? (
          <div className="bg-white border-2 border-emerald-600 rounded-xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 className="w-8 h-8 shrink-0" />
              <div>
                <h3 className="text-xl font-bold">
                  {lang === 'ar'
                    ? 'تم تسجيل الحركة المخزنية بنجاح'
                    : 'Stock Transaction Recorded Successfully'}
                </h3>
                <div className="text-sm font-mono font-semibold text-slate-700">
                  {receipt.transaction.transactionNumber}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 bg-slate-50 p-5 rounded-lg border border-slate-200 text-sm">
              <div>
                <div className="text-slate-500">{t.productName}</div>
                <div className="font-bold text-slate-900">{receipt.product.name}</div>
                <div className="text-xs font-mono text-slate-500">{receipt.product.productCode}</div>
              </div>
              <div>
                <div className="text-slate-500">{t.quantity}</div>
                <div className="font-mono font-bold text-lg text-slate-900">
                  {Number(receipt.transaction.quantity)}{' '}
                  {lang === 'ar' ? receipt.product.unitNameAr : receipt.product.unitCode}
                </div>
              </div>
              <div>
                <div className="text-slate-500">
                  {lang === 'ar' ? 'الرصيد السابق' : 'Previous Stock'}
                </div>
                <div className="font-mono font-bold text-slate-800">{receipt.previousBalance}</div>
              </div>
              <div>
                <div className="text-slate-500">{lang === 'ar' ? 'الرصيد الجديد' : 'New Stock'}</div>
                <div className="font-mono font-bold text-lg text-emerald-700">
                  {receipt.newBalance}
                </div>
              </div>
              <div>
                <div className="text-slate-500">{lang === 'ar' ? 'الموظف' : 'Employee'}</div>
                <div className="font-semibold text-slate-900">{user.fullName}</div>
              </div>
              <div>
                <div className="text-slate-500">{lang === 'ar' ? 'التاريخ والوقت' : 'Timestamp'}</div>
                <div className="font-mono text-xs text-slate-800">
                  {formatLocalDateTime(receipt.transaction.createdAt, timezone, lang)}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={resetStockWorkflow}
                className="flex-1 h-13 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-5 h-5" />
                <span>{t.startAnother}</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-13 px-6 bg-white border border-slate-300 text-slate-800 rounded-lg font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>{lang === 'ar' ? 'طباعة الإيصال' : 'Print Receipt'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            {errorMsg && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700">
                {errorMsg}
              </div>
            )}

            {/* Step 1: Scan or Select Product */}
            <SearchableProductSelect
              lang={lang}
              products={products}
              selectedProduct={selectedProduct}
              onSelect={(p) => {
                setSelectedProduct(p);
                setErrorMsg('');
                setConfirmStep(false);
              }}
            />

            {/* Step 2 & 3: Selected Product Card */}
            {selectedProduct && (
              <>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-mono text-slate-500">
                      {selectedProduct.productCode} ·{' '}
                      {productTypeLabel(selectedProduct.productType, lang)}
                    </div>
                    <div className="text-lg font-bold text-slate-900 mt-0.5">
                      {selectedProduct.name}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-xs text-slate-500">{t.currentStock}</div>
                    <div className="text-2xl font-bold font-mono text-slate-900">
                      {selectedProduct.currentStock}{' '}
                      <span className="text-sm font-sans font-semibold text-slate-600">
                        {lang === 'ar' ? selectedProduct.unitNameAr : selectedProduct.unitCode}
                      </span>
                    </div>
                  </div>
                </div>

                {!confirmStep ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                          {t.quantity} * (
                          {lang === 'ar' ? selectedProduct.unitNameAr : selectedProduct.unitCode})
                        </label>
                        <input
                          type="number"
                          min="0"
                          step={selectedProduct.allowFraction ? '0.001' : '1'}
                          value={qty}
                          onChange={(e) => setQty(e.target.value)}
                          dir="ltr"
                          placeholder="0.000"
                          className={`w-full h-13 px-4 border-2 rounded-lg text-xl font-mono font-bold focus:outline-none ${
                            exceedsStock || invalidFraction
                              ? 'border-red-500 bg-red-50 text-red-700'
                              : 'border-slate-300 focus:border-slate-900'
                          }`}
                        />
                        {exceedsStock && (
                          <p className="text-xs text-red-600 font-bold mt-1">
                            {lang === 'ar'
                              ? `مرفوض: الكمية المطلوبة تتجاوز الرصيد المتاح (${selectedProduct.currentStock})`
                              : `Rejected: Requested quantity exceeds available stock (${selectedProduct.currentStock})`}
                          </p>
                        )}
                        {invalidFraction && (
                          <p className="text-xs text-red-600 font-bold mt-1">
                            {lang === 'ar'
                              ? 'هذه الوحدة لا تقبل كسور عشرية'
                              : 'This unit requires whole numbers'}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                          {t.reason} *
                        </label>
                        <select
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="w-full h-13 px-3.5 border-2 border-slate-300 rounded-lg text-base bg-white focus:outline-none focus:border-slate-900"
                        >
                          {reasonOptions.map((r) => (
                            <option key={r.value} value={r.value}>
                              {lang === 'ar' ? r.ar : r.en}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {isOut && (
                        <div>
                          <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                            {t.destination}
                          </label>
                          <input
                            type="text"
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                            placeholder={
                              lang === 'ar'
                                ? 'مثال: صالة النسيج / عميل ...'
                                : 'e.g. Weaving Dept / Customer...'
                            }
                            className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base focus:outline-none focus:border-slate-900"
                          />
                        </div>
                      )}

                      <div className={isOut ? '' : 'sm:col-span-2'}>
                        <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                          {t.referenceNumber}
                        </label>
                        <input
                          type="text"
                          value={referenceNumber}
                          onChange={(e) => setReferenceNumber(e.target.value)}
                          dir="ltr"
                          placeholder={lang === 'ar' ? 'رقم إذن الاستلام / الفاتورة' : 'Doc / PO / SO Number'}
                          className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base font-mono focus:outline-none focus:border-slate-900"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                        {t.notes}
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full h-12 px-3.5 border-2 border-slate-300 rounded-lg text-base focus:outline-none focus:border-slate-900"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!canProceed}
                      onClick={() => setConfirmStep(true)}
                      className={`w-full h-13 rounded-lg text-base font-bold text-white disabled:opacity-40 cursor-pointer ${
                        isOut
                          ? 'bg-slate-900 hover:bg-slate-800'
                          : 'bg-emerald-700 hover:bg-emerald-800'
                      }`}
                    >
                      {t.previewAndConfirm}
                    </button>
                  </div>
                ) : (
                  <div className="p-5 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-4">
                    <h4 className="font-bold text-slate-900 text-base">
                      {lang === 'ar'
                        ? 'تأكيد تسجيل الحركة المخزنية'
                        : 'Confirm Stock Transaction'}
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-slate-600">{t.quantity}: </span>
                        <strong className="font-mono">
                          {qtyNum}{' '}
                          {lang === 'ar' ? selectedProduct.unitNameAr : selectedProduct.unitCode}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-600">
                          {lang === 'ar' ? 'الرصيد المتوقع بعد العملية:' : 'New Projected Stock:'}{' '}
                        </span>
                        <strong className="font-mono">
                          {isOut
                            ? Number((selectedProduct.currentStock - qtyNum).toFixed(3))
                            : Number((selectedProduct.currentStock + qtyNum).toFixed(3))}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-600">{t.reason}: </span>
                        <strong>{reason}</strong>
                      </div>
                      {referenceNumber && (
                        <div>
                          <span className="text-slate-600">{t.referenceNumber}: </span>
                          <strong className="font-mono">{referenceNumber}</strong>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setConfirmStep(false)}
                        className="flex-1 h-12 bg-white border border-slate-300 rounded-lg font-bold text-slate-800 cursor-pointer"
                      >
                        {t.back}
                      </button>
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void handleSubmitStockMovement()}
                        className={`flex-1 h-12 text-white rounded-lg font-bold disabled:opacity-50 cursor-pointer ${
                          isOut
                            ? 'bg-slate-900 hover:bg-slate-800'
                            : 'bg-emerald-700 hover:bg-emerald-800'
                        }`}
                      >
                        {submitting ? t.loading : t.confirmSave}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // CURRENT STOCK SIMPLE VIEW
  if (mode === 'CURRENT_STOCK') {
    const filtered = products.filter(
      (p) =>
        p.productCode.toLowerCase().includes(stockSearch.toLowerCase()) ||
        (p.barcode && p.barcode.toLowerCase().includes(stockSearch.toLowerCase())) ||
        p.name.toLowerCase().includes(stockSearch.toLowerCase()),
    );

    return (
      <div className="max-w-5xl mx-auto py-2 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setMode('HOME')}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
          >
            <BackIcon className="w-4 h-4" />
            <span>{t.back}</span>
          </button>
          <h2 className="text-xl font-bold text-slate-900">{t.btnCurrentStock}</h2>
        </div>

        <input
          type="text"
          value={stockSearch}
          onChange={(e) => setStockSearch(e.target.value)}
          placeholder={t.scanPlaceholder}
          className="w-full h-12 px-4 bg-white border border-slate-300 rounded-lg text-base"
        />

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 text-start font-semibold">{t.productCode}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productType}</th>
                <th className="py-3 px-4 text-end font-semibold">{t.currentStock}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    {p.productCode}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900">{p.name}</td>
                  <td className="py-3 px-4 text-slate-600">
                    {productTypeLabel(p.productType, lang)}
                  </td>
                  <td className="py-3 px-4 text-end font-mono font-bold text-slate-900">
                    {p.currentStock} {lang === 'ar' ? p.unitNameAr : p.unitCode}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    {t.noData}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // PERSONAL TRANSACTION HISTORY
  return (
    <div className="max-w-5xl mx-auto py-2 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setMode('HOME')}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
        >
          <BackIcon className="w-4 h-4" />
          <span>{t.back}</span>
        </button>
        <h2 className="text-xl font-bold text-slate-900">{t.btnMyHistory}</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-3 px-4 text-start font-semibold">#</th>
              <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'العملية' : 'Operation'}
              </th>
              <th className="py-3 px-4 text-end font-semibold">{t.quantity}</th>
              <th className="py-3 px-4 text-end font-semibold">
                {lang === 'ar' ? 'الرصيد الجديد' : 'New Balance'}
              </th>
              <th className="py-3 px-4 text-start font-semibold">{t.reason}</th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'التوقيت' : 'Timestamp'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loadingMyTx ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            ) : myTransactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  {t.noData}
                </td>
              </tr>
            ) : (
              myTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs text-slate-700">
                    {tx.transactionNumber}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {tx.productName}{' '}
                    <span className="text-xs font-mono text-slate-500">({tx.productCode})</span>
                  </td>
                  <td className="py-3 px-4">{txTypeLabel(tx.transactionType, lang)}</td>
                  <td className="py-3 px-4 text-end font-mono font-bold">
                    {tx.quantity} {lang === 'ar' ? tx.unitNameAr : tx.unitCode}
                  </td>
                  <td className="py-3 px-4 text-end font-mono font-semibold">{tx.newBalance}</td>
                  <td className="py-3 px-4 text-slate-600">{tx.reason}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500">
                    {formatLocalDateTime(tx.createdAt, timezone, lang)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
