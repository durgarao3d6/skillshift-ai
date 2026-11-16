import pg, { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';
import { z } from 'zod';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Role = 'admin' | 'hr' | 'manager' | 'employee' | 'reviewer';
export type Actor = {
  tenantId: string;
  userId: string;
  role: Role;
  employeeId: string | null;
  displayName: string;
};
export const demoTenant = '11111111-1111-4111-8111-111111111111';
export const demoUsers = {
  hr: '22222222-2222-4222-8222-222222222222',
  manager: '33333333-3333-4333-8333-333333333333',
  employee: '44444444-4444-4444-8444-444444444444',
  reviewer: '55555555-5555-4555-8555-555555555555',
  admin: '66666666-6666-4666-8666-666666666666',
};
const commitHooks = new WeakMap<PoolClient, (() => void)[]>();
export function onCommit(db: PoolClient, fn: () => void) {
  const hooks = commitHooks.get(db);
  if (!hooks) throw new Error('No transaction');
  hooks.push(fn);
}
const checkedConnections = new WeakSet<PoolClient>();
const rollbackHooks = new WeakMap<PoolClient, (() => Promise<void>)[]>();
export function onRollback(db: PoolClient, fn: () => Promise<void>) {
  const hooks = rollbackHooks.get(db);
  if (!hooks) throw new Error('No transaction');
  hooks.push(fn);
}
const globalPools = globalThis as unknown as { workflowPool?: Pool };
export function pool() {
  const url = process.env.APP_DATABASE_URL;
  if (!url) throw new HttpError(503, 'APP_DATABASE_URL must use the restricted application role.');
  const max = Number(process.env.DB_POOL_MAX || 5);
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new HttpError(503, 'DB_POOL_MAX must be 1–20.');
  return (globalPools.workflowPool ??= new Pool({
    connectionString: url,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  }));
}
export function demoMode() {
  return process.env.NODE_ENV !== 'production' && process.env.SKILLSHIFT_DEMO_MODE === 'true';
}
export function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    (process.env.NODE_ENV === 'production' && secret.startsWith('replace-'))
  )
    throw new HttpError(503, 'Configure a SESSION_SECRET with at least 32 characters.');
  return new TextEncoder().encode(secret);
}
export async function transaction<T>(
  tenantId: string,
  fn: (db: PoolClient) => Promise<T>,
  options: { ephemeral?: boolean } = {},
): Promise<T> {
  if (!z.uuid().safeParse(tenantId).success) throw new HttpError(400, 'Invalid tenant ID.');
  const db = await pool().connect();
  try {
    if (!checkedConnections.has(db)) {
      const role = await db.query(
        "SELECT r.rolsuper,r.rolbypassrls,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') AND c.relowner=r.oid) AS owns_domain FROM pg_roles r WHERE r.rolname=current_user",
      );
      if (role.rows[0]?.rolsuper || role.rows[0]?.rolbypassrls || role.rows[0]?.owns_domain)
        throw new HttpError(
          503,
          'Application credentials must not bypass row-level security or own domain tables.',
        );
      checkedConnections.add(db);
    }
    await db.query(
      "BEGIN; SELECT set_config('app.tenant_id'," +
        pg.escapeLiteral(tenantId) +
        ",true); SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s'; SET LOCAL synchronous_commit='" +
        (options.ephemeral ? 'off' : 'on') +
        "'",
    );
    rollbackHooks.set(db, []);
    commitHooks.set(db, []);
    const result = await fn(db);
    await db.query('COMMIT');
    for (const committed of commitHooks.get(db) || []) committed();
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    for (const undo of rollbackHooks.get(db) || []) {
      try {
        await undo();
      } catch {
        console.error(JSON.stringify({ event: 'rollback_compensation_failed' }));
      }
    }
    throw error;
  } finally {
    rollbackHooks.delete(db);
    commitHooks.delete(db);
    db.release();
  }
}
export function cookies(req: Request) {
  const result: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const key = part.slice(0, i).trim();
    try {
      result[key] = decodeURIComponent(part.slice(i + 1));
    } catch {
      result[key] = '';
    }
  }
  return result;
}

