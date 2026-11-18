import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, X } from 'lucide-react';
import type { ExportFormat, ExportScope } from '../types/domain.ts';
import { formatNumberAr } from '../utils/calculations.ts';
import { buildExportFileName } from '../utils/exportDocuments.ts';

interface ExportModalProps {
  open: boolean;
  governorateNameAr: string;
  reportDate: string;
  associationsCount: number;
  tractorsCount: number;
  onClose: () => void;
  onExport: (format: ExportFormat, scope: ExportScope) => Promise<void>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  governorateNameAr,
  reportDate,
  associationsCount,
  tractorsCount,
  onClose,
  onExport,
}) => {
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [scope, setScope] = useState<ExportScope>('both');
  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    setExporting(true);
    try {
      await onExport(format, scope);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-2xl space-y-5 text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            <h3 id="export-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
              تصدير كشوف الصرف والجرارات
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق نافذة التصدير"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Summary Card */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 grid grid-cols-2 gap-2.5">
          <div>
            <span className="text-slate-500 dark:text-slate-400">المحافظة:</span>
            <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">{governorateNameAr}</p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">التاريخ:</span>
            <p className="font-bold font-mono-num text-slate-900 dark:text-slate-100 mt-0.5">{reportDate}</p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">الجمعيات بالكشف:</span>
            <p className="font-bold font-mono-num text-emerald-800 dark:text-emerald-400 mt-0.5">
              {formatNumberAr(associationsCount)} جمعية
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">الجرارات في اليوم:</span>
            <p className="font-bold font-mono-num text-slate-900 dark:text-slate-100 mt-0.5">
              {formatNumberAr(tractorsCount)} جرار
            </p>
          </div>
        </div>

        {/* Format Selection */}
        <div className="space-y-2">
          <p className="font-bold text-slate-800 dark:text-slate-200">اختر صيغة الملف:</p>
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { id: 'xlsx', label: 'Excel (.xlsx)', sub: 'معادلات حية + 3 أوراق', icon: FileSpreadsheet },
                { id: 'docx', label: 'Word (.docx)', sub: 'أفقي A4 · جداول RTL', icon: FileText },
                { id: 'pdf', label: 'PDF للطباعة', sub: 'أبيض وأسود A4 أفقي', icon: FileText },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = format === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFormat(opt.id)}
                  className={`rounded-xl border p-3 text-right transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-200'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 mb-1.5 text-emerald-700 dark:text-emerald-400" />
                  <div className="font-bold">{opt.label}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Scope Selection for Word & PDF */}
        {(format === 'docx' || format === 'pdf') && (
          <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 bg-slate-50/50 dark:bg-slate-800/40">
            <p className="font-bold text-slate-800 dark:text-slate-200">نطاق التصدير:</p>
            <div className="space-y-2">
              {(
                [
                  ['both', 'كشف الصرف + الجرارات في ملف واحد'],
                  ['sheet_only', 'كشف الصرف فقط'],
                  ['tractors_only', 'الجرارات فقط'],
                ] as const
              ).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer text-slate-800 dark:text-slate-200">
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === val}
                    onChange={() => setScope(val)}
                    className="w-4 h-4 accent-emerald-700"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          اسم الملف المتوقع:{' '}
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {buildExportFileName(governorateNameAr, reportDate, format)}
          </span>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            إلغاء
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{exporting ? 'جارٍ التجهيز...' : 'تنزيل الملف الآن'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
