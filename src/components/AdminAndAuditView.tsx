import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock,
  Download,
  Edit3,
  History,
  KeyRound,
  Plus,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useAppData } from '../context/AppDataContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { getTodayDateIso } from '../data/seedData.ts';
import type { GranularPermissions, UserInvite, UserProfile, UserRole } from '../types/domain.ts';
import { sha256Hex } from '../utils/crypto.ts';
import { getDefaultGranularPermissions, ROLE_LABELS_AR } from '../utils/rbac.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

const PERMISSION_LABELS_AR: Array<{ key: keyof GranularPermissions; label: string }> = [
  { key: 'canEdit', label: 'تعديل وحفظ كشوف الصرف والجرارات' },
  { key: 'canExport', label: 'تصدير الكشوف والتقارير (Excel / Word / PDF)' },
  { key: 'canClearDay', label: 'مسح سجل يوم كامل' },
  { key: 'canManageAssociations', label: 'إدارة الجمعيات ونقاط التوزيع' },
  { key: 'canViewBalances', label: 'عرض صفحة الأرصدة الختامية' },
  { key: 'canViewAnalytics', label: 'عرض نافذة المتابعة والتحليل' },
];

const ALL_ROLES: UserRole[] = ['viewer', 'field_staff', 'supervisor', 'chief', 'admin'];

interface UserFormState {
  uid?: string;
  inviteId?: string;
  displayName: string;
  email: string;
  role: UserRole;
  governorateIds: string[];
  permissions: GranularPermissions;
  password: string;
  isActive: boolean;
}

type DeleteTarget =
  | { kind: 'user'; id: string; displayName: string; email: string }
  | { kind: 'invite'; id: string; displayName: string; email: string };

