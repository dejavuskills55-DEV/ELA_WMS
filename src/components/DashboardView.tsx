import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  T,
  formatLocalDateTime,
  productTypeLabel,
  txTypeLabel,
} from '../i18n/translations.ts';
import { ApiError, apiRequest } from '../lib/api.ts';
import type { Lang, ProductItem, StockAlertItem } from '../types/wms.ts';

interface DashboardResponse {
  kpis: {
    totalProducts: number;
    totalRawMaterials: number;
    totalFinishedProducts: number;
    totalInventoryQuantity: number;
    stockInToday: number;
    stockOutToday: number;
    lowStockProducts: number;
    outOfStockProducts: number;
  };
  charts: {
    dailyMovement: Array<{ day: string; incoming: number; outgoing: number }>;
    monthlyMovement: Array<{ month: string; incoming: number; outgoing: number }>;
    typeBreakdown: Array<{
      type: string;
      nameAr: string;
      nameEn: string;
      count: number;
      quantity: number;
    }>;
    topUsedProducts: Array<{
      productCode: string;
      name: string;
      unitCode: string;
      totalUsed: number;
    }>;
    topStockProducts: Array<{
      productCode: string;
      name: string;
      quantity: number;
      unitCode: string;
    }>;
  };
  alerts: StockAlertItem[];
  recentTransactions: Array<{
    id: number;
    transactionNumber: string;
    productCode: string;
    productName: string;
    productType: string;
    transactionType: string;
    quantity: number;
    unitCode: string;
    unitNameAr: string;
    employeeName: string;
    reason: string;
    referenceNumber: string | null;
    createdAt: string;
  }>;
}

interface DashboardViewProps {
  lang: Lang;
  products: ProductItem[];
  timezone: string;
}

