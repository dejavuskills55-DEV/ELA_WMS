import bcrypt from 'bcryptjs';
import { count, eq, or } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import { roles, systemSettings, userSessions, users } from '../../db/schema.ts';
import { ensureSeedData } from '../../db/seed.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  type AuthRequest,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  generateSessionToken,
  hashSessionToken,
  loadUserWithPermissions,
  requireAuth,
  resolveUserFromRequest,
} from '../../middleware/auth.ts';
import { getClientIp, recordAuditLog } from '../audit.ts';

const router = Router();

const setupSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

function isHttpsRequest(req: import('express').Request): boolean {
  return (
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production'
  );
}

function setSessionCookie(
  req: import('express').Request,
  res: import('express').Response,
  rawToken: string,
) {
  const isHttps = isHttpsRequest(req);
  const options: import('express').CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    maxAge: SESSION_TTL_MS,
    path: '/',
  };
  if (isHttps) {
    options.partitioned = true;
  }
  res.cookie(SESSION_COOKIE_NAME, rawToken, options);
}

function clearSessionCookie(
  req: import('express').Request,
  res: import('express').Response,
) {
  const isHttps = isHttpsRequest(req);
  const options: import('express').CookieOptions & { partitioned?: boolean } = {
    httpOnly: true,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
  };
  if (isHttps) {
    options.partitioned = true;
  }
  res.clearCookie(SESSION_COOKIE_NAME, options);
}

async function createDbSession(userId: number, req: import('express').Request): Promise<string> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(userSessions).values({
    tokenHash,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || null,
    expiresAt,
  });

  return rawToken;
}

async function getSecurityConfig() {
  const rows = await db.select().from(systemSettings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    maxAttempts: Math.max(3, Number(map.get('max_login_attempts') || 5)),
    lockoutMinutes: Math.max(1, Number(map.get('lockout_minutes') || 15)),
  };
}

// Public status check: returns whether initial admin setup is needed and if user is signed in
router.get('/status', async (req: AuthRequest, res) => {
  try {
    await ensureSeedData();
    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    const resolved = await resolveUserFromRequest(req);
    const currentUser = resolved.user;

    res.json({
      needsInitialSetup: userCount === 0,
      authenticated: Boolean(currentUser),
      user: currentUser,
    });
  } catch (error) {
    console.error('Auth status failed:', error);
    res.status(500).json({ error: 'Failed to inspect auth status' });
  }
});

// One-time Initial Admin creation when database has 0 users
router.post('/setup', async (req, res) => {
  try {
    await ensureSeedData();
    const [{ value: userCount }] = await db.select({ value: count() }).from(users);
    if (userCount > 0) {
      return res.status(403).json({
        error: 'Initial setup has already been completed',
        errorAr: 'تم إتمام الإعداد الأولي للنظام بالفعل',
      });
    }

    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid setup details',
        errorAr: 'بيانات الإعداد غير صالحة (كلمة المرور 8 أحرف على الأقل)',
        details: parsed.error.flatten(),
      });
    }

    const [adminRole] = await db.select().from(roles).where(eq(roles.code, 'ADMIN')).limit(1);
    if (!adminRole) {
      return res.status(500).json({ error: 'ADMIN role missing' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [created] = await db
      .insert(users)
      .values({
        username: parsed.data.username.toLowerCase(),
        email: parsed.data.email.toLowerCase(),
        fullName: parsed.data.fullName,
        passwordHash,
        roleId: adminRole.id,
        isActive: true,
        lastLoginAt: new Date(),
      })
      .returning();

    const rawToken = await createDbSession(created.id, req);
    setSessionCookie(req, res, rawToken);

    await recordAuditLog({
      userId: created.id,
      username: created.username,
      action: 'INITIAL_ADMIN_SETUP',
      entity: 'users',
      entityId: created.id,
      newValue: { username: created.username, email: created.email, role: 'ADMIN' },
      ipAddress: getClientIp(req),
    });

    const user = await loadUserWithPermissions(created.id);
    return res.status(201).json({ user, sessionToken: rawToken });
  } catch (error) {
    console.error('Initial setup error:', error);
    return res.status(500).json({ error: 'Failed to complete initial setup' });
  }
});

