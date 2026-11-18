import { signOut } from 'firebase/auth';
import {
  BarChart3,
  Bell,
  FileSpreadsheet,
  FileText,
  Globe,
  History,
  LogOut,
  Menu,
  Package,
  ScanBarcode,
  Settings,
  Warehouse,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminSettingsView } from './components/AdminSettingsView.tsx';
import { AuthScreen } from './components/AuthScreen.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { DataEntryModule } from './components/DataEntryModule.tsx';
import { ExcelImportExportView } from './components/ExcelImportExportView.tsx';
import { ProductsCatalogView } from './components/ProductsCatalogView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { TransactionsHistoryView } from './components/TransactionsHistoryView.tsx';
import { T, formatLocalDateTime } from './i18n/translations.ts';
import { ApiError, apiRequest, clearSessionToken } from './lib/api.ts';
import { auth } from './lib/firebase.ts';
import type {
  Lang,
  MetaResponse,
  NotificationItem,
  ProductItem,
  UserProfile,
} from './types/wms.ts';

type ActiveView =
  | 'DATA_ENTRY'
  | 'DASHBOARD'
  | 'PRODUCTS'
  | 'TRANSACTIONS'
  | 'REPORTS'
  | 'IMPORT_EXPORT'
  | 'ADMIN';

