import { FileDown, FileSpreadsheet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  T,
  formatLocalDateTime,
  productTypeLabel,
  txTypeLabel,
} from '../i18n/translations.ts';
import { apiRequest } from '../lib/api.ts';
import { exportReportToPdf, exportRowsToExcel } from '../lib/exportUtils.ts';
import type { Lang, ProductItem } from '../types/wms.ts';

interface ReportsViewProps {
  lang: Lang;
  products: ProductItem[];
  timezone: string;
}

const REPORT_DEFS = [
  { id: 'current-inventory', ar: '1. تقرير المخزون الحالي الشامل', en: '1. Current Inventory Report' },
  { id: 'raw-materials', ar: '2. تقرير مخزون المواد الخام', en: '2. Raw Materials Inventory Report' },
  { id: 'finished-products', ar: '3. تقرير مخزون المنتجات التامة', en: '3. Finished Products Inventory Report' },
  { id: 'incoming-transactions', ar: '4. تقرير حركات الوارد المخزني', en: '4. Incoming Transactions Report' },
  { id: 'outgoing-transactions', ar: '5. تقرير حركات المنصرف المخزني', en: '5. Outgoing Transactions Report' },
  { id: 'low-stock', ar: '6. تقرير الأصناف منخفضة المخزون', en: '6. Low Stock Report' },
  { id: 'out-of-stock', ar: '7. تقرير الأصناف النافدة', en: '7. Out of Stock Report' },
  { id: 'product-movement', ar: '8. تقرير حركة صنف محدد', en: '8. Product Movement History' },
  { id: 'employee-activity', ar: '9. تقرير نشاط الموظفين', en: '9. Employee Activity Report' },
  { id: 'daily-inventory', ar: '10. التقرير اليومي لحركة المخزون', en: '10. Daily Inventory Report' },
  { id: 'monthly-inventory', ar: '11. التقرير الشهري لحركة المخزون', en: '11. Monthly Inventory Report' },
];