export function DashboardView({ lang, products, timezone }: DashboardViewProps) {
  const t = T[lang];
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [employees, setEmployees] = useState<Array<{ id: number; fullName: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [productType, setProductType] = useState('');
  const [productId, setProductId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (productType) params.set('productType', productType);
      if (productId) params.set('productId', productId);
      if (employeeId) params.set('employeeId', employeeId);
      if (transactionType) params.set('transactionType', transactionType);
      if (referenceNumber.trim()) params.set('referenceNumber', referenceNumber.trim());

      const res = await apiRequest<DashboardResponse>(`/api/dashboard?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, productType, productId, employeeId, transactionType, referenceNumber]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    apiRequest<{ employees: Array<{ id: number; fullName: string }> }>('/api/employees')
      .then((res) => setEmployees(res.employees))
      .catch(() => {});
  }, []);

  const resetFilters = () => {
    setFromDate('');
    setToDate('');
    setProductType('');
    setProductId('');
    setEmployeeId('');
    setTransactionType('');
    setReferenceNumber('');
  };

  const kpis = data?.kpis;
  const kpiCards = [
    {
      label: lang === 'ar' ? 'إجمالي المنتجات' : 'Total Products',
      value: kpis?.totalProducts ?? 0,
      tone: 'text-slate-900',
    },
    {
      label: lang === 'ar' ? 'أصناف المواد الخام' : 'Raw Material Items',
      value: kpis?.totalRawMaterials ?? 0,
      tone: 'text-slate-900',
    },
    {
      label: lang === 'ar' ? 'أصناف المنتج التام' : 'Finished Product Items',
      value: kpis?.totalFinishedProducts ?? 0,
      tone: 'text-slate-900',
    },
    {
      label: lang === 'ar' ? 'إجمالي كميات المخزون' : 'Total Inventory Qty',
      value: kpis?.totalInventoryQuantity ?? 0,
      tone: 'text-slate-900',
    },
    {
      label: lang === 'ar' ? 'الوارد اليوم' : 'Stock In Today',
      value: kpis?.stockInToday ?? 0,
      tone: 'text-emerald-700',
    },
    {
      label: lang === 'ar' ? 'المنصرف اليوم' : 'Stock Out Today',
      value: kpis?.stockOutToday ?? 0,
      tone: 'text-blue-800',
    },
    {
      label: lang === 'ar' ? 'منتجات منخفضة المخزون' : 'Low Stock Products',
      value: kpis?.lowStockProducts ?? 0,
      tone: 'text-amber-700',
    },
    {
      label: lang === 'ar' ? 'منتجات نافدة' : 'Out of Stock Products',
      value: kpis?.outOfStockProducts ?? 0,
      tone: 'text-red-700',
    },
  ];

  const PIE_COLORS = ['#0f172a', '#2563eb'];

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t.navDashboard}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {lang === 'ar'
              ? 'إحصائيات حية ومباشرة من قاعدة بيانات المستودع المركزي'
              : 'Live metrics computed directly from central warehouse transactions'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadDashboard()}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{lang === 'ar' ? 'تحديث البيانات' : 'Refresh'}</span>
        </button>
      </div>

      {/* 8 KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {kpiCards.map((card, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-semibold text-slate-500">{card.label}</div>
            <div className={`text-2xl sm:text-3xl font-bold tabular-nums mt-2 ${card.tone}`}>
              {card.value.toLocaleString('en-US', { maximumFractionDigits: 3 })}
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {lang === 'ar' ? 'من تاريخ' : 'From Date'}
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs"
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
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t.productType}
            </label>
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              <option value="RAW_MATERIAL">{t.rawMaterial}</option>
              <option value="FINISHED_PRODUCT">{t.finishedProduct}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t.productName}
            </label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="">{lang === 'ar' ? 'كل المنتجات' : 'All Products'}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productCode} - {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {lang === 'ar' ? 'الموظف' : 'Employee'}
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="">{lang === 'ar' ? 'كل الموظفين' : 'All Employees'}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.fullName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {lang === 'ar' ? 'نوع الحركة' : 'Transaction Type'}
            </label>
            <select
              value={transactionType}
              onChange={(e) => setTransactionType(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs bg-white"
            >
              <option value="">{lang === 'ar' ? 'الكل' : 'All'}</option>
              <option value="STOCK_IN">{txTypeLabel('STOCK_IN', lang)}</option>
              <option value="STOCK_OUT">{txTypeLabel('STOCK_OUT', lang)}</option>
              <option value="OPENING_BALANCE">{txTypeLabel('OPENING_BALANCE', lang)}</option>
              <option value="ADJUSTMENT_IN">{txTypeLabel('ADJUSTMENT_IN', lang)}</option>
              <option value="ADJUSTMENT_OUT">{txTypeLabel('ADJUSTMENT_OUT', lang)}</option>
              <option value="REVERSAL">{txTypeLabel('REVERSAL', lang)}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              {t.referenceNumber}
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="REF..."
                className="w-full h-10 px-3 border border-slate-200 rounded-lg text-xs font-mono"
              />
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                {t.resetFilters}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row 1: Daily In vs Out + Monthly Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {lang === 'ar' ? 'حركة الوارد مقابل المنصرف يومياً' : 'Daily Incoming vs Outgoing'}
          </h3>
          <div className="h-72" dir="ltr">
            {data?.charts.dailyMovement.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.dailyMovement}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="incoming"
                    name={lang === 'ar' ? 'الوارد' : 'Incoming'}
                    fill="#15803d"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="outgoing"
                    name={lang === 'ar' ? 'المنصرف' : 'Outgoing'}
                    fill="#0f172a"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                {t.noData}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {lang === 'ar' ? 'الحركة الشهرية للمخزون' : 'Monthly Inventory Movement'}
          </h3>
          <div className="h-72" dir="ltr">
            {data?.charts.monthlyMovement.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.charts.monthlyMovement}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="incoming"
                    name={lang === 'ar' ? 'الوارد' : 'Incoming'}
                    stroke="#15803d"
                    fill="#dcfce7"
                  />
                  <Area
                    type="monotone"
                    dataKey="outgoing"
                    name={lang === 'ar' ? 'المنصرف' : 'Outgoing'}
                    stroke="#1e3a8a"
                    fill="#dbeafe"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                {t.noData}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts Row 2: Raw vs Finished + Top 10 Most Used + Top 10 Stock Qty */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {lang === 'ar' ? 'توزيع المواد الخام مقابل المنتج التام' : 'Raw Materials vs Finished Products'}
          </h3>
          <div className="h-64" dir="ltr">
            {data?.charts.typeBreakdown.some((b) => b.quantity > 0 || b.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.charts.typeBreakdown}
                    dataKey="quantity"
                    nameKey={lang === 'ar' ? 'nameAr' : 'nameEn'}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    label
                  >
                    {data.charts.typeBreakdown.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                {t.noData}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {lang === 'ar' ? 'أعلى 10 منتجات استهلاكاً وصرفاً' : 'Top 10 Most Used Products'}
          </h3>
          <div className="h-64" dir="ltr">
            {data?.charts.topUsedProducts.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.topUsedProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="productCode" type="category" width={75} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="totalUsed" name={lang === 'ar' ? 'المصروف' : 'Used'} fill="#1e3a8a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                {t.noData}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-base font-bold text-slate-900 mb-4">
            {lang === 'ar' ? 'أعلى 10 منتجات حسب الرصيد الحالي' : 'Top 10 Products by Stock Quantity'}
          </h3>
          <div className="h-64" dir="ltr">
            {data?.charts.topStockProducts.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.topStockProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="productCode" type="category" width={75} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="quantity" name={lang === 'ar' ? 'الرصيد' : 'Stock'} fill="#0f172a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">
                {t.noData}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Low Stock & Out of Stock Alerts Section */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="text-base font-bold text-slate-900">
              {lang === 'ar' ? 'تنبيهات انخفاض ونفاد المخزون' : 'Low Stock & Out of Stock Alerts'}
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {data?.alerts.length || 0} {lang === 'ar' ? 'تنبيه نشط' : 'active alerts'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 text-start font-semibold">{t.productCode}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productType}</th>
                <th className="py-3 px-4 text-end font-semibold">{t.currentStock}</th>
                <th className="py-3 px-4 text-end font-semibold">{t.minStock}</th>
                <th className="py-3 px-4 text-end font-semibold">
                  {lang === 'ar' ? 'كمية العجز' : 'Shortage'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'الحالة' : 'Status'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.alerts.length ? (
                data.alerts.map((a) => (
                  <tr key={a.productId} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {a.productCode}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{a.productName}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {productTypeLabel(a.productType, lang)}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold text-slate-900">
                      {a.currentStock} {lang === 'ar' ? a.unitNameAr : a.unitCode}
                    </td>
                    <td className="py-3 px-4 text-end font-mono text-slate-600">
                      {a.minimumStock}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold text-red-700">
                      {a.shortageAmount}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      {a.alertType === 'OUT_OF_STOCK' ? (
                        <span className="text-red-700">{t.outOfStock}</span>
                      ) : (
                        <span className="text-amber-700">{t.lowStock}</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    {lang === 'ar'
                      ? 'جميع الأصناف النشطة فوق الحد الأدنى للمخزون'
                      : 'All active products are above minimum stock levels'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">
            {lang === 'ar' ? 'أحدث الحركات المخزنية' : 'Recent Transactions'}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'رقم الحركة' : 'Transaction No.'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">{t.productCode}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productName}</th>
                <th className="py-3 px-4 text-start font-semibold">{t.productType}</th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'نوع العملية' : 'Operation'}
                </th>
                <th className="py-3 px-4 text-end font-semibold">{t.quantity}</th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'الموظف' : 'Employee'}
                </th>
                <th className="py-3 px-4 text-start font-semibold">{t.reason}</th>
                <th className="py-3 px-4 text-start font-semibold">
                  {lang === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.recentTransactions.length ? (
                data.recentTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono text-xs text-slate-800">
                      {tx.transactionNumber}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {tx.productCode}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">{tx.productName}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {productTypeLabel(tx.productType, lang)}
                    </td>
                    <td className="py-3 px-4 font-medium">{txTypeLabel(tx.transactionType, lang)}</td>
                    <td className="py-3 px-4 text-end font-mono font-bold text-slate-900">
                      {tx.quantity} {lang === 'ar' ? tx.unitNameAr : tx.unitCode}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{tx.employeeName}</td>
                    <td className="py-3 px-4 text-slate-600">{tx.reason}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">
                      {formatLocalDateTime(tx.createdAt, timezone, lang)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
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
