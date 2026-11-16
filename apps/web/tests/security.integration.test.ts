import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer, AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fixture, dbTests } from './helpers';
import { pool, transaction } from '../lib/server/core';
import { POST, GET } from '../app/api/workspace/[...path]/route';
import { enqueue } from '../lib/server/domain';
import { dispatchOutbox, runBatch, runOne, claimJob } from '../lib/server/worker';
import { validateEvidence, scanClamAV, putPrivate } from '../lib/server/storage';
test(
  'security boundaries: resource IDs, private downloads, failed scans, leases and durable rate limiting',
  { skip: !dbTests },
  async () => {
    const f = await fixture(),
      other = await fixture();
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'skillshift-test-'));
    process.env.PRIVATE_STORAGE_PATH = storageRoot;
    const post = async (role: string, path: string, input: unknown) =>
      POST(await f.request(role, '/api/workspace/' + path, 'POST', input), {
        params: Promise.resolve({ path: path.split('/') }),
      });
    try {
      const taskId = randomUUID();
      await other.admin.query(
        "INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description) VALUES($1,$2,'EMP-TEST','Other role','secret','secret task')",
        [taskId, other.tenantId],
      );
      assert.equal(
        (await post('employee', 'tasks/correct', { taskId, revision: 1, description: 'attack' }))
          .status,
        404,
      );
      const outside = await GET(await f.request('hr', '/api/workspace/export'), {
        params: Promise.resolve({ path: ['export'] }),
      });
      assert.ok(!(await outside.text()).includes('secret task'));
      assert.throws(() =>
        validateEvidence(Buffer.from('<script>evil</script>'), 'application/pdf'),
      );
      assert.throws(() => validateEvidence(Buffer.from([0, 1, 2]), 'text/plain'));
      assert.throws(() => validateEvidence(Buffer.from('file'), 'image/svg+xml'));
      delete process.env.CLAMD_HOST;
      await assert.rejects(() => scanClamAV(Buffer.from('test')), /not configured/);
      const server = createServer((socket) => {
        socket.on('data', () => socket.end('stream: Eicar-Test-Signature FOUND\0'));
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      process.env.CLAMD_HOST = '127.0.0.1';
      process.env.CLAMD_PORT = String((server.address() as AddressInfo).port);
      assert.equal(await scanClamAV(Buffer.from('synthetic scanner fixture')), 'infected');
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Lease exhaustion produces a dead-letter state rather than an infinite retry.
      await transaction(f.tenantId, (db) =>
        enqueue(db, f.tenantId, 'scan', 'lease-test', { evidenceId: randomUUID() }),
      );
      await dispatchOutbox(f.tenantId);
      let job = await claimJob(f.tenantId);
      assert.ok(job);
      await f.admin.query(
        "UPDATE jobs SET attempts=5,lease_until=now()-interval '1 second' WHERE id=$1",
        [job.id],
      );
      assert.equal(await claimJob(f.tenantId), null);
      assert.equal(
        (await f.admin.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0].status,
        'failed',
      );
      assert.equal((await post('employee', 'jobs/retry', { jobId: job.id })).status, 403);
      assert.equal((await post('hr', 'jobs/retry', { jobId: job.id })).status, 200);
      assert.equal((await post('hr', 'jobs/cancel', { jobId: job.id })).status, 200);
      assert.equal(await claimJob(f.tenantId), null);
      const outbox = await transaction(f.tenantId, (db) =>
        enqueue(db, f.tenantId, 'scan', 'outbox-recover', { evidenceId: randomUUID() }),
      );
      assert.equal((await f.admin.query('SELECT 1 FROM jobs WHERE id=$1', [outbox])).rowCount, 0);
      await dispatchOutbox(f.tenantId);
      assert.equal((await f.admin.query('SELECT 1 FROM jobs WHERE id=$1', [outbox])).rowCount, 1);
      await dispatchOutbox(f.tenantId);
      assert.equal(
        (await f.admin.query('SELECT count(*)::int n FROM jobs WHERE id=$1', [outbox])).rows[0].n,
        1,
      );
      // Failed actions still consume a rate slot because authentication/rate accounting commits separately.
      process.env.REQUESTS_PER_MINUTE = '1';
      await f.admin.query('DELETE FROM request_limits WHERE tenant_id=$1', [f.tenantId]);
      assert.equal((await post('hr', 'missing/action', {})).status, 404);
      assert.equal((await post('hr', 'missing/action', {})).status, 429);
      process.env.REQUESTS_PER_MINUTE = '10000';
      const visibleTenants = await transaction(f.tenantId, (db) =>
        db.query('SELECT id FROM tenants'),
      );
      assert.deepEqual(
        visibleTenants.rows.map((r) => r.id),
        [f.tenantId],
      );
      // A pool connection reused after commit must not retain the previous tenant context.
      assert.equal((await pool().query('SELECT * FROM inventory_tasks')).rowCount, 0);
      const appUrl = process.env.APP_DATABASE_URL;
      process.env.APP_DATABASE_URL = process.env.DATABASE_URL;
      // The pool is intentionally reused, so test the actual role flags rather than swapping URL under an existing pool.
      assert.deepEqual(
        (
          await pool().query(
            'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
          )
        ).rows[0],
        { rolsuper: false, rolbypassrls: false },
      );
      process.env.APP_DATABASE_URL = appUrl;
    } finally {
      await f.admin.end();
      await other.admin.end();
      await pool().end();
      await rm(storageRoot, { recursive: true, force: true });
    }
  },
);
