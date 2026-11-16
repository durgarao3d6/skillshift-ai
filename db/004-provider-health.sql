BEGIN;
CREATE TABLE IF NOT EXISTS provider_health(tenant_id uuid PRIMARY KEY REFERENCES tenants(id),failures integer NOT NULL DEFAULT 0,open_until timestamptz);
ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_health FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON provider_health USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO schema_migrations(version) VALUES('004-provider-health');
COMMIT;
