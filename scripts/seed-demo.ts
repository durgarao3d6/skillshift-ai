import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { demoTenant, demoUsers } from '../apps/web/lib/server/core';
if (process.env.NODE_ENV === 'production' || process.env.SKILLSHIFT_DEMO_MODE !== 'true')
  throw new Error('Demo seed requires a non-production environment and SKILLSHIFT_DEMO_MODE=true.');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  await c.query('BEGIN');
  await c.query("SELECT set_config('app.tenant_id',$1,true)", [demoTenant]);
  await c.query('INSERT INTO tenants(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    demoTenant,
    'Synthetic design-partner workspace',
  ]);
  const users = [
    ...Object.entries(demoUsers).map(([role, id]) => ({
      id,
      role,
      employeeId: role === 'employee' ? 'EMP-001' : role === 'manager' ? 'MGR-001' : null,
      name: role === 'employee' ? 'Alex · Sample employee' : role + ' · Development',
    })),
    ...['002', '003', '004', '005'].map((n, i) => ({
      id: `77777777-7777-4777-8777-${String(i + 1).padStart(12, '0')}`,
      role: 'employee',
      employeeId: 'EMP-' + n,
      name: 'Sample employee ' + n,
    })),
  ];
  for (const u of users) {
    await c.query(
      "INSERT INTO app_users(id,tenant_id,issuer,subject,display_name) VALUES($1,$2,'urn:skillshift:demo',$3,$4) ON CONFLICT DO NOTHING",
      [u.id, demoTenant, u.role + ':' + u.id, u.name],
    );
    await c.query(
      'INSERT INTO memberships(tenant_id,user_id,role,employee_external_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [demoTenant, u.id, u.role, u.employeeId],
    );
  }
  const roles = [
    ['Software engineer', 'typescript', 'Review code changes and document the design rationale.'],
    [
      'Support specialist',
      'problem-solving',
      'Investigate a customer issue using synthetic support logs.',
    ],
    ['Data analyst', 'sql', 'Validate a synthetic dataset and explain query results.'],
    ['Product manager', 'communication', 'Explain a roadmap trade-off to stakeholders.'],
    ['UX designer', 'accessibility', 'Review a prototype for keyboard and labelling issues.'],
  ];
  for (const [i, [name, skill, description]] of roles.entries()) {
    const employeeId = 'EMP-' + String(i + 1).padStart(3, '0');
    await c.query(
      'INSERT INTO manager_assignments(tenant_id,manager_user_id,employee_external_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [demoTenant, demoUsers.manager, employeeId],
    );
    const task = (
      await c.query(
        'INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description,skill_tags) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,employee_external_id,task_external_id) DO NOTHING RETURNING *',
        [randomUUID(), demoTenant, employeeId, name, 'DEMO-' + i, description, [skill]],
      )
    ).rows[0];
    if (task)
      await c.query(
        'INSERT INTO task_versions(tenant_id,task_id,revision,description,role_name,skill_tags) VALUES($1,$2,1,$3,$4,$5)',
        [demoTenant, task.id, description, name, [skill]],
      );
    await c.query(
      'INSERT INTO role_skill_targets(tenant_id,role_name,skill_id,target_level) VALUES($1,$2,$3,2) ON CONFLICT DO NOTHING',
      [demoTenant, name, skill],
    );
  }
  await c.query('INSERT INTO tenant_policies(tenant_id) VALUES($1) ON CONFLICT DO NOTHING', [
    demoTenant,
  ]);
  await c.query('COMMIT');
  console.log('Seeded five synthetic roles, independent manager and employee personas.');
} catch (error) {
  await c.query('ROLLBACK');
  throw error;
} finally {
  await c.end();
}
