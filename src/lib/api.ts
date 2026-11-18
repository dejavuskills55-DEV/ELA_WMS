import { auth } from './firebase.ts';
import type { Lang } from '../types/wms.ts';

const SESSION_STORAGE_KEY = 'ela_wms_session_token';
let inMemorySessionToken: string | null = null;

export function setSessionToken(token: string | null | undefined) {
  inMemorySessionToken = token || null;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Fallback to in-memory token if sessionStorage is restricted
  }
}

export function getSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      inMemorySessionToken = stored;
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function clearSessionToken() {
  setSessionToken(null);
}

export async function buildAuthHeaders(extra?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extra || {});
  if (!headers.has('Authorization')) {
    const sessionToken = getSessionToken();
    if (sessionToken) {
      headers.set('Authorization', `Bearer ${sessionToken}`);
    } else if (auth.currentUser) {
      try {
        const fbToken = await auth.currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${fbToken}`);
      } catch {
        // Fallback cleanly to HTTP-only session cookie
      }
    }
  }
  return headers;
}

export class ApiError extends Error {
  status: number;
  errorAr?: string;
  constructor(status: number, message: string, errorAr?: string) {
    super(message);
    this.status = status;
    this.errorAr = errorAr;
  }
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = await buildAuthHeaders(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let body: { error?: string; errorAr?: string } = {};
    try {
      body = await res.json();
    } catch {
      body = { error: res.statusText };
    }
    if (
      res.status === 401 &&
      !url.startsWith('/api/auth/login') &&
      !url.startsWith('/api/auth/setup') &&
      !url.startsWith('/api/auth/firebase-login') &&
      !url.startsWith('/api/auth/status')
    ) {
      clearSessionToken();
      window.dispatchEvent(new CustomEvent('ela:unauthorized'));
    }
    throw new ApiError(res.status, body.error || 'Request failed', body.errorAr);
  }

  return (await res.json()) as T;
}

export function getErrorMessage(err: unknown, lang: Lang): string {
  if (err instanceof ApiError) {
    if (lang === 'ar' && err.errorAr) return err.errorAr;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return lang === 'ar' ? 'حدث خطأ غير متوقع' : 'An unexpected error occurred';
}
