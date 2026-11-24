import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type { StockAlertRule } from '../types/domain.ts';
import { getVisibleGovernorates } from '../utils/rbac.ts';
import {
  buildAlertEmailContent,
  evaluateStockAlertRules,
  FERTILIZER_LABELS_AR,
  validateStockAlertRuleInput,
  type EvaluatedStockAlert,
  type SupportedFertilizerCode,
} from '../utils/stockAlerts.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

type FilterTab = 'all' | 'triggered' | 'dismissed' | 'other';

export const StockAlertsView: React.FC = () => {
  const { profile } = useAuth();
  const {
    governorates,
    associations,
    reports,
    disbursements,
    settings,
    stockAlertRules,
    smtpEmailConfigured,
    saveStockAlertRule,
    dismissStockAlertRule,
    resetStockAlertRule,
    resetAllDismissedStockAlerts,
    toggleStockAlertRuleEnabled,
    deleteStockAlertRule,
    sendStockAlertEmailNow,
  } = useAppData();

  const visibleGovernorates = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );
  const canModify = Boolean(profile && profile.role !== 'viewer');

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedGovId, setSelectedGovId] = useState<string>(visibleGovernorates[0]?.id || '');
  const [selectedAssocId, setSelectedAssocId] = useState<string>('');
  const [fertilizerCode, setFertilizerCode] = useState<SupportedFertilizerCode>('urea');
  const [minThresholdInput, setMinThresholdInput] = useState<string>('50');
  const [notifyInApp, setNotifyInApp] = useState<boolean>(true);
  const [notifyEmail, setNotifyEmail] = useState<boolean>(false);
  const [recipientEmail, setRecipientEmail] = useState<string>(profile?.email || '');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [sendingEmailRuleId, setSendingEmailRuleId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [filterGovId, setFilterGovId] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<EvaluatedStockAlert | null>(null);

  const govAssociations = useMemo(
    () =>
      associations.filter(
        (a) =>
          a.governorateId === selectedGovId &&
          a.isActive !== false &&
          a.active !== false,
      ),
    [associations, selectedGovId],
  );

  useEffect(() => {
    if (!selectedGovId && visibleGovernorates.length > 0) {
      setSelectedGovId(visibleGovernorates[0].id);
    }
  }, [selectedGovId, visibleGovernorates]);

  useEffect(() => {
    if (editingRuleId) return;
    if (govAssociations.length === 0) {
      setSelectedAssocId('');
    } else if (!govAssociations.some((a) => a.id === selectedAssocId)) {
      setSelectedAssocId(govAssociations[0].id);
    }
  }, [editingRuleId, govAssociations, selectedAssocId]);

  useEffect(() => {
    if (!editingRuleId && !recipientEmail && profile?.email) {
      setRecipientEmail(profile.email);
    }
  }, [editingRuleId, profile?.email, recipientEmail]);

  const scopedRules = useMemo(() => {
    const allowedGovIds = new Set(visibleGovernorates.map((g) => g.id));
    return stockAlertRules.filter((r) => allowedGovIds.has(r.governorateId));
  }, [stockAlertRules, visibleGovernorates]);

  const evalResult = useMemo(
    () =>
      evaluateStockAlertRules({
        rules: scopedRules,
        governorates: visibleGovernorates,
        associations,
        reports,
        disbursements,
        upToDate: getTodayDateIso(),
      }),
    [associations, disbursements, reports, scopedRules, visibleGovernorates],
  );

  const filteredEvaluated = useMemo(() => {
    return evalResult.evaluated.filter((item) => {
      if (filterGovId !== 'all' && item.rule.governorateId !== filterGovId) return false;
      if (filterTab === 'triggered') return item.runtimeState === 'triggered';
      if (filterTab === 'dismissed') return item.runtimeState === 'dismissed';
      if (filterTab === 'other') {
        return (
          item.runtimeState === 'ok' ||
          item.runtimeState === 'unrecorded' ||
          item.runtimeState === 'disabled'
        );
      }
      return true;
    });
  }, [evalResult.evaluated, filterGovId, filterTab]);

  const canManageRule = (rule: StockAlertRule): boolean => {
    if (!profile || profile.role === 'viewer') return false;
    if (profile.role === 'admin' || profile.role === 'supervisor' || profile.role === 'chief') {
      return true;
    }
    return rule.createdByUid === profile.uid;
  };

  const resetForm = () => {
    setEditingRuleId(null);
    setFormError(null);
    setMinThresholdInput('50');
    setNotifyInApp(true);
    setNotifyEmail(false);
    setRecipientEmail(profile?.email || '');
    if (visibleGovernorates.length > 0 && !visibleGovernorates.some((g) => g.id === selectedGovId)) {
      setSelectedGovId(visibleGovernorates[0].id);
    }
  };

  const handleStartEdit = (item: EvaluatedStockAlert) => {
    setEditingRuleId(item.rule.id);
    setSelectedGovId(item.rule.governorateId);
    setSelectedAssocId(item.rule.associationId);
    setFertilizerCode(item.rule.fertilizerCode);
    setMinThresholdInput(String(item.rule.minThreshold));
    setNotifyInApp(item.rule.notifyInApp);
    setNotifyEmail(item.rule.notifyEmail);
    setRecipientEmail(item.rule.recipientEmail || profile?.email || '');
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsedThreshold = minThresholdInput.trim() === '' ? NaN : Number(minThresholdInput);
    const check = validateStockAlertRuleInput({
      governorateId: selectedGovId,
      associationId: selectedAssocId,
      fertilizerCode,
      minThreshold: parsedThreshold,
      notifyInApp,
      notifyEmail,
      recipientEmail,
    });
    if (!check.ok) {
      setFormError(check.error);
      return;
    }

    setSaving(true);
    try {
      await saveStockAlertRule({
        ...(editingRuleId ? { id: editingRuleId } : {}),
        governorateId: selectedGovId,
        associationId: selectedAssocId,
        fertilizerCode,
        minThreshold: parsedThreshold,
        notifyInApp,
        notifyEmail,
        recipientEmail: notifyEmail ? recipientEmail.trim() : '',
      });
      resetForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ قاعدة التنبيه.');
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = async (item: EvaluatedStockAlert) => {
    setBusyRuleId(item.rule.id);
    try {
      await dismissStockAlertRule(item.rule.id, item.currentBalance, item.lastRecordedDate);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleReset = async (item: EvaluatedStockAlert) => {
    setBusyRuleId(item.rule.id);
    try {
      await resetStockAlertRule(item.rule.id);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleToggleEnabled = async (item: EvaluatedStockAlert) => {
    setBusyRuleId(item.rule.id);
    try {
      await toggleStockAlertRuleEnabled(item.rule.id, !item.rule.isEnabled);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleSendEmail = async (item: EvaluatedStockAlert) => {
    setSendingEmailRuleId(item.rule.id);
    try {
      await sendStockAlertEmailNow(item);
    } finally {
      setSendingEmailRuleId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusyRuleId(deleteTarget.rule.id);
    try {
      await deleteStockAlertRule(deleteTarget.rule.id);
      if (editingRuleId === deleteTarget.rule.id) {
        resetForm();
      }
      setDeleteTarget(null);
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleResetAllDismissed = async () => {
    const ids = evalResult.dismissed.filter((d) => canManageRule(d.rule)).map((d) => d.rule.id);
    if (ids.length === 0) return;
    setBusyRuleId('__bulk_reset__');
    try {
      await resetAllDismissedStockAlerts(ids);
    } finally {
      setBusyRuleId(null);
    }
  };

  const enabledRulesCount = scopedRules.filter((r) => r.isEnabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bell className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <span>تنبيهات مخزون الأسمدة بالجمعيات</span>
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            اضبط حدًا أدنى لمخزون كل صنف سماد داخل مستودع جمعية محددة مع تنبيه داخل النظام أو عبر البريد الإلكتروني، وإمكانية تجاهل التنبيه أو إعادة ضبطه.
          </p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div
          className={`rounded-xl border p-4 ${
            evalResult.triggeredAll.length > 0
              ? 'border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              تنبيهات نشطة (وصلت للحد الأدنى)
            </span>
            <AlertTriangle
              className={`w-4 h-4 ${
                evalResult.triggeredAll.length > 0 ? 'text-rose-600' : 'text-slate-400'
              }`}
            />
          </div>
          <p
            className={`mt-2 text-2xl font-extrabold tabular-nums ${
              evalResult.triggeredAll.length > 0
                ? 'text-rose-700 dark:text-rose-300'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {evalResult.triggeredAll.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            منها {evalResult.triggeredInApp.length} تنبيه داخل النظام
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              قواعد التنبيه المفعّلة
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
            {enabledRulesCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            إجمالي القواعد المضبوطة: {scopedRules.length}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              تنبيهات متجاهَلة
            </span>
            <BellOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
            {evalResult.dismissed.length}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            يمكن إعادة ضبطها لتعود نشطة فورًا
          </p>
        </div>
      </div>

      {/* Active Triggered Alerts Banner */}
      {evalResult.triggeredAll.length > 0 && (
        <section
          aria-label="التنبيهات النشطة حاليًا"
          className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/25 p-4 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-200 font-bold text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>تنبيهات مخزون تتطلب انتباهًا ({evalResult.triggeredAll.length})</span>
            </div>
            <span className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
              الشرط: الرصيد الختامي المسجل يساوي الحد الأدنى أو أقل منه
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {evalResult.triggeredAll.map((item) => {
              const manageable = canManageRule(item.rule);
              const emailContent = item.rule.notifyEmail
                ? buildAlertEmailContent(item, settings.organizationNameAr)
                : null;
              const isBusy = busyRuleId === item.rule.id;
              const isSending = sendingEmailRuleId === item.rule.id;

              return (
                <div
                  key={item.rule.id}
                  className="rounded-lg border border-rose-200 dark:border-rose-800/80 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {item.associationName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {item.governorateName} · {item.fertilizerNameAr}
                        </p>
                      </div>
                      <span className="rounded-md bg-rose-100 dark:bg-rose-900/60 px-2 py-0.5 text-xs font-bold text-rose-800 dark:text-rose-200 whitespace-nowrap">
                        وصل للحد الأدنى
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="text-slate-700 dark:text-slate-300">
                        الرصيد الحالي:{' '}
                        <strong className="text-rose-700 dark:text-rose-300 tabular-nums">
                          {item.currentBalance?.toLocaleString('en-US')} شيكارة
                        </strong>
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">
                        الحد الأدنى:{' '}
                        <strong className="tabular-nums">
                          {item.rule.minThreshold.toLocaleString('en-US')} شيكارة
                        </strong>
                      </span>
                      {item.deficit > 0 && (
                        <span className="text-rose-700 dark:text-rose-300 font-semibold tabular-nums">
                          عجز: {item.deficit.toLocaleString('en-US')} شيكارة
                        </span>
                      )}
                      {item.lastRecordedDate && (
                        <span className="text-slate-500 dark:text-slate-400">
                          آخر رصد: {item.lastRecordedDate}
                        </span>
                      )}
                    </div>

                    {item.rule.notifyEmail && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        البريد المستلم: <span dir="ltr">{item.rule.recipientEmail}</span>
                        {item.rule.lastEmailStatus === 'sent' && item.rule.lastEmailSentAt && (
                          <span className="mr-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                            · تم الإرسال عبر البريد
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {manageable && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDismiss(item)}
                        aria-label={`تجاهل تنبيه ${item.associationName} - ${item.fertilizerNameAr}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-xs font-bold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50"
                      >
                        <BellOff className="w-3.5 h-3.5" />
                        <span>تجاهل التنبيه</span>
                      </button>
                    )}

                    {manageable && item.rule.notifyEmail && emailContent && (
                      <>
                        {profile?.role === 'admin' && smtpEmailConfigured === true && (
                          <button
                            type="button"
                            disabled={isSending}
                            onClick={() => void handleSendEmail(item)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{isSending ? 'جارٍ الإرسال...' : 'إرسال بريد عبر SMTP'}</span>
                          </button>
                        )}
                        <a
                          href={emailContent.mailtoUrl}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>فتح في البريد</span>
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Create / Edit Rule Form */}
      {canModify ? (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {editingRuleId ? (
                <>
                  <Edit3 className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>تعديل قاعدة تنبيه المخزون</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>إضافة قاعدة تنبيه جديدة</span>
                </>
              )}
            </h3>
            {editingRuleId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:underline"
              >
                إلغاء التعديل والبدء بقاعدة جديدة
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <label className="block space-y-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">المحافظة</span>
                <select
                  aria-label="المحافظة"
                  disabled={Boolean(editingRuleId)}
                  value={selectedGovId}
                  onChange={(e) => setSelectedGovId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none disabled:opacity-60"
                >
                  {visibleGovernorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nameAr}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  مستودع الجمعية
                </span>
                <select
                  aria-label="مستودع الجمعية"
                  disabled={Boolean(editingRuleId) || govAssociations.length === 0}
                  value={selectedAssocId}
                  onChange={(e) => setSelectedAssocId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none disabled:opacity-60"
                >
                  {govAssociations.length === 0 ? (
                    <option value="">لا توجد جمعيات مفعّلة</option>
                  ) : (
                    govAssociations.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nameAr}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block space-y-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">نوع السماد</span>
                <select
                  aria-label="نوع السماد"
                  disabled={Boolean(editingRuleId)}
                  value={fertilizerCode}
                  onChange={(e) => setFertilizerCode(e.target.value as SupportedFertilizerCode)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none disabled:opacity-60"
                >
                  <option value="urea">{FERTILIZER_LABELS_AR.urea}</option>
                  <option value="nitrate">{FERTILIZER_LABELS_AR.nitrate}</option>
                  <option value="sulfate">{FERTILIZER_LABELS_AR.sulfate}</option>
                </select>
              </label>

              <label className="block space-y-1.5 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  الحد الأدنى للمخزون (شيكارة)
                </span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  required
                  aria-label="الحد الأدنى للمخزون (شيكارة)"
                  value={minThresholdInput}
                  onChange={(e) => setMinThresholdInput(e.target.value)}
                  placeholder="مثال: 50"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none tabular-nums"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-1">
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  قنوات التنبيه
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyInApp}
                      onChange={(e) => setNotifyInApp(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>تنبيه داخل النظام</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyEmail}
                      onChange={(e) => setNotifyEmail(e.target.checked)}
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>تنبيه عبر البريد الإلكتروني</span>
                  </label>
                </div>
              </div>

              {notifyEmail && (
                <label className="block space-y-1.5 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    البريد الإلكتروني المستلم
                  </span>
                  <input
                    type="email"
                    dir="ltr"
                    required
                    maxLength={160}
                    aria-label="البريد الإلكتروني المستلم"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-emerald-600 focus:outline-none text-left"
                  />
                </label>
              )}
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-200"
              >
                {formError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving || govAssociations.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                <Bell className="w-4 h-4" />
                <span>
                  {saving
                    ? 'جارٍ الحفظ...'
                    : editingRuleId
                      ? 'حفظ تعديل القاعدة'
                      : 'حفظ قاعدة التنبيه'}
                </span>
              </button>
              {editingRuleId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  إلغاء التعديل
                </button>
              )}
            </div>
          </form>
        </section>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 text-xs font-medium text-slate-600 dark:text-slate-400">
          حسابك بصلاحية «مشاهد» فقط — يمكنك متابعة تنبيهات المخزون دون إضافة أو تعديل أو تجاهل القواعد.
        </div>
      )}

      {/* Rules & Dismissed Alerts Management Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: 'all', label: `الكل (${evalResult.evaluated.length})` },
                { id: 'triggered', label: `نشطة ومنبّهة (${evalResult.triggeredAll.length})` },
                { id: 'dismissed', label: `متجاهَلة (${evalResult.dismissed.length})` },
                {
                  id: 'other',
                  label: `آمنة / أخرى (${
                    evalResult.ok.length + evalResult.unrecorded.length + evalResult.disabled.length
                  })`,
                },
              ] as Array<{ id: FilterTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  filterTab === tab.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {visibleGovernorates.length > 1 && (
              <select
                aria-label="تصفية القواعد حسب المحافظة"
                value={filterGovId}
                onChange={(e) => setFilterGovId(e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="all">كل المحافظات</option>
                {visibleGovernorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nameAr}
                  </option>
                ))}
              </select>
            )}

            {canModify && evalResult.dismissed.length > 0 && (
              <button
                type="button"
                disabled={busyRuleId === '__bulk_reset__'}
                onClick={() => void handleResetAllDismissed()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>إعادة ضبط كل المتجاهَلة ({evalResult.dismissed.length})</span>
              </button>
            )}
          </div>
        </div>

        {filteredEvaluated.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <Bell className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              {scopedRules.length === 0
                ? 'لم يتم ضبط أي قواعد تنبيه مخزون بعد.'
                : 'لا توجد قواعد تطابق التصفية المحددة.'}
            </p>
            {scopedRules.length === 0 && canModify && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                اختر الجمعية ونوع السماد والحد الأدنى في النموذج أعلاه لإنشاء أول قاعدة تنبيه.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-bold">الجمعية والمحافظة</th>
                  <th className="py-3 px-3 font-bold">نوع السماد</th>
                  <th className="py-3 px-3 font-bold">الرصيد الحالي</th>
                  <th className="py-3 px-3 font-bold">الحد الأدنى</th>
                  <th className="py-3 px-3 font-bold">قنوات التنبيه</th>
                  <th className="py-3 px-3 font-bold">الحالة</th>
                  <th className="py-3 px-4 font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredEvaluated.map((item) => {
                  const manageable = canManageRule(item.rule);
                  const isBusy = busyRuleId === item.rule.id;
                  const emailContent = item.rule.notifyEmail
                    ? buildAlertEmailContent(item, settings.organizationNameAr)
                    : null;

                  return (
                    <tr
                      key={item.rule.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {item.associationName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {item.governorateName}
                          {!item.associationActive && ' · (موقوفة)'}
                        </div>
                      </td>

                      <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {item.fertilizerNameAr}
                      </td>

                      <td className="py-3 px-3 tabular-nums">
                        {item.currentBalance !== null ? (
                          <div>
                            <span
                              className={`font-bold ${
                                item.runtimeState === 'triggered'
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {item.currentBalance.toLocaleString('en-US')} شيكارة
                            </span>
                            {item.lastRecordedDate && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {item.lastRecordedDate}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">غير مسجل</span>
                        )}
                      </td>

                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                        {item.rule.minThreshold.toLocaleString('en-US')} شيكارة
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.rule.notifyInApp && (
                              <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                                داخل النظام
                              </span>
                            )}
                            {item.rule.notifyEmail && (
                              <span className="rounded bg-sky-50 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800 px-1.5 py-0.5 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
                                بريد إلكتروني
                              </span>
                            )}
                          </div>
                          {item.rule.notifyEmail && item.rule.recipientEmail && (
                            <span
                              dir="ltr"
                              className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[190px] inline-block text-right"
                            >
                              {item.rule.recipientEmail}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        {item.runtimeState === 'triggered' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 dark:bg-rose-900/50 px-2 py-1 text-[11px] font-bold text-rose-800 dark:text-rose-200 whitespace-nowrap">
                            <AlertTriangle className="w-3 h-3" />
                            <span>وصل للحد الأدنى</span>
                          </span>
                        )}
                        {item.runtimeState === 'dismissed' && (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-200 whitespace-nowrap">
                              <BellOff className="w-3 h-3" />
                              <span>متجاهَل</span>
                            </span>
                            {item.rule.dismissedBalance !== null &&
                              item.rule.dismissedBalance !== undefined && (
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  عند رصيد {item.rule.dismissedBalance}
                                </div>
                              )}
                          </div>
                        )}
                        {item.runtimeState === 'ok' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-900/50 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>آمن</span>
                          </span>
                        )}
                        {item.runtimeState === 'unrecorded' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            بانتظار رصد الرصيد
                          </span>
                        )}
                        {item.runtimeState === 'disabled' && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            موقوفة مؤقتًا
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {manageable ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.runtimeState === 'triggered' && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleDismiss(item)}
                                aria-label={`تجاهل ${item.associationName} ${item.fertilizerNameAr}`}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-200 hover:bg-amber-100 disabled:opacity-50"
                              >
                                <BellOff className="w-3 h-3" />
                                <span>تجاهل</span>
                              </button>
                            )}

                            {(item.runtimeState === 'dismissed' ||
                              item.runtimeState === 'disabled' ||
                              item.rule.lastEmailStatus) && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleReset(item)}
                                aria-label={`إعادة ضبط ${item.associationName} ${item.fertilizerNameAr}`}
                                className="inline-flex items-center gap-1 rounded border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 text-[11px] font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>إعادة ضبط</span>
                              </button>
                            )}

                            {item.runtimeState === 'triggered' &&
                              item.rule.notifyEmail &&
                              emailContent && (
                                <a
                                  href={emailContent.mailtoUrl}
                                  className="inline-flex items-center gap-1 rounded border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 px-2 py-1 text-[11px] font-bold text-sky-800 dark:text-sky-300 hover:bg-sky-100"
                                >
                                  <Mail className="w-3 h-3" />
                                  <span>بريد</span>
                                </a>
                              )}

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleStartEdit(item)}
                              aria-label={`تعديل قاعدة ${item.associationName} ${item.fertilizerNameAr}`}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>تعديل</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleToggleEnabled(item)}
                              aria-label={
                                item.rule.isEnabled
                                  ? `إيقاف قاعدة ${item.associationName} ${item.fertilizerNameAr}`
                                  : `تفعيل قاعدة ${item.associationName} ${item.fertilizerNameAr}`
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                            >
                              {item.rule.isEnabled ? (
                                <>
                                  <PauseCircle className="w-3 h-3" />
                                  <span>إيقاف</span>
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="w-3 h-3" />
                                  <span>تفعيل</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => setDeleteTarget(item)}
                              aria-label={`حذف قاعدة ${item.associationName} ${item.fertilizerNameAr}`}
                              className="inline-flex items-center gap-1 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-2 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-50"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>حذف</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="تأكيد حذف قاعدة التنبيه"
        message={
          deleteTarget
            ? `هل تريد حذف قاعدة تنبيه «${deleteTarget.fertilizerNameAr}» لمستودع جمعية «${deleteTarget.associationName}» (الحد الأدنى ${deleteTarget.rule.minThreshold} شيكارة)؟`
            : ''
        }
        confirmLabel="حذف القاعدة"
        cancelLabel="إلغاء"
        variant="danger"
        isSubmitting={Boolean(deleteTarget && busyRuleId === deleteTarget.rule.id)}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
