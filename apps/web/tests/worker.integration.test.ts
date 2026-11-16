import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { fixture, dbTests } from './helpers';
import { pool, transaction } from '../lib/server/core';
import { enqueue } from '../lib/server/domain';
import { runBatch } from '../lib/server/worker';
test(
  'provider outages retry, open a circuit and preserve manual fallback; quotas fail closed',
  { skip: !dbTests },
  async () => {
    const f = await fixture();
    let calls = 0,
      fail = true;
    const server = createServer((req, res) => {
      calls++;
      res.setHeader('Content-Type', 'application/json');
      if (fail) {
        res.statusCode = 500;
        res.end('{}');
      } else
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: 'assist',
                    confidence: 'medium',
                    rationale: 'Human review is needed for task correctness.',
                  }),
                },
              },
            ],
          }),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    Object.assign(process.env, {
      OPENAI_BASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
      OPENAI_API_KEY: 'synthetic-key',
      OPENAI_MODEL: 'synthetic-model',
      AI_DATA_PROCESSING_APPROVED: 'true',
      DAILY_TOKEN_BUDGET: '100000',
    });
    async function makeTask() {
      const taskId = randomUUID();
      await f.admin.query(
        "INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description,review_state) VALUES($1,$2,'EMP-TEST','Engineer',$3,'Explain tests','accepted')",
        [taskId, f.tenantId, taskId],
      );
      await f.admin.query(
        "INSERT INTO task_versions(tenant_id,task_id,revision,description,role_name,skill_tags) VALUES($1,$2,1,'Explain tests','Engineer','{}')",
        [f.tenantId, taskId],
      );
      await transaction(f.tenantId, (db) =>
        enqueue(db, f.tenantId, 'assess', 'test:' + taskId, { taskId, revision: 1 }),
      );
      return taskId;
    }
    try {
      for (let i = 0; i < 4; i++) await makeTask();
      await runBatch(f.tenantId);
      assert.equal(calls, 3);
      const health = (
        await f.admin.query('SELECT * FROM provider_health WHERE tenant_id=$1', [f.tenantId])
      ).rows[0];
      assert.ok(new Date(health.open_until).getTime() > Date.now());
      assert.equal(
        (
          await f.admin.query(
            "SELECT count(*)::int n FROM jobs WHERE tenant_id=$1 AND status='retry_wait'",
            [f.tenantId],
          )
        ).rows[0].n,
        4,
      );
      assert.equal(health.failures, 3);
      await f.admin.query('UPDATE jobs SET available_at=now() WHERE tenant_id=$1', [f.tenantId]);
      await runBatch(f.tenantId);
      assert.equal(calls, 3);
      const paused = (
        await f.admin.query('SELECT * FROM provider_health WHERE tenant_id=$1', [f.tenantId])
      ).rows[0];
      assert.equal(paused.open_until.toISOString(), health.open_until.toISOString());
      assert.equal(paused.failures, 3);
      const attempts = (
        await f.admin.query('SELECT max(attempts)::int n FROM jobs WHERE tenant_id=$1', [
          f.tenantId,
        ])
      ).rows[0].n;
      assert.equal(attempts, 1);
      fail = false;
      await f.admin.query(
        "UPDATE provider_health SET open_until=now()-interval '1 second' WHERE tenant_id=$1",
        [f.tenantId],
      );
      await f.admin.query('UPDATE jobs SET available_at=now() WHERE tenant_id=$1', [f.tenantId]);
      await runBatch(f.tenantId);
      assert.equal(
        (
          await f.admin.query('SELECT count(*)::int n FROM assessments WHERE tenant_id=$1', [
            f.tenantId,
          ])
        ).rows[0].n,
        4,
      );
      process.env.DAILY_TOKEN_BUDGET = '1';
      const quotaTask = await makeTask();
      const priorCalls = calls;
      await runBatch(f.tenantId);
      assert.equal(calls, priorCalls);
      assert.equal(
        (
          await f.admin.query(
            "SELECT status FROM jobs WHERE tenant_id=$1 AND payload->>'taskId'=$2",
            [f.tenantId, quotaTask],
          )
        ).rows[0].status,
        'failed',
      );
      assert.equal(
        (
          await f.admin.query('SELECT failures FROM provider_health WHERE tenant_id=$1', [
            f.tenantId,
          ])
        ).rows[0].failures,
        0,
      );
      delete process.env.OPENAI_API_KEY;
      const manualTask = await makeTask();
      await runBatch(f.tenantId);
      assert.equal(
        (
          await f.admin.query('SELECT model FROM assessments WHERE tenant_id=$1 AND task_id=$2', [
            f.tenantId,
            manualTask,
          ])
        ).rows[0].model,
        'manual-review',
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.admin.end();
      await pool().end();
    }
  },
);
