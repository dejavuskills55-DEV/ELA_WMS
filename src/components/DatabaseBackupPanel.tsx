import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { T, formatLocalDateTime } from '../i18n/translations.ts';
import { apiRequest, buildAuthHeaders, getErrorMessage } from '../lib/api.ts';
import type { Lang } from '../types/wms.ts';

interface BackupSummaryResponse {
  counts: {
    warehouses: number;
    categories: number;
    units: number;
    products: number;
    inventoryBalances: number;
    stockTransactions: number;
    users: number;
  };
  recentEvents: Array<{
    id: number;
    username: string | null;
    action: string;
    newValue: unknown;
    createdAt: string;
  }>;
}

interface BackupValidationResponse {
  valid: boolean;
  checksumVerified: boolean;
  signatureVerified: boolean;
  exportedAt?: string;
  exportedBy?: string;
  schemaVersion?: string;
  counts?: {
    warehouses: number;
    categories: number;
    units: number;
    unitConversions: number;
    products: number;
    inventoryBalances: number;
    stockTransactions: number;
    systemSettings: number;
    users: number;
  };
  warnings: Array<{ ar: string; en: string }>;
  errors: Array<{ ar: string; en: string }>;
}

interface DatabaseBackupPanelProps {
  lang: Lang;
  timezone: string;
  onRefreshGlobal: () => Promise<void>;
}

