import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { FirestoreRestError, fsRestGetDocument } from '../server/firestoreRest.ts';
import type { UserRole } from '../types/domain.ts';

export interface ActiveUserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  governorateIds: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
  idToken?: string;
  userProfile?: ActiveUserProfile;
}

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'غير مصرح: رمز التحقق (Bearer Token) مفقود.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'غير مصرح: رمز التحقق فارغ.' });
    return;
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (!decodedToken.email_verified) {
      res.status(403).json({ error: 'غير مصرح: البريد الإلكتروني غير موثق.' });
      return;
    }
    req.user = decodedToken;
    req.idToken = token;
    next();
  } catch (error) {
    console.error('Firebase ID token verification failed:', error);
    res.status(401).json({ error: 'غير مصرح: رمز الجلسة غير صالح أو منتهي الصلاحية.' });
  }
};

/**
 * Verifies the authenticated caller has an active `users/{uid}` profile in Firestore
 * (read via Firestore REST API using the caller's own ID token so firestore.rules applies)
 * and holds one of `allowedRoles`.
 */
export function requireActiveUser(allowedRoles: UserRole[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const uid = req.user?.uid;
    const idToken = req.idToken;
    if (!uid || !idToken) {
      res.status(401).json({ error: 'غير مصرح: جلسة المستخدم غير مكتملة.' });
      return;
    }

    try {
      const userDoc = await fsRestGetDocument(`users/${encodeURIComponent(uid)}`, idToken);
      if (!userDoc) {
        res.status(403).json({
          error: 'غير مصرح: حسابك غير مسجل في قائمة المستخدمين المعتمدين بالمنظومة.',
        });
        return;
      }

      const isActive = userDoc.isActive === true;
      const role = String(userDoc.role || '') as UserRole;
      if (!isActive) {
        res.status(403).json({
          error: 'غير مصرح: هذا الحساب معطّل حاليًا. يُرجى مراجعة مدير النظام.',
        });
        return;
      }

      if (!allowedRoles.includes(role)) {
        res.status(403).json({
          error: 'غير مصرح: دورك الوظيفي لا يملك صلاحية تنفيذ هذا الإجراء.',
        });
        return;
      }

      const govIds = Array.isArray(userDoc.governorateIds)
        ? userDoc.governorateIds.map((g) => String(g)).filter(Boolean)
        : typeof userDoc.governorateId === 'string' && userDoc.governorateId
          ? [userDoc.governorateId]
          : [];

      req.userProfile = {
        uid,
        email: String(userDoc.email || req.user?.email || '').toLowerCase(),
        displayName: String(userDoc.displayName || req.user?.name || 'مستخدم المنظومة'),
        role,
        isActive: true,
        governorateIds: govIds,
      };
      next();
    } catch (error: unknown) {
      if (error instanceof FirestoreRestError && (error.status === 401 || error.status === 403)) {
        res.status(403).json({
          error: 'غير مصرح: تعذر التحقق من ملف المستخدم وفق قواعد أمان Firestore.',
        });
        return;
      }
      console.error('requireActiveUser lookup failed:', error);
      res.status(503).json({
        error: 'تعذر التحقق من صلاحية المستخدم حاليًا. يُرجى المحاولة لاحقًا.',
      });
    }
  };
}