export async function identity(req: Request) {
  if (demoMode()) {
    const name = req.headers.get('x-demo-user') || 'hr';
    if (!(name in demoUsers)) throw new HttpError(401, 'Unknown development persona.');
    return {
      tenantId: demoTenant,
      userId: demoUsers[name as keyof typeof demoUsers],
      sessionId: null,
    };
  }
  const token = cookies(req)['skillshift-session'];
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), {
      algorithms: ['HS256'],
      issuer: 'skillshift',
      audience: 'skillshift-web',
      requiredClaims: ['exp', 'iat', 'sub', 'tid', 'sid'],
    });
    return {
      tenantId: z.uuid().parse(payload.tid),
      userId: z.uuid().parse(payload.sub),
      sessionId: z.uuid().parse(payload.sid),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, 'Your session has expired. Sign in again.');
  }
}
export function assertOrigin(req: Request) {
  const expected = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : new URL(req.url).origin;
  if (req.headers.get('origin') !== expected) throw new HttpError(403, 'Invalid request origin.');
}
export async function withActor<T>(req: Request, fn: (db: PoolClient, actor: Actor) => Promise<T>) {
  if (!['GET', 'HEAD'].includes(req.method)) assertOrigin(req);
  const claims = await identity(req);
  const actor = await transaction(
    claims.tenantId,
    async (db) => {
      const member = (
        await db.query(
          `WITH member AS (
 SELECT m.*,u.display_name FROM memberships m JOIN app_users u ON u.id=m.user_id LEFT JOIN sessions s ON s.id=$2 AND s.user_id=m.user_id WHERE m.user_id=$1 AND m.active=true AND ($2::uuid IS NULL OR s.expires_at>now())
 ), rate AS (
 INSERT INTO request_limits(tenant_id,user_id,bucket) SELECT tenant_id,user_id,$3 FROM member ON CONFLICT(tenant_id,user_id,bucket) DO UPDATE SET requests=request_limits.requests+1 RETURNING requests
 ) SELECT member.*,rate.requests FROM member CROSS JOIN rate`,
          [claims.userId, claims.sessionId, Math.floor(Date.now() / 60000)],
        )
      ).rows[0];
      if (!member)
        throw new HttpError(
          claims.sessionId ? 401 : 403,
          'Session expired or membership is inactive.',
        );
      const actor: Actor = {
        tenantId: claims.tenantId,
        userId: member.user_id,
        role: member.role,
        employeeId: member.employee_external_id,
        displayName: member.display_name,
      };
      const limit = Number(process.env.REQUESTS_PER_MINUTE || 120);
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new HttpError(503, 'Invalid request rate configuration.');
      if (member.requests > limit)
        throw new HttpError(429, 'Request limit reached. Retry in a minute.');
      return actor;
    },
    { ephemeral: true },
  ); // Only short-lived rate counters are written here; domain writes remain synchronous.
  return transaction(claims.tenantId, (db) => fn(db, actor));
}
export function roles(actor: Actor, ...allowed: Role[]) {
  if (!allowed.includes(actor.role))
    throw new HttpError(403, 'This action is not available for your role.');
}
export async function accessEmployee(
  db: PoolClient,
  actor: Actor,
  employeeId: string,
  opts: { self?: boolean; admin?: boolean } = { self: true, admin: true },
) {
  if (opts.self !== false && actor.employeeId === employeeId) return;
  if (opts.admin !== false && ['admin', 'hr'].includes(actor.role)) return;
  if (
    actor.role === 'manager' &&
    (
      await db.query(
        'SELECT 1 FROM manager_assignments WHERE manager_user_id=$1 AND employee_external_id=$2',
        [actor.userId, employeeId],
      )
    ).rowCount
  )
    return;
  throw new HttpError(404, 'Employee resource not found.');
}
export async function assignedManager(db: PoolClient, actor: Actor, employeeId: string) {
  if (actor.employeeId === employeeId)
    throw new HttpError(403, 'You cannot approve your own work.');
  if (
    !(
      await db.query(
        'SELECT 1 FROM manager_assignments WHERE manager_user_id=$1 AND employee_external_id=$2',
        [actor.userId, employeeId],
      )
    ).rowCount
  )
    throw new HttpError(403, 'Only an assigned manager can approve this resource.');
}
export async function audit(
  db: PoolClient,
  actor: Actor | null,
  tenantId: string,
  action: string,
  resourceId: string,
) {
  await db.query(
    'INSERT INTO audit_events(id,tenant_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), tenantId, actor?.userId || null, action, resourceId],
  );
}
export async function body(req: Request, max = 1024 * 1024) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body is required.');
  let n = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  try {
    const response = await fn();
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Request-ID', requestId);
    return response;
  } catch (error) {
    const status =
      error instanceof HttpError ? error.status : error instanceof z.ZodError ? 422 : 503;
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : 'Service unavailable. Retry or contact your administrator.';
    if (status === 503)
      console.error(
        JSON.stringify({
          event: 'request_failed',
          requestId,
          errorType: error instanceof Error ? error.name : 'unknown',
        }),
      );
    return Response.json(
      { error: message, requestId },
      { status, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } },
    );
  }
}
export function csvCell(value: unknown) {
  const s = String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replaceAll('"', '""') + '"';
}