export function DatabaseBackupPanel({
  lang,
  timezone,
  onRefreshGlobal,
}: DatabaseBackupPanelProps) {
  const t = T[lang];
  const [summary, setSummary] = useState<BackupSummaryResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [selectedFileName, setSelectedFileName] = useState('');
  const [parsedSnapshot, setParsedSnapshot] = useState<unknown>(null);
  const [validation, setValidation] = useState<BackupValidationResponse | null>(null);
  const [restoreMode, setRestoreMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [confirmPhrase, setConfirmPhrase] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      const res = await apiRequest<BackupSummaryResponse>('/api/backup/summary');
      setSummary(res);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleDownloadSnapshot = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setDownloading(true);
    try {
      const headers = await buildAuthHeaders();

      const res = await fetch('/api/backup', {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          (lang === 'ar' && errBody.errorAr) || errBody.error || 'Snapshot download failed',
        );
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ELA_WMS_Snapshot_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessMsg(
        lang === 'ar'
          ? 'تم تنزيل نسخة قاعدة البيانات الكاملة والتحقق من بصمة SHA-256 بنجاح'
          : 'Full database snapshot downloaded with SHA-256 integrity checksum',
      );
      await loadSummary();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setDownloading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg('');
    setSuccessMsg('');
    setValidation(null);
    setParsedSnapshot(null);
    setConfirmPhrase('');
    setSelectedFileName(file.name);
    setValidating(true);

    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          lang === 'ar'
            ? 'الملف المرفوع ليس بصيغة JSON صالحة'
            : 'Uploaded file is not valid JSON',
        );
      }

      setParsedSnapshot(json);

      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });

      const res = await fetch('/api/backup/validate', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ snapshot: json }),
      });
      const body = (await res.json()) as BackupValidationResponse;
      setValidation(body);
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setValidating(false);
      e.target.value = '';
    }
  };

  const handleRestore = async () => {
    if (!parsedSnapshot || !validation?.valid) return;
    setErrorMsg('');
    setSuccessMsg('');
    setRestoring(true);

    try {
      const res = await apiRequest<{
        success: boolean;
        mode: string;
        summary: {
          restoredProducts: number;
          restoredBalances: number;
          restoredTransactions: number;
        };
      }>('/api/backup/restore', {
        method: 'POST',
        body: JSON.stringify({
          mode: restoreMode,
          confirmationPhrase: restoreMode === 'REPLACE' ? confirmPhrase : undefined,
          snapshot: parsedSnapshot,
        }),
      });

      await Promise.all([onRefreshGlobal(), loadSummary()]);
      setSuccessMsg(
        lang === 'ar'
          ? `تمت الاستعادة بنجاح (${res.summary.restoredProducts} منتج، ${res.summary.restoredBalances} رصيد، ${res.summary.restoredTransactions} حركة جديدة)`
          : `Restore completed (${res.summary.restoredProducts} products, ${res.summary.restoredBalances} balances, ${res.summary.restoredTransactions} transactions)`,
      );
      setValidation(null);
      setParsedSnapshot(null);
      setSelectedFileName('');
      setConfirmPhrase('');
    } catch (err) {
      setErrorMsg(getErrorMessage(err, lang));
    } finally {
      setRestoring(false);
    }
  };

  const counts = summary?.counts;

  return (
    <div className="space-y-6">
      {/* Live Cloud SQL Snapshot Status Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-slate-900" />
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                {lang === 'ar'
                  ? 'حالة قاعدة بيانات Cloud SQL الحالية'
                  : 'Current Cloud SQL Database State'}
              </h3>
              <p className="text-xs text-slate-500">
                {lang === 'ar'
                  ? 'إجمالي السجلات الحية الجاهزة لأخذ نسخة احتياطية أو الصيانة'
                  : 'Live PostgreSQL record counts covered by snapshot export'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownloadSnapshot()}
            className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>
              {downloading
                ? t.loading
                : lang === 'ar'
                  ? 'تنزيل لقطة كاملة لقاعدة البيانات (.json)'
                  : 'Download Full Database Snapshot (.json)'}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: lang === 'ar' ? 'المنتجات' : 'Products', val: counts?.products ?? 0 },
            { label: lang === 'ar' ? 'الأرصدة' : 'Balances', val: counts?.inventoryBalances ?? 0 },
            { label: lang === 'ar' ? 'الحركات' : 'Transactions', val: counts?.stockTransactions ?? 0 },
            { label: lang === 'ar' ? 'التصنيفات' : 'Categories', val: counts?.categories ?? 0 },
            { label: lang === 'ar' ? 'الوحدات' : 'Units', val: counts?.units ?? 0 },
            { label: lang === 'ar' ? 'المستخدمون' : 'Users', val: counts?.users ?? 0 },
          ].map((stat, idx) => (
            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-xs text-slate-500">{stat.label}</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-0.5 tabular-nums">
                {stat.val.toLocaleString('en-US')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2.5 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Upload & Restore Authorized Snapshot */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-slate-900 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              {lang === 'ar'
                ? 'رفع واستعادة نسخة احتياطية معتمدة'
                : 'Upload & Restore Authorized Backup Snapshot'}
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              {lang === 'ar'
                ? 'يتم التحقق من بصمة SHA-256 وسلامة العلاقات المرجعية قبل تنفيذ أي استعادة في معاملة ذرية واحدة (Atomic Transaction).'
                : 'Every uploaded snapshot undergoes SHA-256 integrity and referential validation before running inside a single atomic PostgreSQL transaction.'}
            </p>
          </div>
        </div>

        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-slate-900 rounded-xl p-7 cursor-pointer transition-colors">
          <Upload className="w-7 h-7 text-slate-500 mb-2" />
          <span className="text-sm font-semibold text-slate-800">
            {validating
              ? t.loading
              : selectedFileName
                ? selectedFileName
                : lang === 'ar'
                  ? 'اختر ملف النسخة الاحتياطية (.json) للفحص والتحقق'
                  : 'Select authorized backup snapshot (.json) to validate'}
          </span>
          <input type="file" accept=".json,application/json" onChange={handleFileUpload} className="hidden" />
        </label>

        {validation && (
          <div className="space-y-4">
            {!validation.valid ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-2">
                <div className="font-bold text-sm text-red-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>
                    {lang === 'ar' ? 'ملف النسخة الاحتياطية مرفوض' : 'Backup Snapshot Rejected'}
                  </span>
                </div>
                <ul className="text-xs text-red-700 space-y-1 list-disc list-inside">
                  {validation.errors.map((err, i) => (
                    <li key={i}>{lang === 'ar' ? err.ar : err.en}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                    <FileCheck2 className="w-5 h-5" />
                    <span>
                      {lang === 'ar'
                        ? 'ملف النسخة سليم وصالح للاستعادة'
                        : 'Snapshot Verified & Ready for Restore'}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-600">
                    {validation.checksumVerified ? 'SHA-256 OK' : 'NO-SHA'} ·{' '}
                    {validation.exportedBy} ·{' '}
                    {validation.exportedAt
                      ? formatLocalDateTime(validation.exportedAt, timezone, lang)
                      : ''}
                  </div>
                </div>

                {validation.warnings.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                    {validation.warnings.map((w, i) => (
                      <div key={i}>{lang === 'ar' ? w.ar : w.en}</div>
                    ))}
                  </div>
                )}

                {validation.counts && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'المنتجات' : 'Products'}</div>
                      <div className="font-mono font-bold text-sm">{validation.counts.products}</div>
                    </div>
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'الأرصدة' : 'Balances'}</div>
                      <div className="font-mono font-bold text-sm">
                        {validation.counts.inventoryBalances}
                      </div>
                    </div>
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'الحركات' : 'Txns'}</div>
                      <div className="font-mono font-bold text-sm">
                        {validation.counts.stockTransactions}
                      </div>
                    </div>
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'التصنيفات' : 'Categories'}</div>
                      <div className="font-mono font-bold text-sm">{validation.counts.categories}</div>
                    </div>
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'الوحدات' : 'Units'}</div>
                      <div className="font-mono font-bold text-sm">{validation.counts.units}</div>
                    </div>
                    <div className="p-2.5 bg-white border border-slate-200 rounded">
                      <div className="text-slate-500">{lang === 'ar' ? 'المستخدمون' : 'Users'}</div>
                      <div className="font-mono font-bold text-sm">{validation.counts.users}</div>
                    </div>
                  </div>
                )}

                {/* Restore Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setRestoreMode('MERGE')}
                    className={`p-3.5 rounded-lg border-2 text-start cursor-pointer transition-colors ${
                      restoreMode === 'MERGE'
                        ? 'border-slate-900 bg-white'
                        : 'border-slate-200 bg-white/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-sm text-slate-900">
                      {lang === 'ar'
                        ? 'دمج آمن (بدون حذف البيانات الحالية)'
                        : 'Safe Merge / Upsert (Non-Destructive)'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {lang === 'ar'
                        ? 'إضافة الأصناف والحركات المفقودة وإعادة احتساب الأرصدة من السجل بأمان.'
                        : 'Inserts missing catalog items & transactions and reconciles balances safely.'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRestoreMode('REPLACE')}
                    className={`p-3.5 rounded-lg border-2 text-start cursor-pointer transition-colors ${
                      restoreMode === 'REPLACE'
                        ? 'border-red-700 bg-red-50/40'
                        : 'border-slate-200 bg-white/60 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-sm text-red-800">
                      {lang === 'ar'
                        ? 'استعادة صيانة كاملة (استبدال)'
                        : 'Full Maintenance Restore (Replace)'}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      {lang === 'ar'
                        ? 'إعادة بناء جدول المخزون والحركات بالكامل من اللقطة مع الإبقاء على جلستك الحالية.'
                        : 'Rebuilds catalog, balances & transactions from snapshot while preserving your active admin session.'}
                    </div>
                  </button>
                </div>

                {restoreMode === 'REPLACE' && (
                  <div>
                    <label className="block text-xs font-bold text-red-800 mb-1.5">
                      {lang === 'ar'
                        ? 'اكتب كلمة (استعادة) أو (RESTORE) للتأكيد:'
                        : 'Type RESTORE to confirm full replacement:'}
                    </label>
                    <input
                      type="text"
                      value={confirmPhrase}
                      onChange={(e) => setConfirmPhrase(e.target.value)}
                      placeholder="RESTORE"
                      className="w-full sm:w-72 h-10 px-3 border-2 border-red-300 rounded-lg text-sm font-mono bg-white"
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={
                    restoring ||
                    (restoreMode === 'REPLACE' &&
                      confirmPhrase.trim().toUpperCase() !== 'RESTORE' &&
                      confirmPhrase.trim() !== 'استعادة')
                  }
                  onClick={() => void handleRestore()}
                  className={`px-6 h-11 text-white rounded-lg text-sm font-bold disabled:opacity-40 cursor-pointer ${
                    restoreMode === 'REPLACE'
                      ? 'bg-red-700 hover:bg-red-800'
                      : 'bg-slate-900 hover:bg-slate-800'
                  }`}
                >
                  {restoring
                    ? t.loading
                    : lang === 'ar'
                      ? 'تنفيذ الاستعادة إلى قاعدة البيانات'
                      : 'Execute Database Restore'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent Snapshot & Restore Activity */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 font-bold text-sm text-slate-900">
          {lang === 'ar'
            ? 'سجل عمليات النسخ الاحتياطي والاستعادة'
            : 'Recent Backup & Restore Operations'}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'المسؤول' : 'Admin'}
                </th>
                <th className="py-2.5 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'العملية' : 'Operation'}
                </th>
                <th className="py-2.5 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'التفاصيل' : 'Details'}
                </th>
                <th className="py-2.5 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'التوقيت' : 'Timestamp'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary?.recentEvents.length ? (
                summary.recentEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold">{ev.username || 'admin'}</td>
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-900">{ev.action}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 max-w-md truncate">
                      {ev.newValue ? JSON.stringify(ev.newValue) : '—'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                      {formatLocalDateTime(ev.createdAt, timezone, lang)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    {t.noData}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
