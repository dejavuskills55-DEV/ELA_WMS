import type { Request } from 'express';
import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'tokenHash',
  'token_hash',
  'secret',
  'authorization',
]);

function sanitizeRecord(val: unknown): unknown {
  if (!val || typeof val !== 'object') return val;
  if (Array.isArray(val)) return val.map(sanitizeRecord);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) continue;
    out[k] = sanitizeRecord(v);
  }
  return out;
}

export function getClientIp(req?: Request): string | null {
  if (!req) return null;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

export interface AuditInput {
  userId?: number | null;
  username?: string | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

export async function recordAuditLog(input: AuditInput, executor: typeof db = db): Promise<void> {
  try {
    await executor.insert(auditLogs).values({
      userId: input.userId ?? null,
      username: input.username ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId != null ? String(input.entityId) : null,
      previousValue: input.previousValue !== undefined ? sanitizeRecord(input.previousValue) : null,
      newValue: input.newValue !== undefined ? sanitizeRecord(input.newValue) : null,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
