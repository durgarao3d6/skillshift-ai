import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/imports/route';
import { GET } from '../app/api/inventory/route';
import { previewCsv } from '../lib/inventory';
import { transaction, pool, csvCell } from '../lib/server/core';
import { fixture, dbTests } from './helpers';
test(
  'authenticated imports are atomic, role-restricted, idempotent and tenant-isolated',
  { skip: !dbTests },
  async () => {
    const f = await fixture(),
      other = await fixture();
    const csv =
      'employee_external_id,role_name,task_external_id,task_description,skill_tags\nEMP-TEST,Engineer,t1,Write integration tests,testing';
    const changed = csv.replace('Write integration tests', 'Changed description');
    try {
      assert.equal(
        (await POST(await f.request('employee', '/api/imports', 'POST', { csv }))).status,
        403,
      );
      assert.equal(
        (
          await POST(
            await f.request(
              'hr',
              '/api/imports',
              'POST',
              { csv },
              { origin: 'https://other.test' },
            ),
          )
        ).status,
        403,
      );
      const preview = await (
        await POST(await f.request('hr', '/api/imports', 'POST', { csv }))
      ).json();
      assert.equal(preview.rowCount, 1);
      const invalid = csv + '\nEMP-TEST,,t2,Invalid role,';
      assert.equal(
        (
          await POST(
            await f.request('hr', '/api/imports', 'POST', {
              csv: invalid,
              confirm: true,
              digest: previewCsv(invalid).digest,
            }),
          )
        ).status,
        422,
      );
      assert.equal(
        await transaction(
          f.tenantId,
          async (db) =>
            (await db.query('SELECT count(*)::int AS n FROM inventory_tasks')).rows[0].n,
        ),
        0,
      );
      const responses = await Promise.all(
        [1, 2].map(async () =>
          POST(
            await f.request('hr', '/api/imports', 'POST', {
              csv,
              confirm: true,
              digest: preview.digest,
            }),
          ),
        ),
      );
      const results = await Promise.all(responses.map((r) => r.json()));
      assert.equal(results.filter((r) => r.duplicate).length, 1);
      assert.equal(
        results.reduce((n, r) => n + r.imported, 0),
        1,
      );
      const row = (await (await GET(await f.request('employee', '/api/inventory'))).json()).rows[0];
      assert.equal(row.task_description, 'Write integration tests');
      assert.equal(
        (
          await (
            await POST(
              await f.request('hr', '/api/imports', 'POST', {
                csv: changed,
                confirm: true,
                digest: previewCsv(changed).digest,
              }),
            )
          ).json()
        ).skipped,
        1,
      );
      assert.equal(
        (await (await GET(await other.request('hr', '/api/inventory'))).json()).rows.length,
        0,
      );
      const foreign = await transaction(other.tenantId, (db) =>
        db.query('SELECT * FROM inventory_tasks WHERE id=$1', [row.id]),
      );
      assert.equal(foreign.rowCount, 0);
      await assert.rejects(
        () =>
          transaction(other.tenantId, (db) =>
            db.query(
              'INSERT INTO employee_skills(tenant_id,employee_external_id,skill_id,self_level) VALUES($1,$2,$3,1)',
              [f.tenantId, 'EMP-TEST', 'testing'],
            ),
          ),
        /row-level security/,
      );
      await assert.rejects(
        () =>
          transaction(f.tenantId, (db) =>
            db.query("UPDATE task_versions SET description='tampered' WHERE task_id=$1", [row.id]),
          ),
        /immutable/,
      );
      assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
      // An actual database failure after inserting the import batch must roll back the batch and all rows.
      await f.admin.query(
        `CREATE FUNCTION fail_inventory_${f.tenantId.replaceAll('-', '')}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_external_id='FORCE-FAIL' THEN RAISE EXCEPTION 'test fault'; END IF; RETURN NEW; END $$`,
      );
      const fn = 'fail_inventory_' + f.tenantId.replaceAll('-', '');
      await f.admin.query(
        `CREATE TRIGGER ${fn} BEFORE INSERT ON inventory_tasks FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      const failed = csv.replace('t1', 'FORCE-FAIL');
      const response = await POST(
        await f.request('hr', '/api/imports', 'POST', {
          csv: failed,
          confirm: true,
          digest: previewCsv(failed).digest,
        }),
      );
      assert.equal(response.status, 503);
      assert.equal(
        (
          await f.admin.query('SELECT 1 FROM import_batches WHERE tenant_id=$1 AND digest=$2', [
            f.tenantId,
            previewCsv(failed).digest,
          ])
        ).rowCount,
        0,
      );
      await f.admin.query(`DROP TRIGGER ${fn} ON inventory_tasks`);
      await f.admin.query(`DROP FUNCTION ${fn}()`);
    } finally {
      await f.admin.end();
      await other.admin.end();
      await pool().end();
    }
  },
);
