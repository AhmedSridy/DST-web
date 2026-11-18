import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleAuthProvider, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { GranularPermissions, UserProfile, UserRole } from '../types/domain.ts';
import { computeInviteId } from '../utils/arabicNormalize.ts';
import { sha256Hex } from '../utils/crypto.ts';
import { loadSessionState, saveSessionState } from '../utils/offlineDb.ts';
import { getDefaultGranularPermissions } from '../utils/rbac.ts';

const BOOTSTRAP_ADMIN_EMAIL = 'ahmedsridy@gmail.com';
const UNAUTHORIZED_MSG =
  'حسابك غير مصرح له بالدخول إلى المنظومة. يرجى مراجعة مدير النظام لإضافة بريدك الإلكتروني أولًا.';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  authMode: 'firebase' | 'preview' | 'unauthenticated';
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  enterPreviewMode: (role?: UserRole) => Promise<void>;
  signInWithLocalCredentials: (email: string, password: string) => Promise<void>;
  switchPreviewRole: (role: UserRole) => Promise<void>;
  syncPreviewProfile: (updatedUser: UserProfile) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const PREVIEW_USERS: Record<UserRole, UserProfile> = {
  field_staff: {
    uid: 'demo-field-staff',
    email: 'field@dst-agri.eg',
    displayName: 'م. كريم طارق (موظف ميداني)',
    role: 'field_staff',
    governorateId: 'gov-ismailia',
    governorateIds: ['gov-ismailia'],
    permissions: getDefaultGranularPermissions('field_staff'),
    isActive: true,
  },
  supervisor: {
    uid: 'demo-supervisor',
    email: 'supervisor@dst-agri.eg',
    displayName: 'م. سحر عبد المنعم (مشرف)',
    role: 'supervisor',
    governorateId: 'gov-ismailia',
    governorateIds: ['gov-ismailia', 'gov-suez'],
    permissions: getDefaultGranularPermissions('supervisor'),
    isActive: true,
  },
  chief: {
    uid: 'demo-chief',
    email: 'chief@dst-agri.eg',
    displayName: 'د. طارق الغمراوي (رئيس القطاع)',
    role: 'chief',
    permissions: getDefaultGranularPermissions('chief'),
    isActive: true,
  },
  admin: {
    uid: 'demo-admin',
    email: 'admin@dst-agri.eg',
    displayName: 'م. علاء السريدي (مدير النظام)',
    role: 'admin',
    permissions: getDefaultGranularPermissions('admin'),
    isActive: true,
  },
  viewer: {
    uid: 'demo-viewer',
    email: 'viewer@dst-agri.eg',
    displayName: 'أ. نورهان حسام (مشاهد)',
    role: 'viewer',
    governorateId: 'gov-ismailia',
    governorateIds: ['gov-ismailia'],
    permissions: getDefaultGranularPermissions('viewer'),
    isActive: true,
  },
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'firebase' | 'preview' | 'unauthenticated'>('unauthenticated');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const syncFirebaseUserProfile = useCallback(async (user: User): Promise<UserProfile | null> => {
    const cleanEmail = (user.email || '').trim().toLowerCase();
    if (!cleanEmail || !user.emailVerified) {
      setAuthError('يجب توثيق البريد الإلكتروني على حساب Google قبل الدخول إلى المنظومة.');
      await signOut(auth);
      return null;
    }

    const displayName = user.displayName || cleanEmail.split('@')[0] || 'مستخدم المنظومة';
    const isBootstrapAdmin = cleanEmail === BOOTSTRAP_ADMIN_EMAIL && user.emailVerified;

    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (!data.isActive && !isBootstrapAdmin) {
          setAuthError('تم تعطيل هذا الحساب. يُرجى مراجعة مدير النظام.');
          await signOut(auth);
          return null;
        }
        const resolvedRole: UserRole = isBootstrapAdmin ? 'admin' : data.role;
        const resolvedPerms = data.permissions || getDefaultGranularPermissions(resolvedRole);
        if (isBootstrapAdmin && (data.role !== 'admin' || data.isActive !== true)) {
          await updateDoc(userRef, {
            role: 'admin',
            isActive: true,
            permissions: resolvedPerms,
            updatedAt: serverTimestamp(),
          }).catch(() => undefined);
        }
        return {
          ...data,
          uid: user.uid,
          email: cleanEmail,
          displayName: data.displayName || displayName,
          role: resolvedRole,
          governorateIds: Array.isArray(data.governorateIds) ? data.governorateIds : [],
          permissions: resolvedPerms,
          isActive: data.isActive !== false || isBootstrapAdmin,
        };
      }

      if (isBootstrapAdmin) {
        const created: UserProfile = {
          uid: user.uid,
          email: cleanEmail,
          displayName,
          role: 'admin',
          governorateIds: [],
          permissions: getDefaultGranularPermissions('admin'),
          isActive: true,
        };
        await setDoc(userRef, {
          ...created,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return created;
      }

      // Strictly invite-only onboarding for non-bootstrap users (no open registration!)
      const inviteId = computeInviteId(cleanEmail);
      const inviteRef = doc(db, 'user_invites', inviteId);
      let inviteSnap;
      try {
        inviteSnap = await getDoc(inviteRef);
      } catch {
        // Non-existent or unreadable invite fails closed cleanly
        setAuthError(UNAUTHORIZED_MSG);
        await signOut(auth);
        return null;
      }

      if (!inviteSnap.exists()) {
        setAuthError(UNAUTHORIZED_MSG);
        await signOut(auth);
        return null;
      }

      const invite = inviteSnap.data() as {
        email?: string;
        displayName?: string;
        role: UserRole;
        governorateId?: string;
        governorateIds?: string[];
        permissions?: GranularPermissions;
        isActive?: boolean;
        claimedUid?: string;
      };

      if (!invite.isActive || (invite.claimedUid && invite.claimedUid !== user.uid)) {
        setAuthError(UNAUTHORIZED_MSG);
        await signOut(auth);
        return null;
      }

      const claimedProfile: UserProfile = {
        uid: user.uid,
        email: cleanEmail,
        displayName: invite.displayName || displayName,
        role: invite.role,
        ...(invite.governorateId ? { governorateId: invite.governorateId } : {}),
        governorateIds: Array.isArray(invite.governorateIds) ? invite.governorateIds : [],
        permissions: invite.permissions || getDefaultGranularPermissions(invite.role),
        inviteId,
        isActive: true,
      };

      await runTransaction(db, async (tx) => {
        tx.set(userRef, {
          ...claimedProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tx.update(inviteRef, {
          claimedUid: user.uid,
          updatedAt: serverTimestamp(),
        });
      });

      return claimedProfile;
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      } catch {
        // Handled cleanly below
      }
      setAuthError(
        error instanceof Error && error.message.includes('PERMISSION_DENIED')
          ? UNAUTHORIZED_MSG
          : 'تعذر التحقق من صلاحية الحساب في Firestore. يرجى مراجعة مدير النظام أو التحقق من قواعد الأمان.',
      );
      await signOut(auth);
      return null;
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autoStart = params.get('autostart') === '1';

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const synced = await syncFirebaseUserProfile(user);
        if (!synced) {
          setFirebaseUser(null);
          setProfile(null);
          setAuthMode('unauthenticated');
          setLoading(false);
          return;
        }
        setFirebaseUser(user);
        setAuthMode('firebase');
        setProfile(synced);
        setLoading(false);
        return;
      }

      setFirebaseUser(null);
      if (autoStart) {
        const preview = PREVIEW_USERS.admin;
        setProfile(preview);
        setAuthMode('preview');
        await saveSessionState('previewRole', preview.role);
        await saveSessionState('previewUserProfile', preview);
        setLoading(false);
        return;
      }

      const savedProfile = await loadSessionState<UserProfile>('previewUserProfile');
      if (savedProfile && savedProfile.uid) {
        setProfile(savedProfile);
        setAuthMode('preview');
      } else {
        const savedPreviewRole = await loadSessionState<UserRole>('previewRole');
        if (savedPreviewRole && PREVIEW_USERS[savedPreviewRole]) {
          setProfile(PREVIEW_USERS[savedPreviewRole]);
          setAuthMode('preview');
        } else {
          setProfile(null);
          setAuthMode('unauthenticated');
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [syncFirebaseUserProfile]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
      await saveSessionState('previewRole', null);
      await saveSessionState('previewUserProfile', null);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'تعذر تسجيل الدخول عبر Google.';
      setAuthError(
        msg.includes('popup-closed')
          ? 'تم إغلاق نافذة تسجيل الدخول قبل إتمام العملية.'
          : 'تعذر إتمام تسجيل الدخول بحساب Google. يمكنك المحاولة مجددًا أو استخدام وضع المعاينة المحلية.',
      );
      setLoading(false);
    }
  };

  const enterPreviewMode = async (role: UserRole = 'admin') => {
    setAuthError(null);
    const chosen = PREVIEW_USERS[role] || PREVIEW_USERS.admin;
    setProfile(chosen);
    setAuthMode('preview');
    await saveSessionState('previewRole', role);
    await saveSessionState('previewUserProfile', chosen);
  };

  const signInWithLocalCredentials = async (email: string, password: string) => {
    setAuthError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setAuthError('يُرجى إدخال البريد الإلكتروني وكلمة المرور.');
      return;
    }

    const localUsers = (await loadSessionState<UserProfile[]>('localPreviewUsers')) || Object.values(PREVIEW_USERS);
    const matched = localUsers.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!matched) {
      setAuthError('لا يوجد مستخدم مسجل محليًا بهذا البريد الإلكتروني.');
      return;
    }
    if (!matched.isActive) {
      setAuthError('هذا الحساب معطّل حاليًا. يُرجى مراجعة مدير النظام.');
      return;
    }
    if (!matched.passwordHash) {
      setAuthError('لم يتم تعيين كلمة مرور محلية لهذا الحساب. سجّل الدخول عبر Google أو اطلب من المدير تعيين كلمة مرور.');
      return;
    }
    const candidateHash = await sha256Hex(password);
    if (candidateHash !== matched.passwordHash) {
      setAuthError('كلمة المرور غير صحيحة.');
      return;
    }

    const { passwordHash: _omit, ...safeProfile } = matched;
    setProfile(safeProfile);
    setAuthMode('preview');
    await saveSessionState('previewRole', safeProfile.role);
    await saveSessionState('previewUserProfile', safeProfile);
  };

  const switchPreviewRole = async (role: UserRole) => {
    if (authMode !== 'preview') return;
    const chosen = PREVIEW_USERS[role];
    setProfile(chosen);
    await saveSessionState('previewRole', role);
    await saveSessionState('previewUserProfile', chosen);
  };

  const syncPreviewProfile = async (updatedUser: UserProfile) => {
    if (authMode === 'preview' && profile?.uid === updatedUser.uid) {
      const { passwordHash: _omit, ...safe } = updatedUser;
      setProfile(safe);
      await saveSessionState('previewUserProfile', safe);
    }
  };

  const logout = async () => {
    setAuthError(null);
    if (authMode === 'firebase') {
      await signOut(auth);
    }
    await saveSessionState('previewRole', null);
    await saveSessionState('previewUserProfile', null);
    setProfile(null);
    setAuthMode('unauthenticated');
  };

  const getIdToken = async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        authMode,
        loading,
        authError,
        signInWithGoogle,
        enterPreviewMode,
        signInWithLocalCredentials,
        switchPreviewRole,
        syncPreviewProfile,
        logout,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
