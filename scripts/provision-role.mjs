// Run with schema-owner DATABASE_URL; APP_DATABASE_URL is used only by application/worker.
import pg from 'pg';
if (!process.env.DATABASE_URL || !process.env.APP_DATABASE_PASSWORD)
  throw new Error('DATABASE_URL and APP_DATABASE_PASSWORD required');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  if (!(await c.query("SELECT 1 FROM pg_roles WHERE rolname='skillshift_app'")).rowCount)
    await c.query(
      'CREATE ROLE skillshift_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE',
    );
  await c.query(
    'ALTER ROLE skillshift_app PASSWORD ' + pg.escapeLiteral(process.env.APP_DATABASE_PASSWORD),
  );
  await c.query('GRANT USAGE ON SCHEMA public TO skillshift_app');
  await c.query('GRANT SELECT ON tenants,skill_catalogue TO skillshift_app');
  const tables = [
    'assessment_reviews',
    'provider_health',
    'request_limits',
    'app_users',
    'memberships',
    'sessions',
    'manager_assignments',
    'inventory_tasks',
    'import_batches',
    'task_versions',
    'task_reviews',
    'role_map_reviews',
    'assessments',
    'role_skill_targets',
    'employee_skills',
    'learning_plans',
    'plan_revisions',
    'plan_activities',
    'plan_approvals',
    'cohort_members',
    'evidence',
    'jobs',
    'outbox_events',
    'token_budgets',
    'privacy_requests',
    'tenant_policies',
  ];
  for (const table of tables)
    await c.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO skillshift_app`);
  await c.query('GRANT SELECT,INSERT ON audit_events TO skillshift_app');
  console.log('Restricted application role provisioned.');
} finally {
  await c.end();
}