export function ReportsView({ lang, products, timezone }: ReportsViewProps) {
  const t = T[lang];
  const [selectedReport, setSelectedReport] = useState(REPORT_DEFS[0].id);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [productType, setProductType] = useState('');
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (productType) params.set('productType', productType);
      if (productId && selectedReport === 'product-movement') params.set('productId', productId);

      const res = await apiRequest<{ rows: Array<Record<string, unknown>> }>(
        `/api/dashboard/reports/${selectedReport}?${params.toString()}`,
      );
      setRows(res.rows);
    } catch (err) {
      console.error('Report load error:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedReport, fromDate, toDate, productType, productId]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const activeDef = REPORT_DEFS.find((r) => r.id === selectedReport) || REPORT_DEFS[0];

  const columns = useMemo(() => {
    if (
      selectedReport === 'current-inventory' ||
      selectedReport === 'raw-materials' ||
      selectedReport === 'finished-products' ||
      selectedReport === 'low-stock' ||
      selectedReport === 'out-of-stock'
    ) {
      const base = [
        { key: 'productCode', label: t.productCode },
        { key: 'name', label: t.productName },
        { key: 'productTypeLabel', label: t.productType },
        { key: 'categoryNameAr', label: t.category },
        { key: 'openingBalance', label: lang === 'ar' ? 'رصيد أول' : 'Opening' },
        { key: 'totalIn', label: lang === 'ar' ? 'إجمالي الوارد' : 'Total In' },
        { key: 'totalOut', label: lang === 'ar' ? 'إجمالي المنصرف' : 'Total Out' },
        { key: 'currentStock', label: t.currentStock },
        { key: 'minimumStock', label: t.minStock },
      ];
      if (selectedReport === 'low-stock' || selectedReport === 'out-of-stock') {
        base.push({ key: 'shortageAmount', label: lang === 'ar' ? 'العجز' : 'Shortage' });
      }
      return base;
    }

    if (
      selectedReport === 'incoming-transactions' ||
      selectedReport === 'outgoing-transactions' ||
      selectedReport === 'product-movement'
    ) {
      return [
        { key: 'transactionNumber', label: lang === 'ar' ? 'رقم الحركة' : 'Tx#' },
        { key: 'productCode', label: t.productCode },
        { key: 'productName', label: t.productName },
        { key: 'txTypeDisplay', label: lang === 'ar' ? 'العملية' : 'Operation' },
        { key: 'quantity', label: t.quantity },
        { key: 'previousBalance', label: lang === 'ar' ? 'السابق' : 'Prev' },
        { key: 'newBalance', label: lang === 'ar' ? 'الجديد' : 'New' },
        { key: 'reason', label: t.reason },
        { key: 'employeeName', label: lang === 'ar' ? 'الموظف' : 'Employee' },
        { key: 'formattedTime', label: lang === 'ar' ? 'التاريخ' : 'Date' },
      ];
    }

    if (selectedReport === 'employee-activity') {
      return [
        { key: 'employeeName', label: lang === 'ar' ? 'الموظف' : 'Employee' },
        { key: 'username', label: t.username },
        { key: 'totalTransactions', label: lang === 'ar' ? 'عدد الحركات' : 'Transactions' },
        { key: 'totalInQty', label: lang === 'ar' ? 'كمية الوارد' : 'Total In' },
        { key: 'totalOutQty', label: lang === 'ar' ? 'كمية المنصرف' : 'Total Out' },
        { key: 'formattedLast', label: lang === 'ar' ? 'آخر نشاط' : 'Last Activity' },
      ];
    }

    return [
      { key: 'period', label: lang === 'ar' ? 'الفترة' : 'Period' },
      { key: 'transactionCount', label: lang === 'ar' ? 'عدد الحركات' : 'Transactions' },
      { key: 'incomingQty', label: lang === 'ar' ? 'إجمالي الوارد' : 'Incoming Qty' },
      { key: 'outgoingQty', label: lang === 'ar' ? 'إجمالي المنصرف' : 'Outgoing Qty' },
      { key: 'netChange', label: lang === 'ar' ? 'صافي التغير' : 'Net Change' },
    ];
  }, [selectedReport, lang, t]);

  const formattedRows = useMemo(() => {
    return rows.map((r) => ({
      ...r,
      productTypeLabel: r.productType ? productTypeLabel(String(r.productType), lang) : '',
      txTypeDisplay: r.transactionType ? txTypeLabel(String(r.transactionType), lang) : '',
      formattedTime: r.createdAt
        ? formatLocalDateTime(String(r.createdAt), timezone, lang)
        : '',
      formattedLast: r.lastActivityAt
        ? formatLocalDateTime(String(r.lastActivityAt), timezone, lang)
        : '',
    }));
  }, [rows, lang, timezone]);

  const handleExportExcel = () => {
    const excelRows = formattedRows.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const col of columns) {
        obj[col.label] = row[col.key as keyof typeof row] ?? '';
      }
      return obj;
    });
    exportRowsToExcel(`ELA_Report_${selectedReport}`, activeDef.en.slice(0, 28), excelRows);
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await exportReportToPdf({
        filename: `ELA_Report_${selectedReport}`,
        title: lang === 'ar' ? activeDef.ar : activeDef.en,
        subtitle:
          fromDate || toDate
            ? `${fromDate || '...'} → ${toDate || '...'}`
            : lang === 'ar'
              ? 'جميع الفترات'
              : 'All Dates',
        lang,
        columns,
        rows: formattedRows,
      });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.navReports}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {lang === 'ar'
              ? '11 تقريراً تفصيلياً مع دعم التصدير إلى Excel و PDF باللغة العربية'
              : '11 operational reports with Excel and Arabic RTL PDF export'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={formattedRows.length === 0}
            onClick={handleExportExcel}
            className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-2 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t.exportExcel}</span>
          </button>
          <button
            type="button"
            disabled={formattedRows.length === 0 || exportingPdf}
            onClick={() => void handleExportPdf()}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-40 flex items-center gap-2 cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>{exportingPdf ? t.loading : t.exportPdf}</span>
          </button>
        </div>
      </div>

      {/* Report Selector + Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {lang === 'ar' ? 'اختر التقرير' : 'Select Report'}
          </label>
          <select
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value)}
            className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm font-semibold bg-white"
          >
            {REPORT_DEFS.map((r) => (
              <option key={r.id} value={r.id}>
                {lang === 'ar' ? r.ar : r.en}
              </option>
            ))}
          </select>
        </div>

        {selectedReport === 'product-movement' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t.productName}
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
            >
              <option value="">{lang === 'ar' ? 'كل المنتجات' : 'All Products'}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productCode} - {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t.productType}
            </label>
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              <option value="RAW_MATERIAL">{t.rawMaterial}</option>
              <option value="FINISHED_PRODUCT">{t.finishedProduct}</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {lang === 'ar' ? 'من تاريخ' : 'From Date'}
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            {lang === 'ar' ? 'إلى تاريخ' : 'To Date'}
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm"
          />
        </div>
      </div>

      {/* Report Data Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="py-3 px-4 text-start font-semibold whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-slate-500">
                  {t.loading}
                </td>
              </tr>
            ) : formattedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-slate-500">
                  {t.noData}
                </td>
              </tr>
            ) : (
              formattedRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  {columns.map((c) => (
                    <td key={c.key} className="py-3 px-4 text-slate-800 whitespace-nowrap tabular-nums">
                      {String(row[c.key as keyof typeof row] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
