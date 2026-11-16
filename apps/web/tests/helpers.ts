import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { sessionSecret, Actor } from '../lib/server/core';
export const dbTests = process.env.RUN_DB_TESTS === 'true';
export const testSecret = 'integration-only-not-a-production-secret-123456789';
export async function fixture(issuer = 'urn:skillshift:test') {
  process.env.SESSION_SECRET = testSecret;
  process.env.SKILLSHIFT_DEMO_MODE = 'false';
  process.env.DELETION_HMAC_SECRET = testSecret;
  process.env.REQUESTS_PER_MINUTE = '10000';
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const tenantId = randomUUID();
  await admin.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [
    tenantId,
    'Synthetic integration ' + tenantId,
  ]);
  const users: Record<string, Actor> = {};
  for (const role of ['admin', 'hr', 'manager', 'employee', 'reviewer'] as const) {
    const userId = randomUUID();
    await admin.query(
      'INSERT INTO app_users(id,tenant_id,issuer,subject,display_name) VALUES($1,$2,$3,$4,$5)',
      [userId, tenantId, issuer, role, role + ' test'],
    );
    const employeeId = role === 'employee' ? 'EMP-TEST' : null;
    await admin.query(
      'INSERT INTO memberships(tenant_id,user_id,role,employee_external_id) VALUES($1,$2,$3,$4)',
      [tenantId, userId, role, employeeId],
    );
    users[role] = { tenantId, userId, role, employeeId, displayName: role + ' test' };
  }
  await admin.query('INSERT INTO tenant_policies(tenant_id) VALUES($1)', [tenantId]);
  await admin.query(
    'INSERT INTO manager_assignments(tenant_id,manager_user_id,employee_external_id) VALUES($1,$2,$3)',
    [tenantId, users.manager.userId, users.employee.employeeId],
  );
  async function request(
    role: string,
    path: string,
    method = 'GET',
    input?: unknown,
    extra?: Record<string, string>,
  ) {
    const actor = users[role];
    const sessionId = randomUUID();
    await admin.query(
      "INSERT INTO sessions(id,tenant_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sessionId, tenantId, actor.userId],
    );
    const token = await new SignJWT({ tid: tenantId, sid: sessionId })
      .setSubject(actor.userId)
      .setIssuer('skillshift')
      .setAudience('skillshift-web')
      .setIssuedAt()
      .setExpirationTime('1h')
      .setProtectedHeader({ alg: 'HS256' })
      .sign(sessionSecret());
    return new Request('http://localhost:3000' + path, {
      method,
      headers: {
        cookie: 'skillshift-session=' + token,
        origin: 'http://localhost:3000',
        'Content-Type': 'application/json',
        ...extra,
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  }
  return { admin, tenantId, users, request };
}