// Username/Email + Password login with brute-force lockout protection
router.post('/login', async (req, res) => {
  try {
    await ensureSeedData();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Username/email and password are required',
        errorAr: 'اسم المستخدم وكلمة المرور مطلوبان',
      });
    }

    const identifier = parsed.data.identifier.toLowerCase();
    const matched = await db
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);

    const userRow = matched[0];
    if (!userRow || !userRow.passwordHash) {
      await recordAuditLog({
        username: identifier,
        action: 'LOGIN_FAILED',
        entity: 'auth',
        newValue: { reason: 'USER_NOT_FOUND' },
        ipAddress: getClientIp(req),
      });
      return res.status(401).json({
        error: 'Invalid credentials',
        errorAr: 'بيانات الدخول غير صحيحة',
      });
    }

    if (!userRow.isActive) {
      return res.status(403).json({
        error: 'This account has been deactivated',
        errorAr: 'تم إيقاف هذا الحساب، يرجى مراجعة مدير النظام',
      });
    }

    const now = new Date();
    if (userRow.lockedUntil && userRow.lockedUntil > now) {
      const remainingMin = Math.ceil((userRow.lockedUntil.getTime() - now.getTime()) / 60000);
      return res.status(429).json({
        error: `Account temporarily locked due to failed login attempts. Try again in ${remainingMin} minute(s).`,
        errorAr: `تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة. يرجى المحاولة بعد ${remainingMin} دقيقة.`,
      });
    }

    const validPassword = await bcrypt.compare(parsed.data.password, userRow.passwordHash);
    if (!validPassword) {
      const { maxAttempts, lockoutMinutes } = await getSecurityConfig();
      const nextAttempts = userRow.failedLoginAttempts + 1;
      const shouldLock = nextAttempts >= maxAttempts;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + lockoutMinutes * 60 * 1000)
        : null;

      await db
        .update(users)
        .set({
          failedLoginAttempts: nextAttempts,
          lockedUntil,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userRow.id));

      await recordAuditLog({
        userId: userRow.id,
        username: userRow.username,
        action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
        entity: 'auth',
        entityId: userRow.id,
        newValue: { attempts: nextAttempts, lockedUntil },
        ipAddress: getClientIp(req),
      });

      if (shouldLock) {
        return res.status(429).json({
          error: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`,
          errorAr: `تم تجاوز الحد الأقصى للمحاولات الفاشلة. تم قفل الحساب لمدة ${lockoutMinutes} دقيقة.`,
        });
      }

      return res.status(401).json({
        error: 'Invalid credentials',
        errorAr: 'اسم المستخدم أو كلمة المرور غير صحيحة',
      });
    }

    // Success: reset failed attempts, update lastLoginAt, create session
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userRow.id));

    const rawToken = await createDbSession(userRow.id, req);
    setSessionCookie(req, res, rawToken);

    await recordAuditLog({
      userId: userRow.id,
      username: userRow.username,
      action: 'LOGIN_SUCCESS',
      entity: 'auth',
      entityId: userRow.id,
      ipAddress: getClientIp(req),
    });

    const user = await loadUserWithPermissions(userRow.id);
    return res.json({ user, sessionToken: rawToken });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Google Sign-In via Firebase ID Token
router.post('/firebase-login', async (req, res) => {
  try {
    await ensureSeedData();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Firebase ID token' });
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || `${decoded.uid}@firebase.local`).toLowerCase();
    const displayName = decoded.name || email.split('@')[0];

    let existing = await db.select().from(users).where(eq(users.uid, decoded.uid)).limit(1);
    if (existing.length === 0 && decoded.email) {
      existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    }

    let userId: number;
    if (existing.length > 0) {
      userId = existing[0].id;
      if (!existing[0].isActive) {
        return res.status(403).json({
          error: 'Account is deactivated',
          errorAr: 'هذا الحساب موقوف، يرجى مراجعة مدير النظام',
        });
      }
      await db
        .update(users)
        .set({ uid: decoded.uid, lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      const [{ value: userCount }] = await db.select({ value: count() }).from(users);
      const targetRoleCode = userCount === 0 ? 'ADMIN' : 'MANAGER';
      const [roleRow] = await db.select().from(roles).where(eq(roles.code, targetRoleCode)).limit(1);
      if (!roleRow) {
        return res.status(500).json({ error: 'Default role not found' });
      }
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') || 'user';
      const uniqueUsername = `${baseUsername}_${decoded.uid.slice(0, 5).toLowerCase()}`;
      const [inserted] = await db
        .insert(users)
        .values({
          uid: decoded.uid,
          username: uniqueUsername,
          email,
          fullName: displayName,
          roleId: roleRow.id,
          isActive: true,
          lastLoginAt: new Date(),
        })
        .returning();
      userId = inserted.id;
    }

    const rawToken = await createDbSession(userId, req);
    setSessionCookie(req, res, rawToken);

    const loaded = await loadUserWithPermissions(userId);
    await recordAuditLog({
      userId,
      username: loaded?.username,
      action: 'FIREBASE_LOGIN_SUCCESS',
      entity: 'auth',
      entityId: userId,
      ipAddress: getClientIp(req),
    });

    return res.json({ user: loaded, sessionToken: rawToken });
  } catch (error) {
    console.error('Firebase login error:', error);
    return res.status(401).json({
      error: 'Firebase authentication failed',
      errorAr: 'فشلت المصادقة عبر جوجل',
    });
  }
});

router.post('/logout', async (req: AuthRequest, res) => {
  try {
    const tokensToRevoke: string[] = [];
    const rawCookieSession = req.cookies?.[SESSION_COOKIE_NAME];
    if (rawCookieSession && typeof rawCookieSession === 'string') {
      tokensToRevoke.push(rawCookieSession);
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice('Bearer '.length).trim();
      if (bearerToken && !bearerToken.includes('.')) {
        tokensToRevoke.push(bearerToken);
      }
    }

    for (const rawSession of new Set(tokensToRevoke)) {
      const tokenHash = hashSessionToken(rawSession);
      const rows = await db
        .select()
        .from(userSessions)
        .where(eq(userSessions.tokenHash, tokenHash))
        .limit(1);
      if (rows[0]) {
        await db
          .update(userSessions)
          .set({ revokedAt: new Date() })
          .where(eq(userSessions.id, rows[0].id));
        await recordAuditLog({
          userId: rows[0].userId,
          action: 'LOGOUT',
          entity: 'auth',
          entityId: rows[0].userId,
          ipAddress: getClientIp(req),
        });
      }
    }
    clearSessionCookie(req, res);
    res.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.currentUser });
});

export default router;
