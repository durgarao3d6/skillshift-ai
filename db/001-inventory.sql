BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS import_batches (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), digest text NOT NULL,
 row_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,digest)
);
CREATE TABLE IF NOT EXISTS inventory_tasks (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 employee_external_id text NOT NULL, role_name text NOT NULL, task_external_id text NOT NULL,
 task_description text NOT NULL, skill_tags text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,employee_external_id,task_external_id)
);
CREATE INDEX IF NOT EXISTS inventory_tenant_idx ON inventory_tasks(tenant_id);
INSERT INTO tenants(id,name) VALUES ('11111111-1111-4111-8111-111111111111','Development workspace') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('001-inventory') ON CONFLICT DO NOTHING;
COMMIT;
