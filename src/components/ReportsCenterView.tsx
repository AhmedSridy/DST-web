import React, { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { formatNumberAr } from '../utils/calculations.ts';
import { getVisibleGovernorates, hasGranularAccess } from '../utils/rbac.ts';

export const ReportsCenterView: React.FC = () => {
  const { profile } = useAuth();
  const { governorates, associations, fertilizerTypes, reports, disbursements, pushToast } = useAppData();

  const visibleGovs = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );
  const canExport = hasGranularAccess(profile, 'canExport');

  const [filterGov, setFilterGov] = useState('all');
  const [onlyVariances, setOnlyVariances] = useState(false);
  const [exporting, setExporting] = useState(false);

  const enrichedRows = useMemo(() => {
    const visibleSet = new Set(visibleGovs.map((g) => g.id));
    const repMap = new Map(reports.map((r) => [r.id, r]));
    return disbursements
      .map((d) => {
        const rep = repMap.get(d.reportId);
        const gov = governorates.find((g) => g.id === rep?.governorateId);
        const assoc = associations.find((a) => a.id === d.associationId);
        const fert = fertilizerTypes.find((f) => f.code === d.fertilizerCode);
        return {
          ...d,
          reportDate: rep?.reportDate || '',
          governorateId: rep?.governorateId || '',
          govName: gov?.nameAr || '',
          assocName: assoc?.nameAr || 'جمعية محذوفة',
          assocCode: assoc?.code || '',
          fertName: fert?.nameAr || d.fertilizerCode,
        };
      })
      .filter((row) => {
        if (!visibleSet.has(row.governorateId)) return false;
        if (filterGov !== 'all' && row.governorateId !== filterGov) return false;
        if (onlyVariances && (row.variance === null || Math.abs(row.variance) < 0.001)) {
          return false;
        }
        return true;
      });
  }, [associations, disbursements, fertilizerTypes, filterGov, governorates, onlyVariances, reports, visibleGovs]);

  const summary = useMemo(() => {
    return {
      opening: enrichedRows.reduce((s, r) => s + (r.openingBalance ?? 0), 0),
      closing: enrichedRows.reduce((s, r) => s + (r.closingBalance ?? 0), 0),
      actual: enrichedRows.reduce((s, r) => s + (r.actualDisbursed ?? 0), 0),
      settlement: enrichedRows.reduce((s, r) => s + (r.settlementQty ?? 0), 0),
      variance: enrichedRows.reduce((s, r) => s + (r.variance ?? 0), 0),
    };
  }, [enrichedRows]);

  const handleExport = async () => {
    if (!canExport) {
      pushToast({
        type: 'warning',
        title: 'غير مصرح بالتصدير',
        description: 'دورك الوظيفي لا يملك صلاحية تصدير التقارير.',
      });
      return;
    }

    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'منظومة DST';
      wb.created = new Date();

      const ws = wb.addWorksheet('تقرير إحصائي', {
        views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      });

      ws.columns = [
        { header: 'المحافظة', key: 'govName', width: 18 },
        { header: 'التاريخ', key: 'reportDate', width: 14 },
        { header: 'كود الجمعية', key: 'assocCode', width: 14 },
        { header: 'الجمعية', key: 'assocName', width: 28 },
        { header: 'الصنف', key: 'fertName', width: 12 },
        { header: 'بداية اليوم', key: 'openingBalance', width: 14 },
        { header: 'نهاية اليوم', key: 'closingBalance', width: 14 },
        { header: 'المنصرف', key: 'actualDisbursed', width: 14 },
        { header: 'التسوية', key: 'settlementQty', width: 14 },
        { header: 'فرق التسوية', key: 'variance', width: 14 },
        { header: 'الحالة', key: 'status', width: 14 },
        { header: 'السبب', key: 'varianceReason', width: 26 },
      ];

      const headerRow = ws.getRow(1);
      headerRow.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.height = 24;

      for (const r of enrichedRows) {
        const statusLabel =
          r.variance === null
            ? 'غير مكتمل'
            : Math.abs(r.variance) <= 0.001
              ? '✔ مطابق'
              : '⚠ اختلاف';
        const row = ws.addRow({
          govName: r.govName,
          reportDate: r.reportDate,
          assocCode: r.assocCode,
          assocName: r.assocName,
          fertName: r.fertName,
          openingBalance: r.openingBalance ?? '',
          closingBalance: r.closingBalance ?? '',
          actualDisbursed: r.actualDisbursed ?? '',
          settlementQty: r.settlementQty ?? '',
          variance: r.variance ?? '',
          status: statusLabel,
          varianceReason: r.varianceReason || '',
        });
        row.font = { name: 'Cairo', size: 10 };
        row.alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell('assocName').alignment = { vertical: 'middle', horizontal: 'right' };
        row.getCell('govName').alignment = { vertical: 'middle', horizontal: 'right' };
      }

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DST-Report-${filterGov}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      pushToast({ type: 'success', title: 'تم تصدير التقرير الإحصائي بصيغة Excel بنجاح' });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر تصدير التقرير',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء إنشاء ملف Excel.',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            مركز التقارير والإحصائيات
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            تجميع وتحليل بيانات الصرف والفروقات وتصدير التقارير بصيغة Excel أو طباعتها
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void handleExport()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'جارٍ التصدير...' : 'تصدير Excel'}
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        </div>
      </div>

      {/* Filters & Totals */}
      <div className="no-print bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="تصفية التقرير بالمحافظة"
            value={filterGov}
            onChange={(e) => setFilterGov(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
          >
            <option value="all">كل المحافظات المتاحة</option>
            {visibleGovs.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nameAr}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={onlyVariances}
              onChange={(e) => setOnlyVariances(e.target.checked)}
              className="w-4 h-4 accent-emerald-700"
            />
            عرض بنود الاختلاف فقط
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 font-semibold text-slate-700 dark:text-slate-300">
          <span>
            إجمالي بداية اليوم:{' '}
            <strong className="font-mono-num text-slate-900 dark:text-slate-100">
              {formatNumberAr(summary.opening)}
            </strong>
          </span>
          <span>
            إجمالي المنصرف:{' '}
            <strong className="font-mono-num text-emerald-900 dark:text-emerald-400">
              {formatNumberAr(summary.actual)}
            </strong>
          </span>
          <span>
            إجمالي نهاية اليوم:{' '}
            <strong className="font-mono-num text-slate-900 dark:text-slate-100">
              {formatNumberAr(summary.closing)}
            </strong>
          </span>
          <span>
            صافي فرق التسوية:{' '}
            <strong className="font-mono-num text-amber-800 dark:text-amber-400">
              {formatNumberAr(summary.variance)}
            </strong>
          </span>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-3 text-right">المحافظة</th>
                <th className="px-3 py-3 text-right">الجمعية</th>
                <th className="px-3 py-3 text-center">الصنف</th>
                <th className="px-3 py-3 text-center">التاريخ</th>
                <th className="px-3 py-3 text-center">بداية</th>
                <th className="px-3 py-3 text-center">نهاية</th>
                <th className="px-3 py-3 text-center">المنصرف</th>
                <th className="px-3 py-3 text-center">التسوية</th>
                <th className="px-3 py-3 text-center">فرق التسوية</th>
                <th className="px-3 py-3 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {enrichedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    لا توجد سجلات مطابقة لمعايير التصفية الحالية.
                  </td>
                </tr>
              ) : (
                enrichedRows.map((row) => {
                  const hasVar = row.variance !== null && Math.abs(row.variance) > 0.001;
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{row.govName}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                        {row.assocName}
                      </td>
                      <td className="px-3 py-2.5 text-center">{row.fertName}</td>
                      <td className="px-3 py-2.5 text-center font-mono-num">{row.reportDate}</td>
                      <td className="px-3 py-2.5 text-center font-mono-num">
                        {formatNumberAr(row.openingBalance)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono-num">
                        {formatNumberAr(row.closingBalance)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono-num font-bold text-emerald-900 dark:text-emerald-400">
                        {formatNumberAr(row.actualDisbursed)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono-num">
                        {formatNumberAr(row.settlementQty)}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono-num font-bold">
                        {formatNumberAr(row.variance)}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {row.variance === null ? (
                          <span className="text-slate-500 dark:text-slate-400">غير مكتمل</span>
                        ) : hasVar ? (
                          <span className="inline-block rounded bg-rose-100 dark:bg-rose-900/50 text-rose-900 dark:text-rose-200 px-2 py-0.5 font-bold">
                            ⚠ اختلاف
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200 px-2 py-0.5 font-bold">
                            ✔ مطابق
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
