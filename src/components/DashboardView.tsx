import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpLeft,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Minus,
  Package,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAppData } from '../context/AppDataContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import {
  computeTodayVsLastMonthDisbursement,
  getGovernoratesWithActiveAssociations,
} from '../utils/analytics.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { STATUS_LABELS_AR } from '../utils/rbac.ts';

export const DashboardView: React.FC<{
  onNavigate: (tab: string) => void;
}> = ({ onNavigate }) => {
  const {
    governorates,
    associations,
    reports,
    disbursements,
    tractors,
    fertilizerTypes,
  } = useAppData();

  const metrics = useMemo(() => {
    const totalDisbursed = disbursements.reduce((sum, r) => sum + (r.actualDisbursed ?? 0), 0);
    const totalClosing = disbursements.reduce((sum, r) => sum + (r.closingBalance ?? 0), 0);
    const nonZeroVariances = disbursements.filter(
      (r) => r.variance !== null && Math.abs(r.variance) > 0.001,
    );
    const totalApprovedTractorsBags = tractors
      .filter((t) => t.approvalState === 'final_approved')
      .reduce((sum, t) => sum + (t.actualBags || 0), 0);
    const pendingTractors = tractors.filter((t) => t.approvalState === 'pending').length;
    const approvedReports = reports.filter((r) => r.status === 'approved').length;
    const activeAssociations = associations.filter((a) => a.isActive).length;

    return {
      totalDisbursed,
      totalClosing,
      varianceCount: nonZeroVariances.length,
      totalApprovedTractorsBags,
      pendingTractors,
      approvedReports,
      totalReports: reports.length,
      activeAssociations,
    };
  }, [associations, disbursements, reports, tractors]);

  const todayVsLastMonth = useMemo(
    () =>
      computeTodayVsLastMonthDisbursement({
        reports,
        disbursements,
        todayDate: getTodayDateIso(),
      }),
    [disbursements, reports],
  );

  const activeChartGovs = useMemo(
    () => getGovernoratesWithActiveAssociations(governorates, associations),
    [associations, governorates],
  );

  const chartByGov = useMemo(() => {
    return activeChartGovs.map((gov) => {
      const govReports = reports.filter((r) => r.governorateId === gov.id);
      const repIds = new Set(govReports.map((r) => r.id));
      const rows = disbursements.filter(
        (d) => repIds.has(d.reportId) || d.governorateId === gov.id,
      );
      const urea = rows
        .filter((r) => r.fertilizerCode === 'urea')
        .reduce((s, r) => s + (r.actualDisbursed ?? 0), 0);
      const nitrate = rows
        .filter((r) => r.fertilizerCode === 'nitrate')
        .reduce((s, r) => s + (r.actualDisbursed ?? 0), 0);
      const sulfate = rows
        .filter((r) => r.fertilizerCode === 'sulfate')
        .reduce((s, r) => s + (r.actualDisbursed ?? 0), 0);
      return {
        id: gov.id,
        name: gov.nameAr,
        يوريا: urea,
        نترات: nitrate,
        سلفات: sulfate,
      };
    });
  }, [activeChartGovs, disbursements, reports]);

  const chartByFertilizer = useMemo(() => {
    const activeGovSet = new Set(activeChartGovs.map((g) => g.id));
    const repGovMap = new Map(reports.map((r) => [r.id, r.governorateId]));
    return fertilizerTypes.map((ft) => {
      const rows = disbursements.filter((d) => {
        if (d.fertilizerCode !== ft.code) return false;
        const gId = d.governorateId || repGovMap.get(d.reportId) || '';
        return activeGovSet.has(gId);
      });
      return {
        name: ft.nameAr,
        'بداية اليوم': rows.reduce((s, r) => s + (r.openingBalance ?? 0), 0),
        المنصرف: rows.reduce((s, r) => s + (r.actualDisbursed ?? 0), 0),
        'نهاية اليوم': rows.reduce((s, r) => s + (r.closingBalance ?? 0), 0),
      };
    });
  }, [activeChartGovs, disbursements, fertilizerTypes, reports]);

  const alerts = useMemo(() => {
    const assocMap = new Map(associations.map((a) => [a.id, a]));
    const items: Array<{ id: string; title: string; detail: string; targetTab: string }> = [];
    for (const d of disbursements) {
      if (d.variance !== null && Math.abs(d.variance) > 0.001) {
        const assoc = assocMap.get(d.associationId);
        if (!assoc) continue;
        const fert = fertilizerTypes.find((f) => f.code === d.fertilizerCode);
        items.push({
          id: `var-${d.id}`,
          title: `⚠ اختلاف تسوية في ${assoc.nameAr}`,
          detail: `صنف ${fert?.nameAr || d.fertilizerCode}: فرق ${formatNumberAr(d.variance)} شيكارة (${d.varianceReason?.trim() || 'بدون توضيح'})`,
          targetTab: 'sheet',
        });
      }
    }
    for (const t of tractors) {
      if (t.approvalState === 'pending') {
        const assoc = assocMap.get(t.associationId);
        if (!assoc) continue;
        items.push({
          id: `tr-${t.id}`,
          title: `جرار بانتظار الاعتماد النهائي (${t.tractorPlate})`,
          detail: `${assoc.nameAr} · بوليصة ${t.manifestNumber} · فعلي ${formatNumberAr(t.actualBags)} شيكارة`,
          targetTab: 'tractors',
        });
      }
    }
    return items.slice(0, 6);
  }, [associations, disbursements, fertilizerTypes, tractors]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            لوحة التحكم والمؤشرات التشغيلية
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            ملخص حركة صرف الأسمدة والأرصدة الختامية وشحنات الجرارات وحالة الاعتماد عبر المحافظات
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('sheet')}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap"
          >
            <ClipboardList className="w-4 h-4" />
            فتح كشف الصرف اليومي
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>إجمالي المنصرف المحسوب</span>
            <Package className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {formatNumberAr(metrics.totalDisbursed)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            شيكارة · عبر {formatNumberAr(metrics.activeAssociations)} جمعية نشطة
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>شحنات الجرارات المعتمدة</span>
            <Truck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {formatNumberAr(metrics.totalApprovedTractorsBags)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            شيكارة · {formatNumberAr(metrics.pendingTractors)} جرار بانتظار الاعتماد
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>إجمالي أرصدة نهاية اليوم</span>
            <CheckCircle2 className="w-4 h-4 text-slate-600 dark:text-slate-400" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 font-mono-num">
            {formatNumberAr(metrics.totalClosing)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            التقارير المعتمدة: {formatNumberAr(metrics.approvedReports)} من{' '}
            {formatNumberAr(metrics.totalReports)}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>بنود الفروقات المرصودة</span>
            <AlertTriangle
              className={`w-4 h-4 ${
                metrics.varianceCount > 0 ? 'text-amber-600' : 'text-emerald-700 dark:text-emerald-400'
              }`}
            />
          </div>
          <p
            className={`mt-2 text-2xl font-bold font-mono-num ${
              metrics.varianceCount > 0
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-800 dark:text-emerald-400'
            }`}
          >
            {formatNumberAr(metrics.varianceCount)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {metrics.varianceCount > 0 ? '⚠ بنود بها فرق تسوية للمراجعة' : '✔ كافة البنود المسجلة مطابقة'}
          </p>
        </div>
      </div>

      {/* Today vs Same Day Last Month Comparison Card */}
      <section
        aria-label="مقارنة إجمالي الأسمدة المنصرفة اليوم بنفس اليوم من الشهر الماضي"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              إجمالي الأسمدة المنصرفة اليوم مقارنة بنفس اليوم من الشهر الماضي
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                اليوم: <span className="font-mono-num text-slate-700 dark:text-slate-300">{todayVsLastMonth.todayDate}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                نفس اليوم من الشهر الماضي:{' '}
                <span className="font-mono-num text-slate-700 dark:text-slate-300">
                  {todayVsLastMonth.prevMonthDate}
                </span>
              </span>
            </p>
          </div>

          {(todayVsLastMonth.hasTodayData || todayVsLastMonth.hasPrevMonthData) && (
            <div className="flex items-center gap-2 text-xs font-semibold shrink-0">
              {todayVsLastMonth.direction === 'up' ? (
                <TrendingUp className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              ) : todayVsLastMonth.direction === 'down' ? (
                <TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              ) : (
                <Minus className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              )}
              <span
                className={
                  todayVsLastMonth.direction === 'up'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : todayVsLastMonth.direction === 'down'
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-300'
                }
              >
                {todayVsLastMonth.direction === 'up'
                  ? 'ارتفاع'
                  : todayVsLastMonth.direction === 'down'
                    ? 'انخفاض'
                    : 'دون تغير'}
                {' · '}
                {todayVsLastMonth.percentChange !== null ? (
                  <span className="font-mono-num" dir="ltr">
                    {todayVsLastMonth.percentChange > 0 ? '+' : ''}
                    {todayVsLastMonth.percentChange}%
                  </span>
                ) : (
                  <span>لا يوجد منصرف مسجّل في الشهر الماضي</span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Summary Metrics Row (hairline divided, no nested cards) */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
          <div className="py-3 sm:pl-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              إجمالي منصرف اليوم
            </p>
            <p className="mt-1 flex items-baseline gap-1.5 text-xl font-bold text-slate-900 dark:text-slate-100">
              <span className="font-mono-num">{formatNumberAr(todayVsLastMonth.todayTotal)}</span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">شيكارة</span>
            </p>
            {!todayVsLastMonth.hasTodayData && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                لم يُسجَّل صرف اليوم بعد
              </p>
            )}
          </div>

          <div className="py-3 sm:px-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              نفس اليوم من الشهر الماضي
            </p>
            <p className="mt-1 flex items-baseline gap-1.5 text-xl font-bold text-slate-900 dark:text-slate-100">
              <span className="font-mono-num">{formatNumberAr(todayVsLastMonth.prevMonthTotal)}</span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">شيكارة</span>
            </p>
            {!todayVsLastMonth.hasPrevMonthData && (
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                لا توجد قيود صرف مسجلة في هذا التاريخ
              </p>
            )}
          </div>

          <div className="py-3 sm:pr-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              مقدار التغير (اليوم − الشهر الماضي)
            </p>
            <p
              className={`mt-1 flex items-baseline gap-1.5 text-xl font-bold ${
                todayVsLastMonth.direction === 'up'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : todayVsLastMonth.direction === 'down'
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              <span className="font-mono-num">
                {todayVsLastMonth.deltaBags > 0 ? '+' : ''}
                {formatNumberAr(todayVsLastMonth.deltaBags)}
              </span>
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">شيكارة</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {todayVsLastMonth.percentChange !== null ? (
                <>
                  نسبة التغير:{' '}
                  <span className="font-mono-num">
                    {todayVsLastMonth.percentChange > 0 ? '+' : ''}
                    {todayVsLastMonth.percentChange}%
                  </span>
                </>
              ) : (
                'مقارنة بصفر في نفس اليوم من الشهر الماضي'
              )}
            </p>
          </div>
        </div>

        {!todayVsLastMonth.hasTodayData && !todayVsLastMonth.hasPrevMonthData ? (
          <div className="mt-4 py-8 px-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              لا توجد بيانات منصرف مسجلة لليوم ({todayVsLastMonth.todayDate}) أو لنفس اليوم من الشهر الماضي ({todayVsLastMonth.prevMonthDate}) بعد.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('sheet')}
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              <span>تسجيل كشف اليوم</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                مقارنة الإجمالي (شيكارة)
              </p>
              <div className="h-56 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={todayVsLastMonth.summaryChartData}
                    margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip
                      formatter={(value) => [
                        `${formatNumberAr(Number(value ?? 0))} شيكارة`,
                        'الإجمالي المنصرف',
                      ]}
                    />
                    <Bar
                      dataKey="المنصرف"
                      maxBarSize={56}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    >
                      {todayVsLastMonth.summaryChartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={entry.key === 'today' ? '#047857' : '#94a3b8'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-7">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                تفصيل المقارنة حسب الصنف (يوريا · نترات · سلفات)
              </p>
              <div className="h-56 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={todayVsLastMonth.fertilizerChartData}
                    margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip
                      formatter={(value, name) => [
                        `${formatNumberAr(Number(value ?? 0))} شيكارة`,
                        String(name ?? ''),
                      ]}
                    />
                    <Legend />
                    <Bar
                      dataKey="الشهر الماضي"
                      fill="#94a3b8"
                      maxBarSize={32}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="اليوم"
                      fill="#047857"
                      maxBarSize={32}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            توزيع المنصرف حسب المحافظة والصنف (شيكارة)
          </h3>
          {chartByGov.length === 0 ? (
            <div className="mt-4 h-72 flex items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
              لا توجد جمعيات مفعّلة لعرض المخططات
            </div>
          ) : (
            <div className="mt-4 h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartByGov} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="يوريا" fill="#047857" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="نترات" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="سلفات" fill="#64748b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            مقارنة بداية اليوم والمنصرف ونهاية اليوم لكل صنف
          </h3>
          {chartByGov.length === 0 ? (
            <div className="mt-4 h-72 flex items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500 dark:text-slate-400">
              لا توجد جمعيات مفعّلة لعرض المخططات
            </div>
          ) : (
            <div className="mt-4 h-72 w-full" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartByFertilizer} margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="بداية اليوم" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="المنصرف" fill="#065f46" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="نهاية اليوم" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Split: Report Statuses + Operational Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              حالة التقارير اليومية الأخيرة
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
            >
              <span>مركز الاعتمادات</span>
              <ArrowUpLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          {reports.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
              لا توجد تقارير يومية مسجلة بعد. ابدأ بتسجيل أرصدة اليوم من «كشف الصرف اليومي».
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {reports.slice(0, 5).map((rep) => {
                const gov = governorates.find((g) => g.id === rep.governorateId);
                return (
                  <div key={rep.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        محافظة {gov?.nameAr || rep.governorateId}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        التاريخ: <span className="font-mono-num">{rep.reportDate}</span> ·{' '}
                        {rep.createdByName}
                      </p>
                    </div>
                    <div className="text-left shrink-0">
                      <span
                        className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${
                          rep.status === 'approved'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                            : rep.status === 'rejected'
                              ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                              : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}
                      >
                        {STATUS_LABELS_AR[rep.status]}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">
            التنبيهات والملاحظات الرقابية
          </h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
              ✔ لا توجد فروقات أو جرارات معلقة حاليًا.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {alerts.map((alert) => (
                <div key={alert.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {alert.title}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                      {alert.detail}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigate(alert.targetTab)}
                    className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    مراجعة
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
