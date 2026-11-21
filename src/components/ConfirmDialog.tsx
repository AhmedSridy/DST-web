import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  warningNote?: string;
  errorMessage?: string | null;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonValue?: string;
  onReasonChange?: (value: string) => void;
  maxReasonLength?: number;
  confirmTextExpected?: string;
  confirmTextLabel?: string;
  confirmTextPlaceholder?: string;
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant = 'danger',
  warningNote,
  errorMessage,
  reasonLabel,
  reasonPlaceholder,
  reasonValue = '',
  onReasonChange,
  maxReasonLength = 300,
  confirmTextExpected,
  confirmTextLabel,
  confirmTextPlaceholder,
  isSubmitting = false,
  onConfirm,
  onCancel,
}) => {
  const [typedConfirm, setTypedConfirm] = useState('');

  useEffect(() => {
    if (!open) {
      setTypedConfirm('');
    }
  }, [open, confirmTextExpected]);

  if (!open) return null;

  const requiresTypedConfirm = Boolean(confirmTextExpected && confirmTextExpected.trim().length > 0);
  const typedMatches =
    !requiresTypedConfirm || typedConfirm.trim() === (confirmTextExpected || '').trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle
              className={`w-5 h-5 shrink-0 ${
                variant === 'danger' ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'
              }`}
            />
            <h3 id="confirm-dialog-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            aria-label="إغلاق"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
          {message}
        </p>

        {warningNote && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 whitespace-pre-line">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
            <span>{warningNote}</span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2 text-xs font-semibold text-rose-800 dark:text-rose-200 leading-relaxed"
          >
            {errorMessage}
          </div>
        )}

        {requiresTypedConfirm && (
          <label className="mt-4 block space-y-1.5 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {confirmTextLabel || `اكتب «${confirmTextExpected}» للتأكيد النهائي:`}
            </span>
            <input
              type="text"
              disabled={isSubmitting}
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder={confirmTextPlaceholder || confirmTextExpected}
              className="w-full rounded-lg border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40 disabled:opacity-60"
            />
          </label>
        )}

        {reasonLabel && onReasonChange && (
          <label className="mt-4 block space-y-1.5 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{reasonLabel}</span>
            <textarea
              rows={2}
              maxLength={maxReasonLength}
              disabled={isSubmitting}
              value={reasonValue}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={reasonPlaceholder}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40 disabled:opacity-60"
            />
          </label>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isSubmitting || !typedMatches}
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 whitespace-nowrap ${
              variant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

