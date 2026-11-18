import { RotateCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  T,
  formatLocalDateTime,
  productTypeLabel,
  txTypeLabel,
} from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import type { Lang, StockTransactionItem, UserProfile } from '../types/wms.ts';

interface TransactionsHistoryViewProps {
  lang: Lang;
  user: UserProfile;
  timezone: string;
  onRefreshGlobal: () => Promise<void>;
}

export function TransactionsHistoryView({
  lang,
  user,
  timezone,
  onRefreshGlobal,
}: TransactionsHistoryViewProps) {
  const t = T[lang];
  const canReverse = user.permissions.includes('STOCK_ADJUST');

  const [transactions, setTransactions] = useState<StockTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [productType, setProductType] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [reverseTarget, setReverseTarget] = useState<StockTransactionItem | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState('');

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (search.trim()) params.set('search', search.trim());
      if (productType) params.set('productType', productType);
      if (transactionType) params.set('transactionType', transactionType);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const res = await apiRequest<{ transactions: StockTransactionItem[] }>(
        `/api/inventory/transactions?${params.toString()}`,
      );
      setTransactions(res.transactions);
    } catch (err) {
      console.error('Load transactions error:', err);
    } finally {
      setLoading(false);
    }
  }, [search, productType, transactionType, fromDate, toDate]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  const handleReverseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    setReverseError('');
    setReversing(true);
    try {
      await apiRequest(`/api/inventory/reverse/${reverseTarget.id}`, {
        method: 'POST',
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      setReverseTarget(null);
      setReverseReason('');
      await Promise.all([loadTransactions(), onRefreshGlobal()]);
    } catch (err) {
      setReverseError(getErrorMessage(err, lang));
    } finally {
      setReversing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.navTransactions}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {lang === 'ar'
            ? 'سجل تاريخي غير قابل للحذف أو التعديل الصامت؛ التصحيحات تتم عبر قيود عكسية موثقة'
            : 'Immutable stock ledger; corrections are recorded exclusively via documented reversals'}
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === 'ar'
                ? 'بحث برقم الحركة، الكود، الباركود، الموظف، المرجع...'
                : 'Search Tx#, Code, Barcode, Employee, Ref...'
            }
            className="w-full h-10 ps-9 pe-3 border border-slate-200 rounded-lg text-sm"
          />
        </div>
        <select
          value={productType}
          onChange={(e) => setProductType(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">{lang === 'ar' ? 'كل الأنواع' : 'All Product Types'}</option>
          <option value="RAW_MATERIAL">{t.rawMaterial}</option>
          <option value="FINISHED_PRODUCT">{t.finishedProduct}</option>
        </select>
        <select
          value={transactionType}
          onChange={(e) => setTransactionType(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="">{lang === 'ar' ? 'كل العمليات' : 'All Operations'}</option>
          <option value="STOCK_IN">{txTypeLabel('STOCK_IN', lang)}</option>
          <option value="STOCK_OUT">{txTypeLabel('STOCK_OUT', lang)}</option>
          <option value="OPENING_BALANCE">{txTypeLabel('OPENING_BALANCE', lang)}</option>
          <option value="ADJUSTMENT_IN">{txTypeLabel('ADJUSTMENT_IN', lang)}</option>
          <option value="ADJUSTMENT_OUT">{txTypeLabel('ADJUSTMENT_OUT', lang)}</option>
          <option value="REVERSAL">{txTypeLabel('REVERSAL', lang)}</option>
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-10 px-3 border border-slate-200 rounded-lg text-sm"
        />
      </div>

      {/* Immutable Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'رقم الحركة' : 'Tx ID'}
              </th>
              <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'النوع' : 'Operation'}
              </th>
              <th className="py-3 px-4 text-end font-semibold">{t.quantity}</th>
              <th className="py-3 px-4 text-end font-semibold">
                {lang === 'ar' ? 'السابق' : 'Prev'}
              </th>
              <th className="py-3 px-4 text-end font-semibold">
                {lang === 'ar' ? 'الجديد' : 'New'}
              </th>
              <th className="py-3 px-4 text-start font-semibold">{t.reason}</th>
              <th className="py-3 px-4 text-start font-semibold">{t.referenceNumber}</th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'الموظف' : 'Employee'}
              </th>
              <th className="py-3 px-4 text-start font-semibold">
                {lang === 'ar' ? 'التوقيت' : 'Timestamp'}
              </th>
              {canReverse && (
                <th className="py-3 px-4 text-end font-semibold">
                  {lang === 'ar' ? 'تصحيح' : 'Action'}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={canReverse ? 11 : 10} className="py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={canReverse ? 11 : 10} className="py-8 text-center text-slate-500">
                  {t.noData}
                </td>
              </tr>
            ) : (
              transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs text-slate-800 whitespace-nowrap">
                    {tx.transactionNumber}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{tx.productName}</div>
                    <div className="text-xs font-mono text-slate-500">
                      {tx.productCode} · {productTypeLabel(tx.productType, lang)}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium whitespace-nowrap">
                    {txTypeLabel(tx.transactionType, lang)}
                    {tx.isReversed && (
                      <div className="text-xs text-amber-700 font-semibold">
                        {lang === 'ar' ? '(تم عكسها)' : '(Reversed)'}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-end font-mono font-bold text-slate-900 whitespace-nowrap">
                    {tx.quantity} {lang === 'ar' ? tx.unitNameAr : tx.unitCode}
                  </td>
                  <td className="py-3 px-4 text-end font-mono text-slate-500">
                    {tx.previousBalance}
                  </td>
                  <td className="py-3 px-4 text-end font-mono font-semibold text-slate-900">
                    {tx.newBalance}
                  </td>
                  <td className="py-3 px-4 text-slate-600 max-w-xs">
                    <div>{tx.reason}</div>
                    {tx.destination && (
                      <div className="text-xs text-slate-400">{tx.destination}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600">
                    {tx.referenceNumber || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{tx.employeeName}</td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                    {formatLocalDateTime(tx.createdAt, timezone, lang)}
                  </td>
                  {canReverse && (
                    <td className="py-3 px-4 text-end">
                      {tx.transactionType !== 'REVERSAL' && !tx.isReversed && (
                        <button
                          type="button"
                          onClick={() => {
                            setReverseError('');
                            setReverseTarget(tx);
                          }}
                          className="px-2.5 py-1 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>{lang === 'ar' ? 'عكس' : 'Reverse'}</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Reversal Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleReverseSubmit}
            className="bg-white rounded-xl max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {lang === 'ar' ? 'تسجيل قيد عكسي للحركة' : 'Reverse Stock Transaction'}
              </h3>
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
              <div className="font-mono font-bold text-slate-900">
                {reverseTarget.transactionNumber}
              </div>
              <div>
                {reverseTarget.productName} · {reverseTarget.quantity}{' '}
                {lang === 'ar' ? reverseTarget.unitNameAr : reverseTarget.unitCode}
              </div>
            </div>

            {reverseError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {reverseError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {lang === 'ar' ? 'سبب القيد العكسي *' : 'Reversal Justification *'}
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder={lang === 'ar' ? 'مثال: خطأ في إدخال الكمية' : 'e.g. Entry quantity typo'}
                className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="px-4 h-10 border border-slate-300 rounded-lg text-sm font-semibold cursor-pointer"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={reversing}
                className="px-5 h-10 bg-red-700 hover:bg-red-800 text-white rounded-lg text-sm font-semibold cursor-pointer"
              >
                {reversing ? t.loading : lang === 'ar' ? 'تنفيذ العكس' : 'Confirm Reversal'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
