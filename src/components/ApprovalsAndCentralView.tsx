import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, CloudUpload, Send, X, XCircle } from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import type { DailyReport, ReportStatus } from '../types/domain.ts';
import {
  canTransitionReportStatus,
  getVisibleGovernorates,
  ROLE_LABELS_AR,
  STATUS_LABELS_AR,
} from '../utils/rbac.ts';

export const ApprovalsAndCentralView: React.FC = () => {
  const { profile } = useAuth();
  const {
    governorates,
    reports,
    approvals,
    integrationLogs,
    transitionReportStatus,
    syncReportCentral,
    pushToast,
  } = useAppData();

  const visibleGovIds = useMemo(
    () => new Set(getVisibleGovernorates(profile, governorates).map((g) => g.id)),
    [governorates, profile],
  );
  const visibleReports = useMemo(
    () => reports.filter((r) => visibleGovIds.has(r.governorateId)),
    [reports, visibleGovIds],
  );

  const [rejectModalReport, setRejectModalReport] = useState<DailyReport | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState('');

  const handleAction = async (reportId: string, nextStatus: ReportStatus, notes?: string) => {
    try {
      await transitionReportStatus(reportId, nextStatus, notes);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر تنفيذ الإجراء',
        description: error instanceof Error ? error.message : 'تحقق من صلاحيات الدور.',
      });
    }
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalReport) return;
    await handleAction(rejectModalReport.id, 'rejected', rejectionNotes);
    setRejectModalReport(null);
    setRejectionNotes('');
  };

  const handleSyncCentral = async (reportId: string) => {
    try {
      await syncReportCentral(reportId);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر الإرسال المركزي',
        description: error instanceof Error ? error.message : 'حدث خطأ أثناء الإرسال.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          مركز الاعتمادات والربط بالمنظومة المركزية
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
          دورة اعتماد التقارير اليومية (مسودة ← مكتمل ← قيد المراجعة ← معتمد / مرفوض) وتوثيق الإرسال المركزي
        </p>
      </div>

      {/* Reports Workflow Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            التقارير اليومية وحالة الاعتماد
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-3 text-right">المحافظة</th>
                <th className="px-3 py-3 text-center">التاريخ</th>
                <th className="px-3 py-3 text-center">حالة التقرير</th>
                <th className="px-3 py-3 text-center">الربط المركزي</th>
                <th className="px-3 py-3 text-right">ملاحظات / سبب الرفض</th>
                <th className="px-3 py-3 text-center">إجراءات المرحلة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {visibleReports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    لا توجد تقارير يومية مسجلة في النطاق المحدد بعد.
                  </td>
                </tr>
              ) : (
                visibleReports.map((rep) => {
                  const gov = governorates.find((g) => g.id === rep.governorateId);
                  const role = profile?.role || 'field_staff';
                  const canComplete = canTransitionReportStatus(rep.status, 'completed', role);
                  const canReview = canTransitionReportStatus(rep.status, 'under_review', role);
                  const canApprove = canTransitionReportStatus(rep.status, 'approved', role);
                  const canReject = canTransitionReportStatus(rep.status, 'rejected', role);
                  const canSendCentral =
                    rep.status === 'approved' &&
                    (role === 'chief' || role === 'admin') &&
                    rep.centralSyncStatus !== 'synced';

                  return (
                    <tr key={rep.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-3 font-bold text-slate-900 dark:text-slate-100">
                        {gov?.nameAr || rep.governorateId}
                      </td>
                      <td className="px-3 py-3 text-center font-mono-num">{rep.reportDate}</td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded px-2.5 py-0.5 font-semibold ${
                            rep.status === 'approved'
                              ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200'
                              : rep.status === 'rejected'
                                ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-900 dark:text-rose-200'
                                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {STATUS_LABELS_AR[rep.status]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded px-2 py-0.5 font-semibold ${
                            rep.centralSyncStatus === 'synced'
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {rep.centralSyncStatus === 'synced' ? '✔ تم الإرسال' : 'قيد الانتظار'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300 max-w-xs">
                        {rep.rejectionReason || '—'}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                          {canComplete && rep.status !== 'completed' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleAction(rep.id, 'completed', 'تم استكمال التقرير')
                              }
                              className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-slate-900"
                            >
                              <Send className="w-3 h-3" />
                              إكمال وإرسال
                            </button>
                          )}
                          {canReview && rep.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleAction(rep.id, 'under_review', 'تمت المراجعة الميدانية')
                              }
                              className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-700"
                            >
                              <Clock className="w-3 h-3" />
                              تحويل للاعتماد
                            </button>
                          )}
                          {canApprove && rep.status !== 'approved' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleAction(rep.id, 'approved', 'اعتماد نهائي للتقرير')
                              }
                              className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-800"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              اعتماد نهائي
                            </button>
                          )}
                          {canReject && rep.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => setRejectModalReport(rep)}
                              className="inline-flex items-center gap-1 rounded border border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/50 px-2.5 py-1.5 text-[11px] font-bold text-rose-800 dark:text-rose-200 hover:bg-rose-100"
                            >
                              <XCircle className="w-3 h-3" />
                              رفض
                            </button>
                          )}
                          {canSendCentral && (
                            <button
                              type="button"
                              onClick={() => void handleSyncCentral(rep.id)}
                              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800"
                            >
                              <CloudUpload className="w-3 h-3" />
                              إرسال مركزي
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approvals Timeline & Integration Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">سجل حركة الاعتمادات</h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
            {approvals.map((app) => {
              const gov = governorates.find((g) => g.id === app.governorateId);
              return (
                <div key={app.id} className="py-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {gov?.nameAr} ({app.reportDate})
                    </span>
                    <span className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                      {app.createdAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">
                    {app.actorName} ({ROLE_LABELS_AR[app.actorRole]}) · {STATUS_LABELS_AR[app.fromStatus]} ←{' '}
                    <span className="font-semibold">{STATUS_LABELS_AR[app.toStatus]}</span>
                  </p>
                  <p className="text-slate-500 dark:text-slate-400">{app.notes}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            سجلات التكامل مع المنظومة المركزية
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
            {integrationLogs.map((log) => {
              const gov = governorates.find((g) => g.id === log.governorateId);
              return (
                <div key={log.id} className="py-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {gov?.nameAr} · HTTP <span className="font-mono-num">{log.httpStatus}</span>
                    </span>
                    <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                      {log.status === 'success' ? '✔ ناجح' : '⚠ فشل'}
                    </span>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300">{log.payloadSummary}</p>
                  <p className="text-slate-500 dark:text-slate-400">{log.responseMessage}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rejection Modal */}
      {rejectModalReport && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <form
            onSubmit={(e) => void handleConfirmReject(e)}
            className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                رفض التقرير اليومي
              </h3>
              <button
                type="button"
                onClick={() => setRejectModalReport(null)}
                aria-label="إغلاق"
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="block space-y-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-300">سبب الرفض (إلزامي)</span>
              <textarea
                required
                rows={3}
                value={rejectionNotes}
                onChange={(e) => setRejectionNotes(e.target.value)}
                placeholder="اكتب ملاحظات المراجعة المطلوب تعديلها قبل إعادة الإرسال..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 p-3 text-xs"
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModalReport(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="rounded-lg bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700"
              >
                تأكيد الرفض
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
