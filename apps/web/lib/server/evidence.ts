import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { Actor, HttpError, audit, accessEmployee, onRollback } from './core';
import { id, plan, enqueue } from './domain';
import { putPrivate, getPrivate, validateEvidence, deletePrivate } from './storage';
export async function submitEvidence(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      activityId: id,
      filename: z.string().min(1).max(200),
      mime: z.enum(['text/plain', 'application/pdf']),
      contentBase64: z
        .string()
        .min(1)
        .max(7 * 1024 * 1024),
    })
    .parse(input);
  const activity = (await db.query('SELECT * FROM plan_activities WHERE id=$1', [b.activityId]))
    .rows[0];
  if (!activity) throw new HttpError(404, 'Activity not found.');
  const p = await plan(db, a, activity.plan_id, true);
  if (p.employee_external_id !== a.employeeId)
    throw new HttpError(403, 'Upload evidence only for your own activities.');
  if (
    !['active', 'completed'].includes(p.status) ||
    p.stale ||
    activity.plan_revision !== p.revision
  )
    throw new HttpError(409, 'Evidence requires a current approved plan.');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['evidence-quota:' + a.tenantId]);
  const quota = (
    await db.query(
      'SELECT count(*) FILTER(WHERE employee_external_id=$1 AND created_at>=CURRENT_DATE)::int AS today,COALESCE(sum(bytes),0)::bigint AS stored FROM evidence',
      [a.employeeId],
    )
  ).rows[0];
  if (
    quota.today >= Number(process.env.MAX_EVIDENCE_PER_DAY || 5) ||
    Number(quota.stored) >= Number(process.env.MAX_EVIDENCE_BYTES_PER_TENANT || 104857600)
  )
    throw new HttpError(429, 'Evidence storage quota reached. Contact your administrator.');
  const reviewer = (
    await db.query(
      'SELECT m.manager_user_id FROM manager_assignments m JOIN memberships u ON u.user_id=m.manager_user_id AND u.tenant_id=m.tenant_id AND u.active WHERE m.employee_external_id=$1 AND m.manager_user_id<>$2 ORDER BY m.manager_user_id LIMIT 1',
      [a.employeeId, a.userId],
    )
  ).rows[0];
  if (!reviewer) throw new HttpError(409, 'Ask HR to assign an independent reviewer.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.contentBase64))
    throw new HttpError(422, 'Invalid base64 file.');
  const data = Buffer.from(b.contentBase64, 'base64');
  validateEvidence(data, b.mime);
  if (
    Number(quota.stored) + data.length >
    Number(process.env.MAX_EVIDENCE_BYTES_PER_TENANT || 104857600)
  )
    throw new HttpError(429, 'Evidence storage quota reached.');
  const evidenceId = randomUUID();
  const key = `tenants/${a.tenantId}/evidence/${evidenceId}`;
  await putPrivate(key, data, b.mime);
  onRollback(db, () => deletePrivate(key));
  try {
    await db.query(
      'INSERT INTO evidence(id,tenant_id,activity_id,employee_external_id,reviewer_id,object_key,filename,mime,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        evidenceId,
        a.tenantId,
        activity.id,
        a.employeeId,
        reviewer.manager_user_id,
        key,
        b.filename.replace(/[\r\n\x00-\x1f]/g, '_'),
        b.mime,
        data.length,
      ],
    );
    await enqueue(db, a.tenantId, 'scan', 'scan:' + evidenceId, { evidenceId });
    await audit(db, a, a.tenantId, 'evidence.submitted', evidenceId);
    return { id: evidenceId, status: 'quarantined' };
  } catch (error) {
    await deletePrivate(key);
    throw error;
  }
}
export async function reviewEvidence(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      evidenceId: id,
      decision: z.enum(['verified', 'rejected']),
      reason: z.string().trim().min(5).max(2000),
    })
    .parse(input);
  const e = (await db.query('SELECT * FROM evidence WHERE id=$1 FOR UPDATE', [b.evidenceId]))
    .rows[0];
  if (!e) throw new HttpError(404, 'Evidence not found.');
  if (e.reviewer_id !== a.userId || e.employee_external_id === a.employeeId)
    throw new HttpError(403, 'Only the assigned independent reviewer can verify evidence.');
  if (e.status !== 'clean')
    throw new HttpError(
      409,
      'Evidence must pass malware scanning and must not already be reviewed.',
    );
  const act = (
    await db.query(
      'SELECT a.*,p.employee_external_id,p.revision AS current_revision,p.stale,p.status AS plan_status FROM plan_activities a JOIN learning_plans p ON p.id=a.plan_id WHERE a.id=$1',
      [e.activity_id],
    )
  ).rows[0];
  if (
    act.plan_revision !== act.current_revision ||
    act.stale ||
    !['active', 'completed'].includes(act.plan_status)
  )
    throw new HttpError(409, 'Evidence belongs to an outdated or unapproved plan revision.');
  await db.query('UPDATE evidence SET status=$2,review_reason=$3,reviewed_at=now() WHERE id=$1', [
    e.id,
    b.decision,
    b.reason,
  ]);
  if (b.decision === 'verified')
    await db.query(
      `INSERT INTO employee_skills(tenant_id,employee_external_id,skill_id,verified_level,verified_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(tenant_id,employee_external_id,skill_id) DO UPDATE SET verified_level=CASE WHEN employee_skills.verified_at>now()-interval '180 days' THEN GREATEST(employee_skills.verified_level,EXCLUDED.verified_level) ELSE EXCLUDED.verified_level END,verified_at=now()`,
      [a.tenantId, e.employee_external_id, act.skill_id, act.target_level],
    );
  await audit(db, a, a.tenantId, 'evidence.' + b.decision, e.id);
  return { ok: true };
}
export async function downloadEvidence(db: PoolClient, a: Actor, evidenceId: string) {
  const e = (await db.query('SELECT * FROM evidence WHERE id=$1', [id.parse(evidenceId)])).rows[0];
  if (!e) throw new HttpError(404, 'Evidence not found.');
  if (e.employee_external_id !== a.employeeId && e.reviewer_id !== a.userId)
    throw new HttpError(404, 'Evidence not found.');
  if (!['clean', 'verified', 'rejected'].includes(e.status))
    throw new HttpError(409, 'Quarantined or infected evidence cannot be downloaded.');
  await audit(db, a, a.tenantId, 'evidence.downloaded', e.id);
  return new Response(new Uint8Array(await getPrivate(e.object_key)), {
    headers: {
      'Content-Type': e.mime,
      'Content-Disposition': `attachment; filename="${e.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
