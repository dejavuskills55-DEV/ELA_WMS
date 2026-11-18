import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { T } from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import { exportRowsToExcel } from '../lib/exportUtils.ts';
import type { Lang } from '../types/wms.ts';

interface ValidationResult {
  totalRows: number;
  validCount: number;
  errorCount: number;
  validRows: Array<{
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
  }>;
  errors: Array<{
    rowNumber: number;
    productCode: string;
    errorAr: string;
    errorEn: string;
  }>;
}

interface ExcelImportExportViewProps {
  lang: Lang;
  onRefresh: () => Promise<void>;
}

export function ExcelImportExportView({ lang, onRefresh }: ExcelImportExportViewProps) {
  const t = T[lang];
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmPartial, setConfirmPartial] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setSuccessMsg('');
    setValidation(null);
    setConfirmPartial(false);
    setValidating(true);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const mappedRows = rawJson.map((r, idx) => ({
        rowNumber: idx + 2,
        productCode: String(r['Product Code'] ?? r['كود المنتج'] ?? '').trim(),
        barcode: String(r['Barcode'] ?? r['الباركود'] ?? '').trim(),
        name: String(r['Product Name'] ?? r['اسم المنتج'] ?? '').trim(),
        productType: String(r['Product Type'] ?? r['نوع الصنف'] ?? '').trim(),
        category: String(r['Category'] ?? r['التصنيف'] ?? '').trim(),
        unit: String(r['Unit'] ?? r['الوحدة'] ?? '').trim(),
        minimumStock: r['Minimum Stock'] ?? r['الحد الأدنى'] ?? 0,
        description: String(r['Description'] ?? r['الوصف'] ?? '').trim(),
        openingBalance: r['Opening Balance'] ?? r['الرصيد الافتتاحي'] ?? 0,
      }));

      const res = await apiRequest<ValidationResult>('/api/products/import/validate', {
        method: 'POST',
        body: JSON.stringify({ rows: mappedRows }),
      });
      setValidation(res);
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setValidating(false);
      e.target.value = '';
    }
  };

  const handleDownloadErrorReport = () => {
    if (!validation || validation.errors.length === 0) return;
    const rows = validation.errors.map((err) => ({
      'Row Number': err.rowNumber,
      'Product Code': err.productCode,
      'Error (AR)': err.errorAr,
      'Error (EN)': err.errorEn,
    }));
    exportRowsToExcel('ELA_Import_Error_Report', 'Errors', rows);
  };

  const handleCommitImport = async () => {
    if (!validation || validation.validRows.length === 0) return;
    if (validation.errorCount > 0 && !confirmPartial) return;
    setCommitting(true);
    setErrorMsg('');
    try {
      const res = await apiRequest<{ importedCount: number }>('/api/products/import/commit', {
        method: 'POST',
        body: JSON.stringify({ validRows: validation.validRows }),
      });
      await onRefresh();
      setSuccessMsg(
        lang === 'ar'
          ? `تم استيراد ${res.importedCount} منتجاً بنجاح إلى قاعدة البيانات`
          : `Successfully imported ${res.importedCount} products into the database`,
      );
      setValidation(null);
      setConfirmPartial(false);
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.navImportExport}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {lang === 'ar'
            ? 'استيراد المنتجات من ملفات Excel مع التحقق الفوري من التكرار والأخطاء، أو تصدير الكتالوج والأرصدة'
            : 'Import products from Excel with pre-commit row validation, or export full catalog and balances'}
        </p>
      </div>

      {/* Template & Full Export Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="font-bold text-slate-900">
            {lang === 'ar' ? '1. تحميل نموذج الإدخال الرسمي' : '1. Download Official Excel Template'}
          </h3>
          <p className="text-sm text-slate-600">
            {lang === 'ar'
              ? 'يحتوي على الأعمدة المطلوبة: كود المنتج، الباركود، الاسم، النوع، التصنيف، الوحدة، الحد الأدنى، الوصف.'
              : 'Contains required columns: Product Code, Barcode, Product Name, Product Type, Category, Unit, Minimum Stock, Description.'}
          </p>
          <a
            href="/api/products/import/template"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800"
          >
            <Download className="w-4 h-4" />
            <span>{lang === 'ar' ? 'تحميل القالب (.xlsx)' : 'Download Template (.xlsx)'}</span>
          </a>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="font-bold text-slate-900">
            {lang === 'ar'
              ? '2. تصدير الكتالوج والأرصدة الحالية'
              : '2. Export Full Catalog & Stock Balances'}
          </h3>
          <p className="text-sm text-slate-600">
            {lang === 'ar'
              ? 'تصدير جميع المنتجات المسجلة مع أرصدة أول المدة، الوارد، المنصرف، والرصيد المتاح.'
              : 'Export every registered product with opening balance, total in, total out, and current stock.'}
          </p>
          <a
            href="/api/products/export/excel"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 text-white rounded-lg text-sm font-semibold hover:bg-emerald-800"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{lang === 'ar' ? 'تصدير الكتالوج (.xlsx)' : 'Export Catalog (.xlsx)'}</span>
          </a>
        </div>
      </div>

      {/* Upload & Validate */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <h3 className="font-bold text-slate-900">
          {lang === 'ar' ? '3. رفع ملف Excel للتحقق والاستيراد' : '3. Upload Excel File for Validation'}
        </h3>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-slate-900 rounded-xl p-8 cursor-pointer transition-colors">
          <Upload className="w-8 h-8 text-slate-500 mb-2" />
          <span className="text-sm font-semibold text-slate-800">
            {validating
              ? t.loading
              : lang === 'ar'
                ? 'اضغط هنا لاختيار ملف (.xlsx أو .xls)'
                : 'Click to choose an Excel file (.xlsx or .xls)'}
          </span>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2.5 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="w-5 h-5" />
            <span>{successMsg}</span>
          </div>
        )}

        {validation && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-xs text-slate-500">
                  {lang === 'ar' ? 'إجمالي الصفوف' : 'Total Rows'}
                </div>
                <div className="text-2xl font-bold font-mono">{validation.totalRows}</div>
              </div>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="text-xs text-emerald-700">
                  {lang === 'ar' ? 'صفوف صالحة' : 'Valid Rows'}
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-800">
                  {validation.validCount}
                </div>
              </div>
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-xs text-red-700">
                  {lang === 'ar' ? 'أخطاء مكتشفة' : 'Detected Errors'}
                </div>
                <div className="text-2xl font-bold font-mono text-red-800">
                  {validation.errorCount}
                </div>
              </div>
            </div>

            {validation.errors.length > 0 && (
              <div className="border border-red-200 rounded-xl overflow-hidden">
                <div className="bg-red-50 px-4 py-3 flex items-center justify-between border-b border-red-200">
                  <div className="flex items-center gap-2 text-red-800 font-bold text-sm">
                    <AlertCircle className="w-4 h-4" />
                    <span>
                      {lang === 'ar'
                        ? 'يجب مراجعة الأخطاء التالية قبل الحفظ'
                        : 'Review Validation Errors Before Commit'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadErrorReport}
                    className="px-3 py-1.5 bg-white border border-red-300 text-red-700 rounded-lg text-xs font-semibold hover:bg-red-100 cursor-pointer"
                  >
                    {lang === 'ar' ? 'تحميل تقرير الأخطاء (.xlsx)' : 'Download Error Report'}
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="py-2 px-3 text-start">{lang === 'ar' ? 'الصف' : 'Row'}</th>
                        <th className="py-2 px-3 text-start">{t.productCode}</th>
                        <th className="py-2 px-3 text-start">{lang === 'ar' ? 'الخطأ' : 'Error'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {validation.errors.map((err, i) => (
                        <tr key={i}>
                          <td className="py-2 px-3 font-mono">{err.rowNumber}</td>
                          <td className="py-2 px-3 font-mono font-bold">{err.productCode}</td>
                          <td className="py-2 px-3 text-red-700">
                            {lang === 'ar' ? err.errorAr : err.errorEn}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {validation.validCount > 0 && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                {validation.errorCount > 0 && (
                  <label className="flex items-center gap-2 text-sm font-semibold text-amber-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmPartial}
                      onChange={(e) => setConfirmPartial(e.target.checked)}
                    />
                    <span>
                      {lang === 'ar'
                        ? `أؤكد استيراد الصفوف الصالحة فقط (${validation.validCount}) وتجاهل الصفوف التي بها أخطاء (${validation.errorCount})`
                        : `I confirm importing only the ${validation.validCount} valid rows and skipping the ${validation.errorCount} invalid rows`}
                    </span>
                  </label>
                )}

                <button
                  type="button"
                  disabled={committing || (validation.errorCount > 0 && !confirmPartial)}
                  onClick={() => void handleCommitImport()}
                  className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer"
                >
                  {committing
                    ? t.loading
                    : lang === 'ar'
                      ? `اعتماد وحفظ ${validation.validCount} منتج في قاعدة البيانات`
                      : `Commit ${validation.validCount} Valid Products`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
