import React, { useState } from 'react';
import { ShieldCheck, Sprout, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import type { UserRole } from '../types/domain.ts';
import { ROLE_LABELS_AR } from '../utils/rbac.ts';

export const LoginView: React.FC = () => {
  const { signInWithGoogle, enterPreviewMode, isPreviewAllowed, authError, loading } = useAuth();
  const [selectedPreviewRole, setSelectedPreviewRole] = useState<UserRole>('admin');

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-8"
    >
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm">
        {/* Right Panel: Brand & Institutional Identity */}
        <div className="lg:col-span-5 bg-emerald-900 text-white p-8 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5 text-emerald-200 text-xs font-medium">
              <Sprout className="w-5 h-5 text-emerald-300" />
              <span>الإدارة المركزية للرقابة الزراعية</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold leading-snug">
              منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية
            </h1>
            <p className="text-sm text-emerald-100/90 leading-relaxed">
              منصة موحدة لمتابعة أرصدة الجمعيات التعاونية عبر 27 محافظة، استلام الجرارات والبوليصات، القراءة الذكية للكشوف، والتقارير المعتمدة حتى عند انقطاع الاتصال.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-emerald-800 space-y-2 text-xs text-emerald-100/80">
            <p>الأصناف المدعومة: يوريا · نترات · سلفات</p>
            <p>النطاق الجغرافي: 27 محافظة · المراكز · الجمعيات</p>
          </div>
        </div>

        {/* Left Panel: Auth Actions */}
        <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-center space-y-5">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              تسجيل الدخول إلى المنظومة
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              استخدم حساب Google المؤسسي المعتمد للوصول إلى قاعدة البيانات السحابية وخدمات القراءة الذكية.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
            >
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void signInWithGoogle()}
            className="w-full inline-flex items-center justify-center gap-3 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-800 transition-colors disabled:opacity-60"
          >
            <ShieldCheck className="w-5 h-5" />
            <span>تسجيل الدخول بحساب Google</span>
          </button>

          {isPreviewAllowed && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-slate-900 px-3 text-slate-500 dark:text-slate-400">
                    أو معاينة تفاعلية محلية (وضع التطوير فقط)
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label
                    htmlFor="preview-role-select"
                    className="text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    اختر الدور الوظيفي للمعاينة الميدانية:
                  </label>
                  <select
                    id="preview-role-select"
                    value={selectedPreviewRole}
                    onChange={(e) => setSelectedPreviewRole(e.target.value as UserRole)}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 focus:border-emerald-600 focus:outline-none"
                  >
                    {(['admin', 'chief', 'supervisor', 'field_staff', 'viewer'] as UserRole[]).map(
                      (role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS_AR[role]}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void enterPreviewMode(selectedPreviewRole)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>دخول بوضع المعاينة التفاعلية</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
