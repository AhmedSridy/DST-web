import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Clock,
  FileSearch,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Shield,
  Sprout,
  Sun,
  TrendingDown,
  Truck,
  Warehouse,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { AppDataProvider, useAppData } from './context/AppDataContext.tsx';
import { getTodayDateIso } from './data/seedData.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { LoginView } from './components/LoginView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { DailyDisbursementSheet } from './components/DailyDisbursementSheet.tsx';
import { BalancesView } from './components/BalancesView.tsx';
import { AnalyticsModal, type AnalyticsTabId } from './components/AnalyticsModal.tsx';
import { AiImageAnalysisView } from './components/AiImageAnalysisView.tsx';
import { TractorsView } from './components/TractorsView.tsx';
import { AssociationsManagerView } from './components/AssociationsManagerView.tsx';
import { ApprovalsAndCentralView } from './components/ApprovalsAndCentralView.tsx';
import { ReportsCenterView } from './components/ReportsCenterView.tsx';
import { AdminAndAuditView } from './components/AdminAndAuditView.tsx';
import { ArabicUserGuideView } from './components/ArabicUserGuideView.tsx';
import { OfflineStatusBar, PWAInstallButton } from './components/PwaControls.tsx';
import { ToastContainer } from './components/ToastContainer.tsx';
import type { GranularPermissions, UserRole } from './types/domain.ts';
import { computeLowBalanceAlerts, computeOverdueReport } from './utils/analytics.ts';
import {
  getVisibleGovernorates,
  hasGranularAccess,
  hasPermission,
  ROLE_LABELS_AR,
} from './utils/rbac.ts';

interface NavItem {
  id: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  permission: string;
  granularFlag?: keyof GranularPermissions;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة المؤشرات', icon: LayoutDashboard, permission: 'view_dashboard' },
  { id: 'sheet', label: 'كشف الصرف اليومي', icon: ClipboardList, permission: 'view_dashboard' },
  {
    id: 'balances',
    label: 'الأرصدة',
    icon: Warehouse,
    permission: 'view_dashboard',
    granularFlag: 'canViewBalances',
  },
  { id: 'tractors', label: 'الجرارات والبوليصات', icon: Truck, permission: 'view_dashboard' },
  {
    id: 'ai_analysis',
    label: 'تحليل صور الكشوف',
    icon: FileSearch,
    permission: 'use_ocr',
    granularFlag: 'canEdit',
  },
  {
    id: 'associations',
    label: 'الجمعيات والمراكز',
    icon: Building2,
    permission: 'view_dashboard',
  },
  { id: 'approvals', label: 'الاعتمادات والربط', icon: CheckSquare, permission: 'view_dashboard' },
  { id: 'reports', label: 'مركز التقارير', icon: BarChart3, permission: 'view_reports' },
  { id: 'admin', label: 'الإدارة والتدقيق', icon: Shield, permission: 'manage_users' },
  { id: 'guide', label: 'دليل الاستخدام', icon: BookOpen, permission: 'view_guide' },
];