export default function App() {
  const [lang, setLang] = useState<Lang>('ar');
  const [authLoading, setAuthLoading] = useState(true);
  const [needsInitialSetup, setNeedsInitialSetup] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('DATA_ENTRY');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsList, setNotificationsList] = useState<NotificationItem[]>([]);

  const t = T[lang];

  // Sync HTML lang & dir attributes
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  // Initial Auth Check (wait for Firebase auth readiness so Google-signed-in users restore cleanly)
  useEffect(() => {
    (async () => {
      try {
        await auth.authStateReady().catch(() => {});
        const res = await apiRequest<{
          needsInitialSetup: boolean;
          authenticated: boolean;
          user: UserProfile | null;
        }>('/api/auth/status');
        setNeedsInitialSetup(res.needsInitialSetup);
        if (res.authenticated && res.user) {
          setUser(res.user);
        }
      } catch {
        // ignore
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  // Reset user state cleanly if any API call receives 401 Unauthorized
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setMeta(null);
      setProducts([]);
    };
    window.addEventListener('ela:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ela:unauthorized', onUnauthorized);
  }, []);

  // Set default landing view based on user role
  useEffect(() => {
    if (!user) return;
    if (user.roleCode === 'DATA_ENTRY') {
      setActiveView('DATA_ENTRY');
    } else if (user.roleCode === 'MANAGER') {
      setActiveView('DASHBOARD');
    } else {
      setActiveView('DASHBOARD');
    }
  }, [user]);

  const loadMetaAndProducts = useCallback(async () => {
    if (!user) return;
    try {
      const [metaRes, prodRes] = await Promise.all([
        apiRequest<MetaResponse>('/api/meta'),
        apiRequest<{ products: ProductItem[] }>('/api/products'),
      ]);
      setMeta(metaRes);
      setProducts(prodRes.products);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      console.error('Failed to refresh meta/products:', err);
    }
  }, [user]);

  useEffect(() => {
    void loadMetaAndProducts();
  }, [loadMetaAndProducts]);

  const openNotifications = async () => {
    setNotificationsOpen(true);
    try {
      const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotificationsList(res.notifications);
    } catch {
      // ignore
    }
  };

  const markAllNotificationsRead = async () => {
    await apiRequest('/api/notifications/mark-all-read', { method: 'POST' });
    setNotificationsList((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await loadMetaAndProducts();
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      await signOut(auth).catch(() => {});
    } finally {
      clearSessionToken();
      setUser(null);
      setMeta(null);
      setProducts([]);
    }
  };

  const toggleLang = () => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'));

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-600 font-semibold">
        {t.loading}
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        lang={lang}
        onToggleLang={toggleLang}
        needsInitialSetup={needsInitialSetup}
        onAuthenticated={(authenticatedUser) => {
          setNeedsInitialSetup(false);
          setUser(authenticatedUser);
        }}
      />
    );
  }

  const timezone = meta?.settings?.timezone || 'Africa/Cairo';
  const isDataEntry = user.roleCode === 'DATA_ENTRY';

  // Navigation items gated strictly by role/permissions
  const rawNavItems: Array<{
    id: ActiveView;
    label: string;
    icon: typeof BarChart3;
    visible: boolean;
  }> = [
    {
      id: 'DATA_ENTRY',
      label: t.navDataEntry,
      icon: ScanBarcode,
      visible: user.permissions.includes('STOCK_IN') || user.permissions.includes('STOCK_OUT'),
    },
    {
      id: 'DASHBOARD',
      label: t.navDashboard,
      icon: BarChart3,
      visible: user.permissions.includes('DASHBOARD_VIEW'),
    },
    {
      id: 'PRODUCTS',
      label: t.navProducts,
      icon: Package,
      visible: user.permissions.includes('PRODUCT_VIEW') && !isDataEntry,
    },
    {
      id: 'TRANSACTIONS',
      label: t.navTransactions,
      icon: History,
      visible:
        (user.permissions.includes('TX_VIEW_ALL') || user.permissions.includes('TX_VIEW_OWN')) &&
        !isDataEntry,
    },
    {
      id: 'REPORTS',
      label: t.navReports,
      icon: FileText,
      visible: user.permissions.includes('REPORTS_VIEW'),
    },
    {
      id: 'IMPORT_EXPORT',
      label: t.navImportExport,
      icon: FileSpreadsheet,
      visible: user.permissions.includes('EXCEL_IMPORT'),
    },
    {
      id: 'ADMIN',
      label: t.navAdmin,
      icon: Settings,
      visible: user.permissions.includes('USER_MANAGE'),
    },
  ];
  const navItems = rawNavItems.filter((item) => item.visible);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar (Hidden on Data Entry simplified mode unless user also has management routes) */}
      {!isDataEntry && (
        <aside
          className={`fixed inset-y-0 start-0 z-40 w-64 bg-slate-900 text-slate-100 flex flex-col transition-transform lg:static lg:translate-x-0 ${
            mobileMenuOpen
              ? 'translate-x-0'
              : lang === 'ar'
                ? 'translate-x-full'
                : '-translate-x-full'
          }`}
        >
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white text-slate-900 flex items-center justify-center shrink-0">
                <Warehouse className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-white text-base truncate">{t.brandName}</div>
                <div className="text-xs text-slate-400 truncate">
                  {meta?.settings?.company_name_ar && lang === 'ar'
                    ? meta.settings.company_name_ar
                    : meta?.settings?.company_name_en || t.brandSub}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-800 space-y-3">
            <div className="text-xs">
              <div className="font-semibold text-white truncate">{user.fullName}</div>
              <div className="text-slate-400 truncate">
                {lang === 'ar' ? user.roleNameAr : user.roleNameEn}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>{t.logout}</span>
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            {!isDataEntry ? (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <Menu className="w-5 h-5" />
              </button>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                  <Warehouse className="w-4 h-4" />
                </div>
                <span className="font-bold text-slate-900 whitespace-nowrap">{t.brandName}</span>
              </div>
            )}

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <span>{user.fullName}</span>
              <span aria-hidden="true">·</span>
              <span>{lang === 'ar' ? user.roleNameAr : user.roleNameEn}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void openNotifications()}
              className="relative px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Bell className="w-4 h-4" />
              <span className="hidden sm:inline">{t.navNotifications}</span>
              {(meta?.unreadNotifications || 0) > 0 && (
                <span className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-mono font-bold">
                  {meta?.unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleLang}
              className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Globe className="w-4 h-4" />
              <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
            </button>

            {isDataEntry && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-4 h-4" />
                <span>{t.logout}</span>
              </button>
            )}
          </div>
        </header>

        {/* Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeView === 'DATA_ENTRY' && (
            <DataEntryModule
              lang={lang}
              user={user}
              categories={meta?.categories || []}
              units={meta?.units || []}
              products={products}
              timezone={timezone}
              onRefreshData={loadMetaAndProducts}
            />
          )}

          {activeView === 'DASHBOARD' && (
            <DashboardView lang={lang} products={products} timezone={timezone} />
          )}

          {activeView === 'PRODUCTS' && (
            <ProductsCatalogView
              lang={lang}
              user={user}
              products={products}
              categories={meta?.categories || []}
              units={meta?.units || []}
              onRefresh={loadMetaAndProducts}
            />
          )}

          {activeView === 'TRANSACTIONS' && (
            <TransactionsHistoryView
              lang={lang}
              user={user}
              timezone={timezone}
              onRefreshGlobal={loadMetaAndProducts}
            />
          )}

          {activeView === 'REPORTS' && (
            <ReportsView lang={lang} products={products} timezone={timezone} />
          )}

          {activeView === 'IMPORT_EXPORT' && (
            <ExcelImportExportView lang={lang} onRefresh={loadMetaAndProducts} />
          )}

          {activeView === 'ADMIN' && (
            <AdminSettingsView
              lang={lang}
              categories={meta?.categories || []}
              units={meta?.units || []}
              unitConversions={meta?.unitConversions || []}
              settings={meta?.settings || {}}
              onRefreshMeta={loadMetaAndProducts}
            />
          )}
        </main>
      </div>

      {/* Notifications Drawer Modal */}
      {notificationsOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col border-s border-slate-200">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{t.navNotifications}</h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void markAllNotificationsRead()}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
                >
                  {lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}
                </button>
                <button
                  type="button"
                  onClick={() => setNotificationsOpen(false)}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {notificationsList.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">{t.noData}</div>
              ) : (
                notificationsList.map((n) => (
                  <div
                    key={n.id}
                    className={`p-4 space-y-1 ${n.isRead ? 'bg-white' : 'bg-amber-50/60'}`}
                  >
                    <div className="font-bold text-sm text-slate-900">
                      {lang === 'ar' ? n.titleAr : n.titleEn}
                    </div>
                    <div className="text-xs text-slate-600">
                      {lang === 'ar' ? n.messageAr : n.messageEn}
                    </div>
                    <div className="text-[11px] font-mono text-slate-400">
                      {formatLocalDateTime(n.createdAt, timezone, lang)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
