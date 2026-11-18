import { ScanBarcode, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import type { Lang, ProductItem } from '../types/wms.ts';

interface SearchableProductSelectProps {
  lang: Lang;
  products: ProductItem[];
  selectedProduct: ProductItem | null;
  onSelect: (product: ProductItem | null) => void;
  autoFocusScanner?: boolean;
  activeOnly?: boolean;
}

export function SearchableProductSelect({
  lang,
  products,
  selectedProduct,
  onSelect,
  autoFocusScanner = true,
  activeOnly = true,
}: SearchableProductSelectProps) {
  const t = T[lang];
  const [scanInput, setScanInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoFocusScanner && !selectedProduct) {
      inputRef.current?.focus();
    }
  }, [autoFocusScanner, selectedProduct]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredProducts = useMemo(() => {
    const pool = activeOnly ? products.filter((p) => p.status === 'ACTIVE') : products;
    const q = scanInput.trim().toLowerCase();
    if (!q) return pool.slice(0, 30);
    return pool
      .filter(
        (p) =>
          p.productCode.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [products, scanInput, activeOnly]);

  const handleBarcodeLookup = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLookupError('');
    setLookingUp(true);
    try {
      const data = await apiRequest<{ product: ProductItem }>(
        `/api/products/lookup/${encodeURIComponent(trimmed)}`,
      );
      if (activeOnly && data.product.status !== 'ACTIVE') {
        setLookupError(
          lang === 'ar'
            ? 'هذا المنتج غير نشط ولا يمكن تسجيل حركة عليه'
            : 'This product is inactive',
        );
        return;
      }
      onSelect(data.product);
      setScanInput('');
      setDropdownOpen(false);
    } catch (err) {
      setLookupError(getErrorMessage(err, lang));
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <div ref={containerRef} className="space-y-2">
      <label className="block text-sm font-semibold text-slate-800">
        {t.scanOrSearch}
      </label>

      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="w-5 h-5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3.5 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onFocus={() => setDropdownOpen(true)}
              onChange={(e) => {
                setScanInput(e.target.value);
                setDropdownOpen(true);
                setLookupError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleBarcodeLookup(scanInput);
                }
              }}
              placeholder={t.scanPlaceholder}
              className="w-full h-12 ps-11 pe-10 bg-white border-2 border-slate-300 rounded-lg text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 transition-colors"
            />
            {scanInput && (
              <button
                type="button"
                onClick={() => {
                  setScanInput('');
                  setLookupError('');
                  inputRef.current?.focus();
                }}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={lookingUp || !scanInput.trim()}
            onClick={() => void handleBarcodeLookup(scanInput)}
            className="h-12 px-5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>{lookingUp ? t.loading : t.search}</span>
          </button>
        </div>

        {dropdownOpen && filteredProducts.length > 0 && (
          <div className="absolute z-30 mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto divide-y divide-slate-100">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  void handleBarcodeLookup(p.productCode);
                }}
                className="w-full px-4 py-3 text-start hover:bg-slate-50 flex items-center justify-between gap-4 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 font-mono">
                    <span>{p.productCode}</span>
                    {p.barcode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{p.barcode}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>
                      {p.productType === 'RAW_MATERIAL'
                        ? lang === 'ar'
                          ? 'مواد خام'
                          : 'Raw'
                        : lang === 'ar'
                          ? 'منتج تام'
                          : 'Finished'}
                    </span>
                  </div>
                </div>
                <div className="text-end shrink-0">
                  <div className="text-sm font-bold text-slate-900 tabular-nums">
                    {p.currentStock} {lang === 'ar' ? p.unitNameAr : p.unitCode}
                  </div>
                  <div className="text-xs text-slate-500">{t.currentStock}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {lookupError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium">
          {lookupError}
        </div>
      )}
    </div>
  );
}
