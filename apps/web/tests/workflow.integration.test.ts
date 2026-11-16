import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { AddressInfo } from 'node:net';
import { GET, POST } from '../app/api/workspace/[...path]/route';
import { fixture, dbTests } from './helpers';
import { pool, transaction } from '../lib/server/core';
import { runBatch, dispatchOutbox, claimJob, runOne } from '../lib/server/worker';
import { previewCsv } from '../lib/inventory';
import { reapplyDeletionLedger } from '../lib/server/privacy';
import { getPrivate } from '../lib/server/storage';
test(
  'full workflow: review, queue, skills, revision-safe approval, evidence, reporting and deletion restore',
  { skip: !dbTests },
  async () => {
    const f = await fixture(),
      other = await fixture();
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'skillshift-test-'));
    process.env.PRIVATE_STORAGE_PATH = storageRoot;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    const scanner = createServer((socket) => {
      let all = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        all = Buffer.concat([all, chunk]);
        if (all.length >= 14 && all.subarray(-4).equals(Buffer.alloc(4)))
          socket.end('stream: OK\0');
      });
    });
    await new Promise<void>((resolve) => scanner.listen(0, '127.0.0.1', resolve));
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = String((scanner.address() as AddressInfo).port);
    const call = async (role: string, path: string, input: unknown) =>
      POST(await f.request(role, '/api/workspace/' + path, 'POST', input), {
        params: Promise.resolve({ path: path.split('/') }),
      });
    const state = async (role: string) => {
      const r = await GET(await f.request(role, '/api/workspace/state'), {
        params: Promise.resolve({ path: ['state'] }),
      });
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    const ok = async (role: string, path: string, input: unknown) => {
      const r = await call(role, path, input);
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    try {
      const csv =
        'employee_external_id,role_name,task_external_id,task_description,skill_tags\nEMP-TEST,Engineer,t1,Explain test results,testing';
      await ok('hr', 'imports', { csv, confirm: true, digest: previewCsv(csv).digest });
      let t = (await state('employee')).tasks[0];
      assert.equal((await call('employee', 'assessments/request', { taskId: t.id })).status, 409);
      await ok('employee', 'tasks/correct', {
        taskId: t.id,
        revision: 1,
        description: 'Write and explain boundary tests.',
      });
      assert.equal(
        (
          await call('employee', 'tasks/correct', {
            taskId: t.id,
            revision: 1,
            description: 'Lost update.',
          })
        ).status,
        409,
      );
      await ok('employee', 'tasks/review', {
        taskId: t.id,
        revision: 2,
        decision: 'accepted',
        reason: 'Accurate task map.',
      });
      await ok('employee', 'assessments/request', { taskId: t.id });
      await dispatchOutbox(f.tenantId);
      await dispatchOutbox(f.tenantId);
      const claims = await Promise.all([claimJob(f.tenantId), claimJob(f.tenantId)]);
      assert.equal(claims.filter(Boolean).length, 1);
      await f.admin.query(
        "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1",
        [f.tenantId],
      );
      await runBatch(f.tenantId);
      let s = await state('manager');
      assert.equal(s.assessments.length, 1);
      assert.equal(s.assessments[0].category, 'uncertain');
      assert.equal(s.assessments[0].model, 'manual-review');
      assert.equal(
        (
          await call('employee', 'assessments/review', {
            taskId: t.id,
            revision: 2,
            category: 'assist',
            reason: 'Cannot self approve.',
          })
        ).status,
        403,
      );
      await ok('manager', 'assessments/review', {
        taskId: t.id,
        revision: 2,
        category: 'assist',
        reason: 'AI can assist; a human must check boundary coverage.',
      });
      await ok('hr', 'skills/targets', { roleName: 'Engineer', skillId: 'testing', level: 2 });
      s = await state('employee');
      assert.equal(s.skillGaps[0].skills[0].unknown, true);
      assert.equal(s.skillGaps[0].skills[0].gap, null);
      await ok('employee', 'skills/self-report', { skillId: 'testing', level: 0 });
      const generated = await ok('employee', 'plans/generate', {
        employeeId: 'EMP-TEST',
        weeklyMinutes: 60,
      });
      assert.equal(
        (
          await call('employee', 'plans/approve', {
            planId: generated.id,
            revision: 1,
            startDate: '2026-11-16',
          })
        ).status,
        403,
      );
      await ok('employee', 'skills/self-report', { skillId: 'testing', level: 1 });
      assert.equal(
        (
          await call('manager', 'plans/approve', {
            planId: generated.id,
            revision: 1,
            startDate: '2026-11-16',
          })
        ).status,
        409,
      );
      const revision = await ok('employee', 'plans/generate', {
        employeeId: 'EMP-TEST',
        weeklyMinutes: 60,
        planId: generated.id,
        revision: 1,
      });
      assert.equal(revision.revision, 2);
      assert.equal(
        (
          await call('manager', 'plans/approve', {
            planId: generated.id,
            revision: 1,
            startDate: '2026-11-16',
          })
        ).status,
        409,
      );
      const dates = await ok('manager', 'plans/approve', {
        planId: generated.id,
        revision: 2,
        startDate: '2026-11-16',
      });
      assert.equal(dates.end, '2026-12-15');
      s = await state('employee');
      const activity = s.activities[0];
      assert.equal(activity.plan_revision, 2);
      const evidence = await ok('employee', 'evidence/submit', {
        activityId: activity.id,
        filename: 'exercise.txt',
        mime: 'text/plain',
        contentBase64: Buffer.from('Tests cover empty, valid and malformed input.').toString(
          'base64',
        ),
      });
      const download = async (role: string) =>
        GET(await f.request(role, '/api/workspace/evidence/' + evidence.id), {
          params: Promise.resolve({ path: ['evidence', evidence.id] }),
        });
      assert.equal((await download('employee')).status, 409);
      assert.equal(
        (
          await call('manager', 'evidence/review', {
            evidenceId: evidence.id,
            decision: 'verified',
            reason: 'Rubric met.',
          })
        ).status,
        409,
      );
      await runBatch(f.tenantId);
      assert.equal((await download('employee')).status, 200);
      assert.equal(
        (
          await call('employee', 'evidence/review', {
            evidenceId: evidence.id,
            decision: 'verified',
            reason: 'Self verified.',
          })
        ).status,
        403,
      );
      await ok('employee', 'activities/complete', { activityId: activity.id });
      s = await state('manager');
      assert.equal(s.report.completionRate, 1);
      assert.equal(s.report.verifiedSkills, 0);
      await ok('manager', 'evidence/review', {
        evidenceId: evidence.id,
        decision: 'verified',
        reason: 'Boundary test demonstrates the agreed rubric.',
      });
      s = await state('manager');
      assert.equal(s.report.verifiedSkills, 1);
      assert.equal(s.report.acceptanceRate, 0);
      const foreign = await POST(
        await other.request('manager', '/api/workspace/plans/approve', 'POST', {
          planId: generated.id,
          revision: 2,
          startDate: '2026-11-16',
        }),
        { params: Promise.resolve({ path: ['plans', 'approve'] }) },
      );
      assert.equal(foreign.status, 404);
      assert.equal(
        (
          await GET(await f.request('hr', '/api/workspace/evidence/' + evidence.id), {
            params: Promise.resolve({ path: ['evidence', evidence.id] }),
          })
        ).status,
        404,
      );
      const exported = await GET(await f.request('employee', '/api/workspace/privacy/export'), {
        params: Promise.resolve({ path: ['privacy', 'export'] }),
      });
      const personal = await exported.json();
      assert.equal(personal.taskVersions.length, 2);
      assert.equal(personal.evidence.length, 1);
      assert.equal('object_key' in personal.evidence[0], false);
      await ok('admin', 'policy', {
        evidenceRetentionDays: 180,
        legalHold: true,
        confirmation: 'POLICY APPROVED',
      });
      assert.equal(
        (await call('employee', 'privacy/delete', { employeeId: 'EMP-TEST', confirm: 'DELETE' }))
          .status,
        409,
      );
      await ok('admin', 'policy', {
        evidenceRetentionDays: 180,
        legalHold: false,
        confirmation: 'POLICY APPROVED',
      });
      const objectKey = (
        await f.admin.query('SELECT object_key FROM evidence WHERE id=$1', [evidence.id])
      ).rows[0].object_key;
      await ok('employee', 'privacy/delete', { employeeId: 'EMP-TEST', confirm: 'DELETE' });
      await runBatch(f.tenantId);
      assert.equal(
        (await f.admin.query('SELECT 1 FROM inventory_tasks WHERE tenant_id=$1', [f.tenantId]))
          .rowCount,
        0,
      );
      assert.equal(
        (await f.admin.query('SELECT 1 FROM app_users WHERE id=$1', [f.users.employee.userId]))
          .rowCount,
        0,
      );
      await assert.rejects(() => getPrivate(objectKey));
      // Simulate an old backup restoring a deleted employee task; the external ledger removes it again.
      await f.admin.query(
        "INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description) VALUES(gen_random_uuid(),$1,'EMP-TEST','Engineer','restored','Old backup')",
        [f.tenantId],
      );
      assert.equal(await transaction(f.tenantId, (db) => reapplyDeletionLedger(db, f.tenantId)), 1);
      assert.equal(
        (await f.admin.query('SELECT 1 FROM inventory_tasks WHERE tenant_id=$1', [f.tenantId]))
          .rowCount,
        0,
      );
    } finally {
      await new Promise<void>((resolve) => scanner.close(() => resolve()));
      await f.admin.end();
      await other.admin.end();
      await pool().end();
      await rm(storageRoot, { recursive: true, force: true });
    }
  },
);
