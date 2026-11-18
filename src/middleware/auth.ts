import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { permissions, rolePermissions, roles, userSessions, users } from '../db/schema.ts';
import { ensureSeedData } from '../db/seed.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

export const SESSION_COOKIE_NAME = 'ela_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface AuthenticatedUser {
  id: number;
  uid: string | null;
  username: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleNameAr: string;
  roleNameEn: string;
  isActive: boolean;
  permissions: string[];
}

export interface AuthRequest extends Request {
  currentUser?: AuthenticatedUser;
}

export function hashSessionToken(rawToken: string): string {
  const secret = process.env.SESSION_SECRET || 'ela-wms-session-hmac-fallback';
  return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function loadUserWithPermissions(userId: number): Promise<AuthenticatedUser | null> {
  const rows = await db
    .select({
      id: users.id,
      uid: users.uid,
      username: users.username,
      email: users.email,
      fullName: users.fullName,
      isActive: users.isActive,
      roleId: roles.id,
      roleCode: roles.code,
      roleNameAr: roles.nameAr,
      roleNameEn: roles.nameEn,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) return null;
  const userRow = rows[0];

  const permRows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, userRow.roleId));

  return {
    id: userRow.id,
    uid: userRow.uid,
    username: userRow.username,
    email: userRow.email,
    fullName: userRow.fullName,
    roleCode: userRow.roleCode,
    roleNameAr: userRow.roleNameAr,
    roleNameEn: userRow.roleNameEn,
    isActive: userRow.isActive,
    permissions: permRows.map((p) => p.code),
  };
}

export async function resolveUserFromDbSession(rawToken: string): Promise<AuthenticatedUser | null> {
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const sessions = await db
    .select({ userId: userSessions.userId })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (sessions.length === 0) return null;
  return loadUserWithPermissions(sessions[0].userId);
}

export async function resolveUserFromRequest(req: Request): Promise<{
  user: AuthenticatedUser | null;
  disabled?: boolean;
  invalidToken?: boolean;
}> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice('Bearer '.length).trim();
    if (bearerToken) {
      // Opaque 64-hex DB session token (no dots, unlike Firebase JWTs)
      if (!bearerToken.includes('.')) {
        const dbUser = await resolveUserFromDbSession(bearerToken);
        if (dbUser) {
          if (!dbUser.isActive) return { user: null, disabled: true };
          return { user: dbUser };
        }
        // If bearer DB token is invalid/expired, fall through to check cookie before failing
      } else {
        try {
          const decoded = await adminAuth.verifyIdToken(bearerToken);
          const matchingUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.uid, decoded.uid))
            .limit(1);

          let userId = matchingUsers[0]?.id;
          if (!userId && decoded.email) {
            const byEmail = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, decoded.email.toLowerCase()))
              .limit(1);
            if (byEmail[0]) {
              userId = byEmail[0].id;
              await db.update(users).set({ uid: decoded.uid }).where(eq(users.id, userId));
            }
          }

          if (!userId) {
            return { user: null, invalidToken: true };
          }

          const loaded = await loadUserWithPermissions(userId);
          if (!loaded || !loaded.isActive) {
            return { user: null, disabled: true };
          }
          return { user: loaded };
        } catch (err) {
          console.error('Firebase token verification failed:', err);
          return { user: null, invalidToken: true };
        }
      }
    }
  }

  const rawSession = req.cookies?.[SESSION_COOKIE_NAME];
  if (rawSession && typeof rawSession === 'string') {
    const loaded = await resolveUserFromDbSession(rawSession);
    if (!loaded) {
      return { user: null, invalidToken: true };
    }
    if (!loaded.isActive) {
      return { user: null, disabled: true };
    }
    return { user: loaded };
  }

  return { user: null };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureSeedData();
    const resolved = await resolveUserFromRequest(req);

    if (resolved.disabled) {
      return res.status(403).json({
        error: 'Account is disabled',
        errorAr: 'هذا الحساب موقوف، يرجى مراجعة مدير النظام',
      });
    }

    if (!resolved.user) {
      if (resolved.invalidToken) {
        return res.status(401).json({
          error: 'Session expired or invalid',
          errorAr: 'انتهت جلسة العمل، يرجى إعادة تسجيل الدخول',
        });
      }
      return res.status(401).json({
        error: 'Authentication required',
        errorAr: 'يجب تسجيل الدخول للوصول إلى هذه الخدمة',
      });
    }

    req.currentUser = resolved.user;
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication check failed',
      errorAr: 'حدث خطأ أثناء التحقق من الجلسة',
    });
  }
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res.status(401).json({
        error: 'Authentication required',
        errorAr: 'يجب تسجيل الدخول أولاً',
      });
    }
    if (!allowedRoles.includes(req.currentUser.roleCode)) {
      return res.status(403).json({
        error: 'Access denied: insufficient role permissions',
        errorAr: 'غير مصرح لك بالوصول إلى هذه الوظيفة',
      });
    }
    return next();
  };
};

export const requirePermission = (permissionCode: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.currentUser) {
      return res.status(401).json({
        error: 'Authentication required',
        errorAr: 'يجب تسجيل الدخول أولاً',
      });
    }
    if (!req.currentUser.permissions.includes(permissionCode)) {
      return res.status(403).json({
        error: `Access denied: missing permission ${permissionCode}`,
        errorAr: 'ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء',
      });
    }
    return next();
  };
};
