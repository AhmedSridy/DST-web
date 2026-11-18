import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, Download, Search, Warehouse } from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import { computeBalancesReport } from '../utils/analytics.ts';
import { normalizeArabicName } from '../utils/arabicNormalize.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { exportBalancesToExcel } from '../utils/exportDocuments.ts';
import { getVisibleGovernorates, hasGranularAccess } from '../utils/rbac.ts';

export const BalancesView: React.FC = () => {
  const { profile } = useAuth();
  const { governorates, associations, reports, disbursements, settings, pushToast } = useAppData();

  const [asOfDate, setAsOfDate] = useState<string>(getTodayDateIso());
  const [govFilter, setGovFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hideUnrecorded, setHideUnrecorded] = useState<boolean>(false);
  const [expandedGovIds, setExpandedGovIds] = useState<Record<string, boolean>>({
    'gov-ismailia': true,
    'gov-suez': true,
    'gov-portsaid': true,
  });

  const visibleGovernorates = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );

  const rawSummaries = useMemo(
    () =>
      computeBalancesReport({
        governorates: visibleGovernorates,
        associations,
        reports,
        disbursements,
        upToDate: asOfDate,
      }).byGovernorate,
    [asOfDate, associations, disbursements, reports, visibleGovernorates],
  );

  const filteredSummaries = useMemo(() => {
    const q = normalizeArabicName(searchQuery);
    return rawSummaries
      .filter((g) => govFilter === 'all' || g.governorateId === govFilter)
      .map((gov) => {
        const assocs = gov.associations.filter((a) => {
          if (hideUnrecorded && !a.hasAnyRecord) return false;
          if (q) {
            const hay = `${normalizeArabicName(a.associationName)} ${normalizeArabicName(a.associationCode)}`;
            if (!hay.includes(q)) return false;
          }
          return true;
        });
        return {
          ...gov,
          associations: assocs,
        };
      })
      .filter((gov) => gov.associations.length > 0 || (govFilter === 'all' && !q && !hideUnrecorded));
  }, [govFilter, hideUnrecorded, rawSummaries, searchQuery]);

  const grandTotals = useMemo(() => {
    let urea = 0;
    let nitrate = 0;
    let sulfate = 0;
    let recorded = 0;
    let totalAssocs = 0;
    for (const g of filteredSummaries) {
      for (const a of g.associations) {
        totalAssocs++;
        if (a.hasAnyRecord) recorded++;
        urea += a.urea ?? 0;
        nitrate += a.nitrate ?? 0;
        sulfate += a.sulfate ?? 0;
      }
    }
    return { urea, nitrate, sulfate, total: urea + nitrate + sulfate, recorded, totalAssocs };
  }, [filteredSummaries]);

  const toggleGov = (id: string) => {
    setExpandedGovIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const canExport = hasGranularAccess(profile, 'canExport');

  const handleExport = async () => {
    try {
      const filename = await exportBalancesToExcel(
        filteredSummaries,
        asOfDate,
        settings.organizationNameAr || 'منظومة DST للأسمدة الزراعية',
      );
      pushToast({ type: 'success', title: 'تم تصدير تقرير الأرصدة', description: filename });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر التصدير',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء تصدير Excel.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            أرصدة الأسمدة الختامية بالمحافظات والجمعيات
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            عرض آخر رصيد ختامي مسجل لكل جمعية حتى التاريخ المحدد، مع التمييز الصريح بين الصفر الفعلي وعدم التسجيل بعد.
          </p>
        </div>

        {canExport && (
          <button
            type="button"
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            تصدير الأرصدة Excel
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <label className="space-y-1">
          <span className="font-semibold text-slate-600 dark:text-slate-400">حتى تاريخ</span>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 font-mono-num dark:text-slate-100"
          />
        </label>

        <label className="space-y-1">
          <span className="font-semibold text-slate-600 dark:text-slate-400">المحافظة</span>
          <select
            value={govFilter}
            onChange={(e) => setGovFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 dark:text-slate-100"
          >
            <option value="all">كل المحافظات المتاحة</option>
            {visibleGovernorates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="font-semibold text-slate-600 dark:text-slate-400">بحث بالجمعية</span>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="اسم الجمعية أو الكود..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 pr-8 pl-3 py-2 dark:text-slate-100"
            />
          </div>
        </label>

        <label className="flex items-center gap-2 pt-5 cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={hideUnrecorded}
            onChange={(e) => setHideUnrecorded(e.target.checked)}
            className="w-4 h-4 accent-emerald-700"
          />
          <span>إخفاء الجمعيات غير المسجلة</span>
        </label>
      </div>

      {/* Grand Totals Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">الجمعيات المسجلة</span>
          <p className="mt-1 text-xl font-bold font-mono-num text-slate-900 dark:text-slate-100">
            {formatNumberAr(grandTotals.recorded)} / {formatNumberAr(grandTotals.totalAssocs)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">إجمالي يوريا</span>
          <p className="mt-1 text-xl font-bold font-mono-num text-emerald-800 dark:text-emerald-400">
            {formatNumberAr(grandTotals.urea)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">إجمالي نترات</span>
          <p className="mt-1 text-xl font-bold font-mono-num text-teal-800 dark:text-teal-400">
            {formatNumberAr(grandTotals.nitrate)}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">إجمالي سلفات</span>
          <p className="mt-1 text-xl font-bold font-mono-num text-slate-800 dark:text-slate-200">
            {formatNumberAr(grandTotals.sulfate)}
          </p>
        </div>
        <div className="bg-emerald-900 text-white rounded-xl p-4 col-span-2 lg:col-span-1">
          <span className="text-xs text-emerald-200">الإجمالي العام</span>
          <p className="mt-1 text-xl font-bold font-mono-num">{formatNumberAr(grandTotals.total)} شيكارة</p>
        </div>
      </div>

      {/* Governorate Expandable Cards */}
      <div className="space-y-3">
        {filteredSummaries.map((gov) => {
          const isOpen = Boolean(expandedGovIds[gov.governorateId]);
          return (
            <div
              key={gov.governorateId}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleGov(gov.governorateId)}
                className="w-full px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-800 text-right transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronLeft className="w-4 h-4 text-slate-500" />
                  )}
                  <Warehouse className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {gov.governorateName}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ({formatNumberAr(gov.recordedAssociations)} من {formatNumberAr(gov.totalAssociations)} جمعية مسجلة)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono-num">
                  <span className="text-slate-700 dark:text-slate-300">
                    يوريا: <strong>{formatNumberAr(gov.urea)}</strong>
                  </span>
                  <span className="text-slate-700 dark:text-slate-300">
                    نترات: <strong>{formatNumberAr(gov.nitrate)}</strong>
                  </span>
                  <span className="text-slate-700 dark:text-slate-300">
                    سلفات: <strong>{formatNumberAr(gov.sulfate)}</strong>
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-700">
                  {gov.associations.length === 0 ? (
                    <p className="px-4 py-5 text-xs text-slate-500 dark:text-slate-400 text-center">
                      لا توجد جمعيات مسجلة في هذه المحافظة بعد. يمكنك إضافتها من شاشة «الجمعيات والمراكز».
                    </p>
                  ) : (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                          <th className="px-3 py-2.5 text-right">الجمعية الزراعية</th>
                          <th className="px-3 py-2.5 text-center">يوريا</th>
                          <th className="px-3 py-2.5 text-center">نترات</th>
                          <th className="px-3 py-2.5 text-center">سلفات</th>
                          <th className="px-3 py-2.5 text-center">الإجمالي</th>
                          <th className="px-3 py-2.5 text-center">آخر تاريخ تحديث</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {gov.associations.map((a) => (
                          <tr key={a.associationId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2.5">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {a.associationName}
                              </span>{' '}
                              <span className="text-[11px] font-mono-num text-slate-500">
                                ({a.associationCode})
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono-num dark:text-slate-200">
                              {a.urea === null ? '—' : formatNumberAr(a.urea)}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono-num dark:text-slate-200">
                              {a.nitrate === null ? '—' : formatNumberAr(a.nitrate)}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono-num dark:text-slate-200">
                              {a.sulfate === null ? '—' : formatNumberAr(a.sulfate)}
                            </td>
                            <td className="px-3 py-2.5 text-center font-mono-num font-bold text-emerald-800 dark:text-emerald-400">
                              {a.hasAnyRecord ? formatNumberAr(a.total) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {a.lastUpdatedDate ? (
                                <span className="font-mono-num text-slate-700 dark:text-slate-300">
                                  {a.lastUpdatedDate}
                                </span>
                              ) : (
                                <span className="inline-block rounded px-2 py-0.5 text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                  لم يُسجل بعد
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