const WorkspaceShell: React.FC = () => {
  const { profile, authMode, loading, switchPreviewRole, logout } = useAuth();
  const {
    governorates,
    associations,
    reports,
    disbursements,
    settings,
    offlineQueue,
    isSyncing,
    syncNow,
    toasts,
    dismissToast,
    theme,
    toggleTheme,
  } = useAppData();

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [assocInitialGovId, setAssocInitialGovId] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsInitialTab, setAnalyticsInitialTab] = useState<AnalyticsTabId>('overdue');

  // Debounce home alert calculations (250ms) to avoid jitter during rapid input
  const [debouncedSignals, setDebouncedSignals] = useState({
    overdueCurrentGovCount: 0,
    lowBalanceCount: 0,
  });

  const visibleGovernorates = useMemo(
    () => getVisibleGovernorates(profile, governorates),
    [governorates, profile],
  );
  const primaryGovId = visibleGovernorates[0]?.id || 'gov-ismailia';
  const canViewAnalytics = hasGranularAccess(profile, 'canViewAnalytics');

  useEffect(() => {
    if (!canViewAnalytics || !profile) return;
    const handle = window.setTimeout(() => {
      const today = getTodayDateIso();
      const overdue = computeOverdueReport({
        governorates: visibleGovernorates,
        associations,
        disbursements,
        selectedDate: today,
        currentGovernorateId: primaryGovId,
      });
      const currentGovOverdue =
        overdue.find((g) => g.governorateId === primaryGovId)?.overdueCount ?? 0;

      const lowBal = computeLowBalanceAlerts({
        governorates: visibleGovernorates,
        associations,
        reports,
        disbursements,
        upToDate: today,
        minThresholds: settings.minThresholds || { urea: null, nitrate: null, sulfate: null },
        assocMinThresholds: settings.assocMinThresholds,
        maxRows: 200,
      });

      setDebouncedSignals({
        overdueCurrentGovCount: currentGovOverdue,
        lowBalanceCount: lowBal.totalCount,
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [
    associations,
    canViewAnalytics,
    disbursements,
    primaryGovId,
    profile,
    reports,
    settings.assocMinThresholds,
    settings.minThresholds,
    visibleGovernorates,
  ]);

  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (!hasPermission(profile?.role, item.permission)) return false;
        if (item.granularFlag && !hasGranularAccess(profile, item.granularFlag)) return false;
        return true;
      }),
    [profile],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-2">
          <Sprout className="w-8 h-8 text-emerald-700 mx-auto animate-pulse" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            جارٍ تهيئة منظومة DST...
          </p>
        </div>
      </div>
    );
  }

  if (!profile || authMode === 'unauthenticated') {
    return <LoginView />;
  }

  const activeNav = visibleNavItems.find((n) => n.id === activeTab) || visibleNavItems[0];

  const openAnalyticsTab = (tab: AnalyticsTabId) => {
    setAnalyticsInitialTab(tab);
    setAnalyticsOpen(true);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="no-print sticky top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 lg:px-6 h-16 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="فتح القائمة"
            className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-800 text-white flex items-center justify-center shrink-0">
              <Sprout className="w-5 h-5" />
            </div>
            <span className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 truncate whitespace-nowrap">
              منظومة DST للأسمدة الزراعية
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Home Alert Signals & Analytics Button */}
          {canViewAnalytics && (
            <div className="hidden xl:flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openAnalyticsTab('overdue')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  debouncedSignals.overdueCurrentGovCount > 0
                    ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 hover:bg-amber-100'
                    : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                }`}
              >
                {debouncedSignals.overdueCurrentGovCount > 0 ? (
                  <>
                    <Clock className="w-3.5 h-3.5" />
                    <span>⏰ لم تُسجَّل في هذه المحافظة: {debouncedSignals.overdueCurrentGovCount}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>✔️ لا توجد تنبيهات</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => openAnalyticsTab('thresholds')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  debouncedSignals.lowBalanceCount > 0
                    ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 hover:bg-rose-100'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                <span>📉 أرصدة منخفضة: {debouncedSignals.lowBalanceCount}</span>
              </button>
            </div>
          )}

          {canViewAnalytics && (
            <button
              type="button"
              onClick={() => openAnalyticsTab('overdue')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
            >
              <span>📊 المتابعة والتحليل</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
            title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
            className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          <PWAInstallButton />

          {authMode === 'preview' && (
            <select
              aria-label="تبديل الدور في المعاينة"
              value={profile.role}
              onChange={(e) => {
                const nextRole = e.target.value as UserRole;
                void switchPreviewRole(nextRole);
                if (nextRole !== 'admin' && activeTab === 'admin') {
                  setActiveTab('dashboard');
                }
              }}
              className="hidden sm:block w-auto rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:border-emerald-600 focus:outline-none"
            >
              {(['field_staff', 'supervisor', 'chief', 'admin', 'viewer'] as UserRole[]).map((role) => (
                <option key={role} value={role}>
                  معاينة: {ROLE_LABELS_AR[role]}
                </option>
              ))}
            </select>
          )}

          <div className="hidden md:flex flex-col items-end text-xs leading-tight">
            <span className="font-bold text-slate-900 dark:text-slate-100">{profile.displayName}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{ROLE_LABELS_AR[profile.role]}</span>
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            aria-label="تسجيل الخروج"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </div>
      </header>

      <OfflineStatusBar
        pendingCount={offlineQueue.length}
        isSyncing={isSyncing}
        onSyncNow={() => void syncNow()}
      />

      <div className="flex-1 flex">
        {/* Desktop Sidebar */}
        <aside className="no-print hidden lg:flex w-64 shrink-0 flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 p-4 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav?.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="no-print fixed inset-0 z-40 lg:hidden flex">
            <div className="w-72 bg-white dark:bg-slate-900 h-full border-l border-slate-200 dark:border-slate-800 p-4 space-y-1 shadow-xl overflow-y-auto">
              <div className="pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{profile.displayName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{ROLE_LABELS_AR[profile.role]}</p>
              </div>
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-semibold ${
                      active
                        ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label="إغلاق القائمة"
              onClick={() => setMobileMenuOpen(false)}
              className="flex-1 bg-slate-900/40"
            />
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-[1440px]">
          {activeNav?.id === 'dashboard' && <DashboardView onNavigate={setActiveTab} />}
          {activeNav?.id === 'sheet' && (
            <DailyDisbursementSheet
              onManageAssociations={(govId) => {
                setAssocInitialGovId(govId);
                setActiveTab('associations');
              }}
            />
          )}
          {activeNav?.id === 'balances' && <BalancesView />}
          {activeNav?.id === 'tractors' && <TractorsView />}
          {activeNav?.id === 'ai_analysis' && <AiImageAnalysisView />}
          {activeNav?.id === 'associations' && (
            <AssociationsManagerView initialGovId={assocInitialGovId} />
          )}
          {activeNav?.id === 'approvals' && <ApprovalsAndCentralView />}
          {activeNav?.id === 'reports' && <ReportsCenterView />}
          {activeNav?.id === 'admin' && <AdminAndAuditView />}
          {activeNav?.id === 'guide' && <ArabicUserGuideView />}
        </main>
      </div>

      <AnalyticsModal
        open={analyticsOpen}
        initialTab={analyticsInitialTab}
        activeGovernorateId={primaryGovId}
        onClose={() => setAnalyticsOpen(false)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppDataProvider>
          <WorkspaceShell />
        </AppDataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
