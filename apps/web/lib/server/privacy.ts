import { createHmac, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { Actor, HttpError, accessEmployee, audit, roles, onCommit } from './core';
import { employee, enqueue, invalidateSummary } from './domain';
import { putPrivate, getPrivate, deletePrivate, listDeletionLedger } from './storage';
export function deletionHash(employeeId: string) {
  const secret = process.env.DELETION_HMAC_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    (process.env.NODE_ENV === 'production' && secret.startsWith('replace-'))
  )
    throw new HttpError(
      503,
      'Configure a durable DELETION_HMAC_SECRET before processing deletion.',
    );
  return createHmac('sha256', secret).update(employeeId).digest('hex');
}
export async function privacyExport(db: PoolClient, a: Actor, employeeId: string) {
  await accessEmployee(db, a, employeeId, { admin: false });
  if (a.employeeId !== employeeId) throw new HttpError(403, 'Employees export their own data.');
  const tasks = (
    await db.query('SELECT * FROM inventory_tasks WHERE employee_external_id=$1', [employeeId])
  ).rows;
  const plans = (
    await db.query('SELECT * FROM learning_plans WHERE employee_external_id=$1', [employeeId])
  ).rows;
  const data = {
    employeeId,
    identity: (
      await db.query(
        'SELECT u.issuer,u.subject,u.display_name,m.role,m.employee_external_id FROM app_users u JOIN memberships m ON m.user_id=u.id WHERE m.user_id=$1',
        [a.userId],
      )
    ).rows[0],
    roleMapReviews: (
      await db.query('SELECT * FROM role_map_reviews WHERE employee_external_id=$1', [employeeId])
    ).rows,
    cohort: (
      await db.query('SELECT * FROM cohort_members WHERE employee_external_id=$1', [employeeId])
    ).rows,
    tasks,
    taskVersions: (
      await db.query('SELECT * FROM task_versions WHERE task_id=ANY($1::uuid[])', [
        tasks.map((t) => t.id),
      ])
    ).rows,
    taskReviews: (
      await db.query('SELECT * FROM task_reviews WHERE task_id=ANY($1::uuid[])', [
        tasks.map((t) => t.id),
      ])
    ).rows,
    assessments: (
      await db.query('SELECT * FROM assessments WHERE task_id=ANY($1::uuid[])', [
        tasks.map((t) => t.id),
      ])
    ).rows,
    skills: (
      await db.query('SELECT * FROM employee_skills WHERE employee_external_id=$1', [employeeId])
    ).rows,
    assessmentReviews: (
      await db.query(
        'SELECT r.* FROM assessment_reviews r JOIN assessments a ON a.id=r.assessment_id WHERE a.task_id=ANY($1::uuid[])',
        [tasks.map((t) => t.id)],
      )
    ).rows,
    plans,
    planApprovals: (
      await db.query('SELECT * FROM plan_approvals WHERE plan_id=ANY($1::uuid[])', [
        plans.map((p) => p.id),
      ])
    ).rows,
    planRevisions: (
      await db.query('SELECT * FROM plan_revisions WHERE plan_id=ANY($1::uuid[])', [
        plans.map((p) => p.id),
      ])
    ).rows,
    activities: (
      await db.query('SELECT * FROM plan_activities WHERE plan_id=ANY($1::uuid[])', [
        plans.map((p) => p.id),
      ])
    ).rows,
    evidence: (
      await db.query(
        'SELECT id,activity_id,filename,mime,bytes,status,review_reason,created_at,reviewed_at FROM evidence WHERE employee_external_id=$1',
        [employeeId],
      )
    ).rows,
  };
  await audit(db, a, a.tenantId, 'privacy.export', a.userId);
  return data;
}
export async function requestDeletion(db: PoolClient, a: Actor, input: unknown) {
  const b = z.object({ employeeId: employee, confirm: z.literal('DELETE') }).parse(input);
  if (a.employeeId !== b.employeeId) roles(a, 'admin', 'hr');
  await accessEmployee(db, a, b.employeeId);
  if (
    !(
      await db.query(
        'SELECT 1 FROM inventory_tasks WHERE employee_external_id=$1 UNION SELECT 1 FROM memberships WHERE employee_external_id=$1',
        [b.employeeId],
      )
    ).rowCount
  )
    throw new HttpError(404, 'Employee not found.');
  const existing = (
    await db.query(
      "SELECT id FROM privacy_requests WHERE employee_external_id=$1 AND status='queued'",
      [b.employeeId],
    )
  ).rows[0];
  if (existing) return existing;
  const requestId = randomUUID();
  const policy = (await db.query('SELECT legal_hold FROM tenant_policies')).rows[0];
  if (policy?.legal_hold) throw new HttpError(409, 'Deletion is blocked by a tenant legal hold.');
  deletionHash(b.employeeId);
  await db.query(
    'INSERT INTO privacy_requests(id,tenant_id,employee_external_id) VALUES($1,$2,$3)',
    [requestId, a.tenantId, b.employeeId],
  );
  await enqueue(db, a.tenantId, 'delete', 'delete:' + requestId, { requestId });
  await audit(db, a, a.tenantId, 'privacy.deletion_requested', requestId);
  return { id: requestId };
}
export async function eraseEmployee(db: PoolClient, tenantId: string, employeeId: string) {
  const evidence = (
    await db.query('SELECT object_key FROM evidence WHERE employee_external_id=$1', [employeeId])
  ).rows;
  for (const e of evidence) await deletePrivate(e.object_key);
  // Only opaque hashes remain in the external deletion ledger. All employee-linked domain data is removed.
  await db.query('DELETE FROM learning_plans WHERE employee_external_id=$1', [employeeId]);
  await db.query('DELETE FROM inventory_tasks WHERE employee_external_id=$1', [employeeId]);
  await db.query('DELETE FROM employee_skills WHERE employee_external_id=$1', [employeeId]);
  await db.query('DELETE FROM role_map_reviews WHERE employee_external_id=$1', [employeeId]);
  await db.query('DELETE FROM manager_assignments WHERE employee_external_id=$1', [employeeId]);
  const members = (
    await db.query('SELECT user_id FROM memberships WHERE employee_external_id=$1', [employeeId])
  ).rows;
  for (const m of members) {
    await db.query('DELETE FROM sessions WHERE user_id=$1', [m.user_id]);
    await db.query('DELETE FROM app_users WHERE id=$1', [m.user_id]);
  }
  const hashed = deletionHash(employeeId);
  await db.query(
    "UPDATE privacy_requests SET employee_external_id=$2,status='completed' WHERE employee_external_id=$1",
    [employeeId, 'deleted:' + hashed],
  );
  // Jobs carry opaque task/evidence/request IDs, never task text or employee identifiers.
  onCommit(db, () => invalidateSummary(tenantId));
  await audit(db, null, tenantId, 'privacy.employee_erased', hashed);
}
export async function processDeletion(db: PoolClient, tenantId: string, requestId: string) {
  const r = (await db.query('SELECT * FROM privacy_requests WHERE id=$1 FOR UPDATE', [requestId]))
    .rows[0];
  if (!r || r.status === 'completed') return;
  const policy = (await db.query('SELECT legal_hold FROM tenant_policies')).rows[0];
  if (policy?.legal_hold) {
    await db.query("UPDATE privacy_requests SET status='blocked' WHERE id=$1", [r.id]);
    return;
  }
  const hash = deletionHash(r.employee_external_id);
  await putPrivate(
    `deletions/${tenantId}/${hash}.json`,
    Buffer.from(
      JSON.stringify({ version: 1, tenantId, employeeHash: hash, requestedAt: r.created_at }),
    ),
    'application/json',
  );
  await eraseEmployee(db, tenantId, r.employee_external_id);
}
export async function reapplyDeletionLedger(db: PoolClient, tenantId: string) {
  const entries = await listDeletionLedger(tenantId);
  const employees = (
    await db.query(
      'SELECT employee_external_id FROM inventory_tasks UNION SELECT employee_external_id FROM memberships WHERE employee_external_id IS NOT NULL UNION SELECT employee_external_id FROM learning_plans',
    )
  ).rows;
  const hashes = new Set<string>();
  for (const key of entries) {
    const record = JSON.parse((await getPrivate(key)).toString());
    if (
      record.version !== 1 ||
      record.tenantId !== tenantId ||
      !/^[a-f0-9]{64}$/.test(record.employeeHash)
    )
      throw new Error('Invalid deletion ledger');
    hashes.add(record.employeeHash);
  }
  let erased = 0;
  for (const e of employees) {
    if (hashes.has(deletionHash(e.employee_external_id))) {
      await eraseEmployee(db, tenantId, e.employee_external_id);
      erased++;
    }
  }
  return erased;
}
export async function retentionSweep(db: PoolClient, tenantId: string) {
  const policy = (await db.query('SELECT * FROM tenant_policies')).rows[0];
  if (!policy?.policy_approved_at || !policy.evidence_retention_days || policy.legal_hold) return 0;
  const rows = (
    await db.query(
      `SELECT e.id,e.object_key FROM evidence e JOIN plan_activities a ON a.id=e.activity_id JOIN learning_plans p ON p.id=a.plan_id WHERE p.end_date<CURRENT_DATE-($1::int) AND e.status<>'quarantined'`,
      [policy.evidence_retention_days],
    )
  ).rows;
  for (const row of rows) {
    await deletePrivate(row.object_key);
    await db.query('DELETE FROM evidence WHERE id=$1', [row.id]);
    await audit(db, null, tenantId, 'retention.evidence_deleted', row.id);
  }
  return rows.length;
}
