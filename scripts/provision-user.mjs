import pg from 'pg';
import { randomUUID } from 'node:crypto';
const [tenant, issuer, subject, name, role, employeeId] = process.argv.slice(2);
if (
  !tenant ||
  !issuer ||
  !subject ||
  !name ||
  !['admin', 'hr', 'manager', 'employee', 'reviewer'].includes(role)
)
  throw new Error(
    'Usage: provision-user <tenant UUID> <OIDC issuer> <OIDC subject> <display name> <role> [employee ID]. Requires schema-owner DATABASE_URL.',
  );
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query('BEGIN');
  await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
  await c.query('INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    tenant,
    'Customer workspace',
  ]);
  const u = (
    await c.query(
      'INSERT INTO app_users(id,tenant_id,issuer,subject,display_name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id',
      [randomUUID(), tenant, issuer, subject, name],
    )
  ).rows[0];
  await c.query(
    'INSERT INTO memberships(tenant_id,user_id,role,employee_external_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role,employee_external_id=EXCLUDED.employee_external_id,active=true',
    [tenant, u.id, role, employeeId || null],
  );
  await c.query('INSERT INTO tenant_policies(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [
    tenant,
  ]);
  await c.query('COMMIT');
  console.log('Membership provisioned:', u.id);
} catch (e) {
  await c.query('ROLLBACK');
  throw e;
} finally {
  await c.end();
}
