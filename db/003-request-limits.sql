BEGIN;
CREATE TABLE IF NOT EXISTS request_limits(tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL,bucket bigint NOT NULL,requests integer NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,user_id,bucket));
ALTER TABLE request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request_limits USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
INSERT INTO schema_migrations(version) VALUES('003-request-limits');
COMMIT;