export const AdminAndAuditView: React.FC = () => {
  const { profile, authMode } = useAuth();
  const {
    users,
    invites,
    governorates,
    settings,
    auditLogs,
    createOrUpdateUser,
    deleteUser,
    updateUserRole,
    updateSettings,
    exportBackupJson,
    restoreBackupJson,
    pushToast,
  } = useAppData();

  const [organizationNameAr, setOrganizationNameAr] = useState(
    settings.organizationNameAr || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
  );
  const [treatEmptyAsZero, setTreatEmptyAsZero] = useState(Boolean(settings.treatEmptyAsZero));
  const [requireNationalId, setRequireNationalId] = useState(settings.requireDriverNationalId);
  const [centralApiUrl, setCentralApiUrl] = useState(settings.centralApiUrl);
  const [autoSync, setAutoSync] = useState(settings.autoSyncOnApproval);
  const [auditSearch, setAuditSearch] = useState('');

  const [userForm, setUserForm] = useState<UserFormState | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingRestoreJson, setPendingRestoreJson] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrganizationNameAr(
      settings.organizationNameAr || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
    );
    setTreatEmptyAsZero(Boolean(settings.treatEmptyAsZero));
    setRequireNationalId(settings.requireDriverNationalId);
    setCentralApiUrl(settings.centralApiUrl);
    setAutoSync(settings.autoSyncOnApproval);
  }, [settings]);

  const unclaimedInvites = useMemo(
    () =>
      invites.filter(
        (inv) =>
          !inv.claimedUid &&
          !users.some((u) => u.email.trim().toLowerCase() === inv.email.trim().toLowerCase()),
      ),
    [invites, users],
  );

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        (l.oldValue || '').toLowerCase().includes(q) ||
        (l.newValue || '').toLowerCase().includes(q),
    );
  }, [auditLogs, auditSearch]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings({
        organizationNameAr:
          organizationNameAr.trim() || 'منظومة DST لإدارة ومراقبة صرف الأسمدة الزراعية',
        treatEmptyAsZero,
        requireDriverNationalId: requireNationalId,
        centralApiUrl,
        autoSyncOnApproval: autoSync,
      });
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حفظ الإعدادات',
        description: error instanceof Error ? error.message : 'تحقق من الصلاحيات.',
      });
    }
  };

  const openCreateUserModal = () => {
    setUserForm({
      displayName: '',
      email: '',
      role: 'field_staff',
      governorateIds: ['gov-ismailia'],
      permissions: getDefaultGranularPermissions('field_staff'),
      password: '',
      isActive: true,
    });
  };

  const openEditUserModal = (u: UserProfile) => {
    const govIds =
      u.governorateIds && u.governorateIds.length > 0
        ? u.governorateIds
        : u.governorateId
          ? [u.governorateId]
          : [];
    setUserForm({
      uid: u.uid,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      governorateIds: govIds,
      permissions: u.permissions || getDefaultGranularPermissions(u.role),
      password: '',
      isActive: u.isActive,
    });
  };

  const openEditInviteModal = (inv: UserInvite) => {
    setUserForm({
      inviteId: inv.id,
      displayName: inv.displayName,
      email: inv.email,
      role: inv.role,
      governorateIds: inv.governorateIds || [],
      permissions: inv.permissions || getDefaultGranularPermissions(inv.role),
      password: '',
      isActive: inv.isActive,
    });
  };

  const handleSubmitUserModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm) return;
    if (!userForm.displayName.trim() || !userForm.email.trim()) {
      pushToast({
        type: 'error',
        title: 'بيانات ناقصة',
        description: 'يرجى إدخال اسم المستخدم والبريد الإلكتروني.',
      });
      return;
    }

    const isGlobalRole = userForm.role === 'admin' || userForm.role === 'chief';
    if (!isGlobalRole && userForm.governorateIds.length === 0) {
      pushToast({
        type: 'error',
        title: 'نطاق المحافظات مطلوب',
        description: `يرجى تحديد محافظة واحدة على الأقل لدور «${ROLE_LABELS_AR[userForm.role]}».`,
      });
      return;
    }

    setSavingUser(true);
    try {
      const passwordHash =
        authMode === 'preview' && userForm.password.trim()
          ? await sha256Hex(userForm.password.trim())
          : undefined;
      await createOrUpdateUser({
        uid: userForm.uid,
        inviteId: userForm.inviteId,
        displayName: userForm.displayName.trim(),
        email: userForm.email.trim().toLowerCase(),
        role: userForm.role,
        governorateIds: userForm.governorateIds,
        permissions: userForm.permissions,
        passwordHash,
        isActive: userForm.isActive,
      });
      setUserForm(null);
    } catch (error: unknown) {
      pushToast({
        type: 'error',
        title: 'تعذر حفظ بيانات المستخدم',
        description: error instanceof Error ? error.message : 'تحقق من الصلاحيات والبيانات المدخلة.',
      });
    } finally {
      setSavingUser(false);
    }
  };

  const handleExportBackup = () => {
    const json = exportBackupJson();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dst-backup-${getTodayDateIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({
      type: 'success',
      title: 'تم تصدير النسخة الاحتياطية',
      description: 'حُفظت البيانات في ملف JSON دون أي كلمات مرور أو مفاتيح سرية.',
    });
  };

  const handleRestoreFileSelected = async (file: File) => {
    try {
      const text = await file.text();
      JSON.parse(text);
      setPendingRestoreJson(text);
    } catch {
      pushToast({
        type: 'error',
        title: 'ملف غير صالح',
        description: 'تأكد من اختيار ملف نسخة احتياطية بصيغة JSON صحيحة.',
      });
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const formatGovSummary = (role: UserRole, govList: string[]) => {
    if (govList.length === 0) {
      return role === 'admin' || role === 'chief' ? 'كل المحافظات' : '⚠ غير مخصص';
    }
    if (govList.length === 1) {
      return governorates.find((g) => g.id === govList[0])?.nameAr || govList[0];
    }
    return `${govList.length} محافظات`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            إدارة المنظومة والصلاحيات وسجل التدقيق
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            إدارة المستخدمين والدعوات المعتمدة وتخصيص المحافظات والصلاحيات الدقيقة والنسخ الاحتياطي
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateUserModal}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          {authMode === 'firebase' ? 'إضافة / دعوة مستخدم بالبريد' : 'إضافة مستخدم جديد'}
        </button>
      </div>

      {/* Security Notice */}
      <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
        <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>سياسة الدخول والصلاحيات:</strong>{' '}
          {authMode === 'preview'
            ? 'في وضع المعاينة المحلية تُحفظ الحسابات محليًا لتجربة الأدوار. في بيئة الإنتاج السحابية يتم الدخول حصريًا بدعوة من المدير عبر Google Auth وقواعد Firestore Security Rules.'
            : 'التسجيل المفتوح معطّل تمامًا: لا يمكن لأي حساب Google الدخول إلا إذا كان المدير الرئيسي أو أُضيف مسبقًا من هنا في سجل الدعوات (user_invites). تُفرض كافة الصلاحيات ونطاق المحافظات عبر قواعد أمان Firestore.'}
        </p>
      </div>

      {/* Users & Invites + Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-5">
          {/* Active/Registered Users */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-800 dark:text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  المستخدمون المسجّلون ({users.length})
                </h3>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-3 py-2.5 text-right">المستخدم</th>
                    <th className="px-3 py-2.5 text-center">الدور الوظيفي</th>
                    <th className="px-3 py-2.5 text-center">النطاق</th>
                    <th className="px-3 py-2.5 text-center">الحالة</th>
                    <th className="px-3 py-2.5 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {users.map((u) => {
                    const govList =
                      u.governorateIds && u.governorateIds.length > 0
                        ? u.governorateIds
                        : u.governorateId
                          ? [u.governorateId]
                          : [];
                    const isSelf = profile?.uid === u.uid;

                    return (
                      <tr key={u.uid} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-900 dark:text-slate-100">
                            {u.displayName}
                            {isSelf && (
                              <span className="mr-1.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                (أنت)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                            {u.email}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <select
                            aria-label={`دور ${u.displayName}`}
                            value={u.role}
                            onChange={(e) => {
                              const nextRole = e.target.value as UserRole;
                              void updateUserRole(u.uid, nextRole, u.isActive, {
                                permissions: getDefaultGranularPermissions(nextRole),
                              });
                            }}
                            className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-xs"
                          >
                            {ALL_ROLES.map((role) => (
                              <option key={role} value={role}>
                                {ROLE_LABELS_AR[role]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2.5 text-center text-[11px] text-slate-600 dark:text-slate-300">
                          {formatGovSummary(u.role, govList)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => void updateUserRole(u.uid, u.role, !u.isActive)}
                            className={`rounded px-2.5 py-1 text-[11px] font-bold disabled:opacity-60 ${
                              u.isActive
                                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-900 dark:text-emerald-200'
                                : 'bg-rose-100 dark:bg-rose-900/50 text-rose-900 dark:text-rose-200'
                            }`}
                          >
                            {u.isActive ? '✔ نشط' : '⚠ معطل'}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditUserModal(u)}
                              aria-label={`تعديل ${u.displayName}`}
                              className="rounded border border-slate-300 dark:border-slate-600 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            {!isSelf && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: 'user',
                                    id: u.uid,
                                    displayName: u.displayName,
                                    email: u.email,
                                  })
                                }
                                aria-label={`حذف ${u.displayName}`}
                                className="rounded border border-rose-200 dark:border-rose-800 p-1.5 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pending Google Auth Invites */}
          {(authMode === 'firebase' || unclaimedInvites.length > 0) && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/60">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    دعوات الدخول المعلقة ({unclaimedInvites.length})
                  </h3>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  تُفعَّل تلقائيًا عند أول دخول بحساب Google
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-3 py-2.5 text-right">المدعو</th>
                      <th className="px-3 py-2.5 text-center">الدور الممنوح</th>
                      <th className="px-3 py-2.5 text-center">النطاق</th>
                      <th className="px-3 py-2.5 text-center">الحالة</th>
                      <th className="px-3 py-2.5 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {unclaimedInvites.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-5 text-center text-slate-500 dark:text-slate-400"
                        >
                          لا توجد دعوات معلقة حاليًا. استخدم «إضافة / دعوة مستخدم بالبريد» لمنح صلاحية لمستخدم جديد.
                        </td>
                      </tr>
                    ) : (
                      unclaimedInvites.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-slate-900 dark:text-slate-100">
                              {inv.displayName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-num">
                              {inv.email}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-center font-semibold text-slate-800 dark:text-slate-200">
                            {ROLE_LABELS_AR[inv.role]}
                          </td>
                          <td className="px-3 py-2.5 text-center text-[11px] text-slate-600 dark:text-slate-300">
                            {formatGovSummary(inv.role, inv.governorateIds || [])}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                                inv.isActive
                                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300'
                                  : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                              }`}
                            >
                              {inv.isActive ? '⏳ بانتظار الدخول' : '⚠ موقوفة'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditInviteModal(inv)}
                                aria-label={`تعديل دعوة ${inv.displayName}`}
                                className="rounded border border-slate-300 dark:border-slate-600 p-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: 'invite',
                                    id: inv.id,
                                    displayName: inv.displayName,
                                    email: inv.email,
                                  })
                                }
                                aria-label={`إلغاء دعوة ${inv.displayName}`}
                                className="rounded border border-rose-200 dark:border-rose-800 p-1.5 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* System Settings + Backup */}
        <div className="lg:col-span-5 space-y-5">
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3.5 text-xs"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <Settings className="w-4 h-4 text-emerald-800 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                إعدادات المنظومة والحسابات
              </h3>
            </div>

            <label className="block space-y-1">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                اسم الجهة / المؤسسة (يظهر في ترويسة التقارير)
              </span>
              <input
                type="text"
                value={organizationNameAr}
                onChange={(e) => setOrganizationNameAr(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
              <div>
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  اعتبر الخانة الفارغة صفرًا في الحسابات
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  معطّل افتراضيًا: تبقى الخلايا غير المسجلة فارغة ولا تدخل في احتساب المنصرف أو الفرق.
                </p>
              </div>
              <input
                type="checkbox"
                checked={treatEmptyAsZero}
                onChange={(e) => setTreatEmptyAsZero(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
              <div>
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  إلزام الرقم القومي للسائق
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  منع حفظ سجل الجرار دون إدخال الرقم القومي للسائق
                </p>
              </div>
              <input
                type="checkbox"
                checked={requireNationalId}
                onChange={(e) => setRequireNationalId(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
              <div>
                <p className="font-bold text-slate-900 dark:text-slate-100">
                  مزامنة تلقائية عند الاعتماد النهائي
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  إرسال التقرير تلقائيًا إلى المنظومة المركزية فور اعتماد رئيس القطاع
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="w-4 h-4 accent-emerald-700"
              />
            </label>

            <label className="block space-y-1">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                رابط واجهة التكامل المركزية (API)
              </span>
              <input
                type="url"
                value={centralApiUrl}
                onChange={(e) => setCentralApiUrl(e.target.value)}
                dir="ltr"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 font-mono-num text-left"
              />
            </label>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800"
            >
              <Save className="w-4 h-4" />
              حفظ إعدادات المنظومة
            </button>
          </form>

          {/* JSON Backup & Restore */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              النسخ الاحتياطي واستعادة البيانات (JSON)
            </h3>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
              تصدير نسخة كاملة من الجمعيات والتقارير والجرارات والإعدادات بصيغة JSON، أو استعادة نسخة سابقة مع التحقق من البنية.
            </p>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleRestoreFileSelected(file);
              }}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleExportBackup}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-700 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 px-3 py-2.5 font-bold text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
              >
                <Download className="w-4 h-4" />
                تصدير نسخة احتياطية
              </button>
              <button
                type="button"
                onClick={() => restoreInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <Upload className="w-4 h-4" />
                استعادة من ملف JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-800 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              سجل التدقيق الكامل (Audit Logs)
            </h3>
          </div>
          <input
            type="search"
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="تصفية السجل بالإجراء أو الاسم..."
            aria-label="تصفية سجل التدقيق"
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-1.5 text-xs sm:w-72"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                <th className="px-3 py-2.5 text-right">التوقيت</th>
                <th className="px-3 py-2.5 text-right">المستخدم والدور</th>
                <th className="px-3 py-2.5 text-right">الإجراء</th>
                <th className="px-3 py-2.5 text-right">التفاصيل والقيم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2.5 font-mono-num text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {log.createdAt.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {log.actorName}
                    </span>{' '}
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      ({ROLE_LABELS_AR[log.actorRole]})
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono-num font-semibold text-emerald-900 dark:text-emerald-300 whitespace-nowrap">
                    {log.action}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 space-y-1">
                    <div>{log.details}</div>
                    {(log.oldValue || log.newValue) && (
                      <div className="text-[11px] font-mono-num text-slate-500 dark:text-slate-400 break-all">
                        {log.oldValue ? `قبل: ${log.oldValue}` : ''}
                        {log.oldValue && log.newValue ? ' ← ' : ''}
                        {log.newValue ? `بعد: ${log.newValue}` : ''}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit User or Invite Modal */}
      {userForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <form
            onSubmit={(e) => void handleSubmitUserModal(e)}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 id="user-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                {userForm.uid
                  ? 'تعديل صلاحيات وبيانات المستخدم'
                  : userForm.inviteId
                    ? 'تعديل دعوة الدخول بالبريد'
                    : authMode === 'firebase'
                      ? 'دعوة وتفويض مستخدم جديد بالبريد الإلكتروني'
                      : 'إضافة مستخدم جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setUserForm(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {authMode === 'firebase' && !userForm.uid && (
              <p className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-[11px] text-emerald-900 dark:text-emerald-200">
                عند حفظ الدعوة، سيتمكن صاحب هذا البريد الإلكتروني من تسجيل الدخول عبر Google ويُربط تلقائيًا بالدور والمحافظات والصلاحيات المحددة أدناه.
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300">الاسم الكامل *</span>
                <input
                  type="text"
                  required
                  value={userForm.displayName}
                  onChange={(e) => setUserForm({ ...userForm, displayName: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                />
              </label>

              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  البريد الإلكتروني (Google) *
                </span>
                <input
                  type="email"
                  required
                  dir="ltr"
                  disabled={Boolean(userForm.uid || userForm.inviteId)}
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-left disabled:opacity-60"
                />
              </label>

              <label className="space-y-1">
                <span className="font-bold text-slate-700 dark:text-slate-300">الدور الوظيفي</span>
                <select
                  value={userForm.role}
                  onChange={(e) => {
                    const nextRole = e.target.value as UserRole;
                    setUserForm({
                      ...userForm,
                      role: nextRole,
                      permissions: getDefaultGranularPermissions(nextRole),
                    });
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS_AR[r]}
                    </option>
                  ))}
                </select>
              </label>

              {authMode === 'preview' && (
                <label className="space-y-1">
                  <span className="font-bold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
                    <KeyRound className="w-3.5 h-3.5" />
                    {userForm.uid ? 'كلمة مرور محلية جديدة (اختياري)' : 'كلمة مرور محلية (اختياري)'}
                  </span>
                  <input
                    type="password"
                    dir="ltr"
                    value={userForm.password}
                    onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                    placeholder={userForm.uid ? 'اتركه فارغًا دون تغيير' : 'لتسجيل الدخول المحلي'}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-left"
                  />
                </label>
              )}
            </div>

            {/* Granular Permissions */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-slate-100">الصلاحيات التفصيلية</span>
                <button
                  type="button"
                  onClick={() =>
                    setUserForm({
                      ...userForm,
                      permissions: getDefaultGranularPermissions(userForm.role),
                    })
                  }
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  استعادة افتراضي الدور
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PERMISSION_LABELS_AR.map(({ key, label }) => (
                  <label
                    key={key}
                    className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(userForm.permissions[key])}
                      onChange={(e) =>
                        setUserForm({
                          ...userForm,
                          permissions: { ...userForm.permissions, [key]: e.target.checked },
                        })
                      }
                      className="w-4 h-4 accent-emerald-700"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Governorate Scope */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  نطاق المحافظات المسموح بها (
                  {userForm.governorateIds.length === 0
                    ? userForm.role === 'admin' || userForm.role === 'chief'
                      ? 'كل المحافظات'
                      : 'لم يُحدد بعد'
                    : `${userForm.governorateIds.length} محددة`}
                  )
                </span>
                <div className="flex items-center gap-3">
                  {userForm.role === 'admin' || userForm.role === 'chief' ? (
                    <button
                      type="button"
                      onClick={() => setUserForm({ ...userForm, governorateIds: [] })}
                      className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                    >
                      كل المحافظات (نطاق شامل)
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setUserForm({
                            ...userForm,
                            governorateIds: governorates.map((g) => g.id),
                          })
                        }
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setUserForm({ ...userForm, governorateIds: [] })}
                        className="text-[11px] font-semibold text-slate-500 hover:underline"
                      >
                        مسح الاختيار
                      </button>
                    </>
                  )}
                </div>
              </div>
              {userForm.role !== 'admin' &&
                userForm.role !== 'chief' &&
                userForm.governorateIds.length === 0 && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 font-semibold">
                    ⚠ يجب تحديد محافظة واحدة على الأقل لهذا الدور؛ عدم تحديد محافظات يمنعه من الوصول لأي محافظة في قواعد الأمان.
                  </p>
                )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-40 overflow-y-auto p-1">
                {governorates.map((g) => {
                  const checked = userForm.governorateIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 cursor-pointer transition-colors ${
                        checked
                          ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 font-semibold'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...userForm.governorateIds, g.id]
                            : userForm.governorateIds.filter((id) => id !== g.id);
                          setUserForm({ ...userForm, governorateIds: next });
                        }}
                        className="w-3.5 h-3.5 accent-emerald-700"
                      />
                      <span className="truncate">{g.nameAr}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={userForm.isActive}
                onChange={(e) => setUserForm({ ...userForm, isActive: e.target.checked })}
                className="w-4 h-4 accent-emerald-700"
              />
              <span>الحساب نشط ويمكنه تسجيل الدخول</span>
            </label>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setUserForm(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 font-semibold text-slate-700 dark:text-slate-200"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingUser}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                <Check className="w-4 h-4" />
                {savingUser ? 'جارٍ الحفظ...' : userForm.uid || userForm.inviteId ? 'حفظ التعديلات' : 'حفظ وإتاحة الدخول'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'invite' ? 'تأكيد إلغاء الدعوة' : 'تأكيد حذف المستخدم'}
        message={`هل تريد ${deleteTarget?.kind === 'invite' ? 'إلغاء دعوة' : 'حذف حساب'} «${deleteTarget?.displayName || ''}» (${deleteTarget?.email || ''})؟ لا يمكن التراجع عن هذه الخطوة.`}
        confirmLabel={deleteTarget?.kind === 'invite' ? 'إلغاء الدعوة' : 'حذف الحساب'}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            void deleteUser(deleteTarget.id, deleteTarget.kind);
            setDeleteTarget(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingRestoreJson)}
        title="تأكيد استعادة النسخة الاحتياطية"
        message="سيتم دمج واستبدال البيانات الحالية بالبيانات الواردة في ملف النسخة الاحتياطية. هل أنت متأكد من المتابعة؟"
        confirmLabel="نعم، استعادة البيانات"
        variant="primary"
        onCancel={() => setPendingRestoreJson(null)}
        onConfirm={() => {
          if (pendingRestoreJson) {
            const raw = pendingRestoreJson;
            setPendingRestoreJson(null);
            void restoreBackupJson(raw).catch((err: unknown) => {
              pushToast({
                type: 'error',
                title: 'فشل استعادة النسخة',
                description: err instanceof Error ? err.message : 'تحقق من صحة الملف.',
              });
            });
          }
        }}
      />
    </div>
  );
};
