import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
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
    next();
  } catch (error) {
    console.error('Firebase ID token verification failed:', error);
    res.status(401).json({ error: 'غير مصرح: رمز الجلسة غير صالح أو منتهي الصلاحية.' });
  }
};
