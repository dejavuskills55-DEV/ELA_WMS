import { LockOpen, Plus, ShieldAlert, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { T, formatLocalDateTime, productTypeLabel } from '../i18n/translations.ts';
import { apiRequest, getErrorMessage } from '../lib/api.ts';
import type { CategoryItem, Lang, UnitConversionItem, UnitItem } from '../types/wms.ts';
import { DatabaseBackupPanel } from './DatabaseBackupPanel.tsx';

interface AdminUserRow {
  id: number;
  username: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleNameAr: string;
  roleNameEn: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
}

interface AuditLogRow {
  id: number;
  username: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  createdAt: string;
}

interface AdminSettingsViewProps {
  lang: Lang;
  categories: CategoryItem[];
  units: UnitItem[];
  unitConversions: UnitConversionItem[];
  settings: Record<string, string>;
  onRefreshMeta: () => Promise<void>;
}

type AdminTab = 'USERS' | 'CATEGORIES' | 'UNITS' | 'SETTINGS' | 'BACKUP' | 'AUDIT';

export function AdminSettingsView({
  lang,
  categories,
  units,
  unitConversions,
  settings,
  onRefreshMeta,
}: AdminSettingsViewProps) {
  const t = T[lang];
  const [tab, setTab] = useState<AdminTab>('USERS');
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create User Form
  const [uUsername, setUUsername] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRoleCode, setURoleCode] = useState<'DATA_ENTRY' | 'MANAGER' | 'ADMIN'>('DATA_ENTRY');

  // Create Category Form
  const [catCode, setCatCode] = useState('');
  const [catNameAr, setCatNameAr] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catType, setCatType] = useState<'RAW_MATERIAL' | 'FINISHED_PRODUCT'>('RAW_MATERIAL');

  // Create Unit Form
  const [unitCode, setUnitCode] = useState('');
  const [unitNameAr, setUnitNameAr] = useState('');
  const [unitNameEn, setUnitNameEn] = useState('');
  const [unitSymbol, setUnitSymbol] = useState('');
  const [unitFraction, setUnitFraction] = useState(true);

  // Unit conversion form
  const [fromUnitId, setFromUnitId] = useState<number>(units[0]?.id || 0);
  const [toUnitId, setToUnitId] = useState<number>(units[1]?.id || 0);
  const [convFactor, setConvFactor] = useState('1');

  // Settings form
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>(settings);

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  const loadUsers = useCallback(async () => {
    try {
      const res = await apiRequest<{ users: AdminUserRow[] }>('/api/users');
      setUsersList(res.users);
    } catch {
      // ignore
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await apiRequest<{ logs: AuditLogRow[] }>('/api/audit-logs?limit=150');
      setAuditLogs(res.logs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (tab === 'USERS') void loadUsers();
    if (tab === 'AUDIT') void loadAudit();
  }, [tab, loadUsers, loadAudit]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: uUsername.trim(),
          email: uEmail.trim(),
          fullName: uFullName.trim(),
          password: uPassword,
          roleCode: uRoleCode,
        }),
      });
      setUUsername('');
      setUEmail('');
      setUFullName('');
      setUPassword('');
      setSuccess(lang === 'ar' ? 'تم إنشاء حساب الموظف بنجاح' : 'User created successfully');
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const handleUserAction = async (
    userId: number,
    payload: { isActive?: boolean; unlock?: boolean; roleCode?: string },
  ) => {
    setError('');
    try {
      await apiRequest(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadUsers();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiRequest('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          code: catCode.trim(),
          nameAr: catNameAr.trim(),
          nameEn: catNameEn.trim(),
          productType: catType,
        }),
      });
      setCatCode('');
      setCatNameAr('');
      setCatNameEn('');
      setSuccess(lang === 'ar' ? 'تمت إضافة التصنيف بنجاح' : 'Category added');
      await onRefreshMeta();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiRequest('/api/units', {
        method: 'POST',
        body: JSON.stringify({
          code: unitCode.trim(),
          nameAr: unitNameAr.trim(),
          nameEn: unitNameEn.trim(),
          symbol: unitSymbol.trim(),
          allowFraction: unitFraction,
        }),
      });
      setUnitCode('');
      setUnitNameAr('');
      setUnitNameEn('');
      setUnitSymbol('');
      setSuccess(lang === 'ar' ? 'تمت إضافة وحدة القياس بنجاح' : 'Unit added');
      await onRefreshMeta();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const handleCreateConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/unit-conversions', {
        method: 'POST',
        body: JSON.stringify({
          fromUnitId,
          toUnitId,
          factor: Number(convFactor),
        }),
      });
      setSuccess(lang === 'ar' ? 'تمت إضافة قاعدة التحويل المعتمدة' : 'Conversion rule added');
      await onRefreshMeta();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiRequest('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ settings: settingsForm }),
      });
      setSuccess(lang === 'ar' ? 'تم حفظ إعدادات النظام بنجاح' : 'Settings updated');
      await onRefreshMeta();
    } catch (err) {
      setError(getErrorMessage(err, lang));
    }
  };

  const timezone = settings.timezone || 'Africa/Cairo';

  const tabs: Array<{ id: AdminTab; ar: string; en: string }> = [
    { id: 'USERS', ar: 'المستخدمون والصلاحيات', en: 'Users & Roles' },
    { id: 'CATEGORIES', ar: 'تصنيفات المنتجات', en: 'Categories' },
    { id: 'UNITS', ar: 'وحدات القياس والتحويل', en: 'Units & Conversions' },
    { id: 'SETTINGS', ar: 'إعدادات النظام', en: 'System Settings' },
    { id: 'BACKUP', ar: 'النسخ الاحتياطي والاستعادة', en: 'Backup & Restore' },
    { id: 'AUDIT', ar: 'سجل التدقيق الأمني', en: 'Audit Logs' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t.navAdmin}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {lang === 'ar'
            ? 'إدارة الحسابات، التصنيفات، الوحدات، إعدادات الأمان، وسجلات التدقيق'
            : 'Manage user accounts, categories, units, security policies, and audit trails'}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200 w-fit">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setError('');
              setSuccess('');
              setTab(item.id);
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              tab === item.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {lang === 'ar' ? item.ar : item.en}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-semibold text-emerald-800">
          {success}
        </div>
      )}

      {/* TAB 1: USERS */}
      {tab === 'USERS' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateUser}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <UserPlus className="w-4 h-4" />
              <span>{lang === 'ar' ? 'إضافة مستخدم جديد' : 'Create New User Account'}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input
                type="text"
                required
                placeholder={t.fullName}
                value={uFullName}
                onChange={(e) => setUFullName(e.target.value)}
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
              <input
                type="text"
                required
                placeholder={t.username}
                value={uUsername}
                onChange={(e) => setUUsername(e.target.value)}
                dir="ltr"
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
              />
              <input
                type="email"
                required
                placeholder={t.email}
                value={uEmail}
                onChange={(e) => setUEmail(e.target.value)}
                dir="ltr"
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder={t.password}
                value={uPassword}
                onChange={(e) => setUPassword(e.target.value)}
                dir="ltr"
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
              />
              <div className="flex gap-2">
                <select
                  value={uRoleCode}
                  onChange={(e) =>
                    setURoleCode(e.target.value as 'DATA_ENTRY' | 'MANAGER' | 'ADMIN')
                  }
                  className="flex-1 h-10 px-2 border border-slate-300 rounded-lg text-xs font-semibold bg-white"
                >
                  <option value="DATA_ENTRY">
                    {lang === 'ar' ? 'إدخال بيانات' : 'Data Entry'}
                  </option>
                  <option value="MANAGER">{lang === 'ar' ? 'مدير / مشرف' : 'Manager'}</option>
                  <option value="ADMIN">{lang === 'ar' ? 'مدير نظام' : 'Administrator'}</option>
                </select>
                <button
                  type="submit"
                  className="px-4 h-10 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  {lang === 'ar' ? 'إضافة' : 'Add'}
                </button>
              </div>
            </div>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 text-start font-semibold">{t.fullName}</th>
                  <th className="py-3 px-4 text-start font-semibold">{t.username}</th>
                  <th className="py-3 px-4 text-start font-semibold">{t.email}</th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الدور' : 'Role'}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الحالة' : 'Status'}
                  </th>
                  <th className="py-3 px-4 text-end font-semibold">
                    {lang === 'ar' ? 'إجراءات' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => {
                  const isLocked = Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date());
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{u.fullName}</td>
                      <td className="py-3 px-4 font-mono text-xs">{u.username}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">{u.email}</td>
                      <td className="py-3 px-4">
                        <select
                          value={u.roleCode}
                          onChange={(e) =>
                            void handleUserAction(u.id, { roleCode: e.target.value })
                          }
                          className="h-8 px-2 border border-slate-200 rounded text-xs bg-white"
                        >
                          <option value="ADMIN">
                            {lang === 'ar' ? 'مدير النظام' : 'Administrator'}
                          </option>
                          <option value="DATA_ENTRY">
                            {lang === 'ar' ? 'إدخال بيانات' : 'Data Entry'}
                          </option>
                          <option value="MANAGER">
                            {lang === 'ar' ? 'مدير / مشرف' : 'Manager / Viewer'}
                          </option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        {isLocked ? (
                          <span className="text-red-700">
                            {lang === 'ar' ? 'مقفل أمنياً' : 'Locked'}
                          </span>
                        ) : u.isActive ? (
                          <span className="text-emerald-700">{t.statusActive}</span>
                        ) : (
                          <span className="text-slate-400">{t.statusInactive}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-end space-x-2 space-x-reverse">
                        {isLocked && (
                          <button
                            type="button"
                            onClick={() => void handleUserAction(u.id, { unlock: true })}
                            className="px-2.5 py-1 border border-amber-300 bg-amber-50 text-amber-800 rounded text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <LockOpen className="w-3.5 h-3.5" />
                            <span>{lang === 'ar' ? 'فك القفل' : 'Unlock'}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            void handleUserAction(u.id, { isActive: !u.isActive })
                          }
                          className="px-2.5 py-1 border border-slate-200 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          {u.isActive
                            ? lang === 'ar'
                              ? 'تعطيل'
                              : 'Disable'
                            : lang === 'ar'
                              ? 'تفعيل'
                              : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CATEGORIES */}
      {tab === 'CATEGORIES' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateCategory}
            className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-5 gap-3"
          >
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الكود (CAT-RAW-...)' : 'Code'}
              value={catCode}
              onChange={(e) => setCatCode(e.target.value.toUpperCase())}
              dir="ltr"
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
            />
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}
              value={catNameAr}
              onChange={(e) => setCatNameAr(e.target.value)}
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}
              value={catNameEn}
              onChange={(e) => setCatNameEn(e.target.value)}
              dir="ltr"
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
            />
            <select
              value={catType}
              onChange={(e) =>
                setCatType(e.target.value as 'RAW_MATERIAL' | 'FINISHED_PRODUCT')
              }
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="RAW_MATERIAL">{t.rawMaterial}</option>
              <option value="FINISHED_PRODUCT">{t.finishedProduct}</option>
            </select>
            <button
              type="submit"
              className="h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{lang === 'ar' ? 'إضافة تصنيف' : 'Add Category'}</span>
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 text-start font-semibold">Code</th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الاسم العربي' : 'Arabic Name'}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الاسم الإنجليزي' : 'English Name'}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">{t.productType}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs font-bold">{c.code}</td>
                    <td className="py-3 px-4 font-semibold">{c.nameAr}</td>
                    <td className="py-3 px-4 text-slate-600">{c.nameEn}</td>
                    <td className="py-3 px-4">{productTypeLabel(c.productType, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: UNITS & CONVERSIONS */}
      {tab === 'UNITS' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateUnit}
            className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-6 gap-3 items-center"
          >
            <input
              type="text"
              required
              placeholder="Code (e.g. BALE)"
              value={unitCode}
              onChange={(e) => setUnitCode(e.target.value.toUpperCase())}
              dir="ltr"
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
            />
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الاسم بالعربية' : 'Arabic Name'}
              value={unitNameAr}
              onChange={(e) => setUnitNameAr(e.target.value)}
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الاسم بالإنجليزية' : 'English Name'}
              value={unitNameEn}
              onChange={(e) => setUnitNameEn(e.target.value)}
              dir="ltr"
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="text"
              required
              placeholder={lang === 'ar' ? 'الرمز' : 'Symbol'}
              value={unitSymbol}
              onChange={(e) => setUnitSymbol(e.target.value)}
              className="h-10 px-3 border border-slate-300 rounded-lg text-sm"
            />
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={unitFraction}
                onChange={(e) => setUnitFraction(e.target.checked)}
              />
              <span>{lang === 'ar' ? 'تقبل الكسور' : 'Allow Fractions'}</span>
            </label>
            <button
              type="submit"
              className="h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 cursor-pointer"
            >
              {lang === 'ar' ? 'إضافة وحدة' : 'Add Unit'}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4 text-start font-semibold">Code</th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'العربية' : 'Arabic'}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الإنجليزية' : 'English'}
                  </th>
                  <th className="py-3 px-4 text-start font-semibold">
                    {lang === 'ar' ? 'الكسور' : 'Fractions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-mono font-bold">{u.code}</td>
                    <td className="py-2.5 px-4">{u.nameAr}</td>
                    <td className="py-2.5 px-4 text-slate-600">{u.nameEn}</td>
                    <td className="py-2.5 px-4 text-xs font-semibold">
                      {u.allowFraction
                        ? lang === 'ar'
                          ? 'مسموح'
                          : 'Allowed'
                        : lang === 'ar'
                          ? 'أعداد صحيحة فقط'
                          : 'Whole numbers only'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Authorized Unit Conversion Rules */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">
              {lang === 'ar'
                ? 'قواعد التحويل المعتمدة بين الوحدات (لا يتم التحويل التلقائي بدون قاعدة معتمدة)'
                : 'Authorized Unit Conversion Rules'}
            </h3>
            <form onSubmit={handleCreateConversion} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select
                value={fromUnitId}
                onChange={(e) => setFromUnitId(Number(e.target.value))}
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nameAr} ({u.code})
                  </option>
                ))}
              </select>
              <select
                value={toUnitId}
                onChange={(e) => setToUnitId(Number(e.target.value))}
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nameAr} ({u.code})
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.000001"
                min="0.000001"
                value={convFactor}
                onChange={(e) => setConvFactor(e.target.value)}
                dir="ltr"
                placeholder="Factor (e.g. 1000)"
                className="h-10 px-3 border border-slate-300 rounded-lg text-sm font-mono"
              />
              <button
                type="submit"
                className="h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold cursor-pointer"
              >
                {lang === 'ar' ? 'إضافة قاعدة تحويل' : 'Add Conversion Rule'}
              </button>
            </form>
            {unitConversions.length > 0 && (
              <div className="text-xs font-mono text-slate-600 space-y-1">
                {unitConversions.map((c) => {
                  const f = units.find((u) => u.id === c.fromUnitId);
                  const tu = units.find((u) => u.id === c.toUnitId);
                  return (
                    <div key={c.id}>
                      1 {f?.code} = {c.factor} {tu?.code}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SETTINGS */}
      {tab === 'SETTINGS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleSaveSettings}
            className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
          >
            <h3 className="font-bold text-slate-900">
              {lang === 'ar' ? 'إعدادات النظام والأمان' : 'System & Security Settings'}
            </h3>
            {Object.entries(settingsForm).map(([key, value]) => (
              <div key={key}>
                <label className="block text-xs font-mono font-semibold text-slate-600 mb-1">
                  {key}
                </label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            ))}
            <button
              type="submit"
              className="px-5 h-10 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 cursor-pointer"
            >
              {t.save}
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 h-fit">
            <h3 className="font-bold text-slate-900">
              {lang === 'ar' ? 'إدارة النسخ الاحتياطي والاستعادة' : 'Cloud SQL Backup & Restore Utility'}
            </h3>
            <p className="text-sm text-slate-600">
              {lang === 'ar'
                ? 'لتنزيل لقطة كاملة محمية ببصمة SHA-256 أو رفع ملف نسخة احتياطية معتمدة واستعادته أثناء صيانة البنية التحتية، انتقل إلى تبويب النسخ الاحتياطي والاستعادة.'
                : 'Download SHA-256 verified Cloud SQL snapshots or upload and restore authorized backup files during maintenance.'}
            </p>
            <button
              type="button"
              onClick={() => setTab('BACKUP')}
              className="px-5 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 cursor-pointer"
            >
              {lang === 'ar' ? 'فتح أداة النسخ الاحتياطي والاستعادة' : 'Open Backup & Restore Utility'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 5: BACKUP & RESTORE */}
      {tab === 'BACKUP' && (
        <DatabaseBackupPanel
          lang={lang}
          timezone={timezone}
          onRefreshGlobal={onRefreshMeta}
        />
      )}

      {/* TAB 5: AUDIT LOGS */}
      {tab === 'AUDIT' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-slate-700" />
            <h3 className="font-bold text-slate-900 text-sm">
              {lang === 'ar' ? 'سجل التدقيق الأمني الكامل' : 'Security Audit Trail'}
            </h3>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'المستخدم' : 'User'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'الإجراء' : 'Action'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'الكيان' : 'Entity'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">IP</th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'التفاصيل' : 'Details'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'التوقيت' : 'Timestamp'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-semibold">
                    {log.username || 'system'}
                  </td>
                  <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                    {log.action}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">
                    {log.entity}
                    {log.entityId ? `#${log.entityId}` : ''}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-500">
                    {log.ipAddress || '—'}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600 max-w-sm truncate">
                    {log.newValue ? JSON.stringify(log.newValue) : '—'}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                    {formatLocalDateTime(log.createdAt, timezone, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
