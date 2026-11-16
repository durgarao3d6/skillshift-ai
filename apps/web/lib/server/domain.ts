import { PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Actor,
  HttpError,
  roles,
  accessEmployee,
  assignedManager,
  audit,
  csvCell,
  onCommit,
} from './core';
import { previewCsv } from '../inventory';
const summaryCache = new Map<string, { expires: number; promise: Promise<any> }>();
export function invalidateSummary(tenantId: string) {
  for (const key of summaryCache.keys())
    if (key.startsWith(tenantId + ':')) summaryCache.delete(key);
}
async function inventoryCounts(db: PoolClient, a: Actor, employees: string[] | null) {
  const key = a.tenantId + ':' + JSON.stringify(employees);
  const cached = summaryCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (summaryCache.size > 1000) summaryCache.clear();
  const promise = db
    .query(
      'SELECT count(*)::int AS tasks,count(DISTINCT employee_external_id)::int AS employees,count(DISTINCT role_name)::int AS roles FROM inventory_tasks WHERE ($1::text[] IS NULL OR employee_external_id=ANY($1))',
      [employees],
    )
    .then((r) => r.rows[0])
    .catch((e) => {
      summaryCache.delete(key);
      throw e;
    });
  summaryCache.set(key, { expires: Date.now() + 2000, promise });
  return promise;
}
export const id = z.uuid();
export const employee = z.string().trim().min(1).max(100);
export const categories = z.enum(['assist', 'partially_automate', 'human_led', 'uncertain']);
export async function scope(db: PoolClient, a: Actor): Promise<string[] | null> {
  if (['admin', 'hr'].includes(a.role)) return null;
  const rows =
    a.role === 'manager'
      ? (
          await db.query(
            'SELECT employee_external_id FROM manager_assignments WHERE manager_user_id=$1',
            [a.userId],
          )
        ).rows
      : [];
  return [
    ...new Set([
      ...rows.map((x) => x.employee_external_id),
      ...(a.employeeId ? [a.employeeId] : []),
    ]),
  ];
}
export async function task(db: PoolClient, a: Actor, taskId: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM inventory_tasks WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [
      id.parse(taskId),
    ])
  ).rows[0];
  if (!row) throw new HttpError(404, 'Task not found.');
  await accessEmployee(db, a, row.employee_external_id);
  return row;
}
export async function plan(db: PoolClient, a: Actor, planId: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM learning_plans WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [
      id.parse(planId),
    ])
  ).rows[0];
  if (!row) throw new HttpError(404, 'Plan not found.');
  await accessEmployee(db, a, row.employee_external_id);
  return row;
}
export async function enqueue(
  db: PoolClient,
  tenantId: string,
  kind: string,
  key: string,
  payload: unknown,
) {
  const outboxId = randomUUID();
  const r = await db.query(
    'INSERT INTO outbox_events(id,tenant_id,kind,idempotency_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING id',
    [outboxId, tenantId, kind, key, JSON.stringify(payload)],
  );
  return r.rows[0].id;
}
export async function importInventory(db: PoolClient, a: Actor, input: unknown) {
  roles(a, 'hr', 'admin');
  const b = z
    .object({ csv: z.string(), confirm: z.boolean().optional(), digest: z.string().optional() })
    .parse(input);
  let p;
  try {
    p = previewCsv(b.csv);
  } catch (error) {
    throw new HttpError(422, error instanceof Error ? error.message : 'Invalid CSV.');
  }
  if (!b.confirm) return { ...p, rows: p.rows.slice(0, 50), rowCount: p.rows.length };
  if (p.errors.length || b.digest !== p.digest)
    throw new HttpError(
      422,
      'Fix validation errors and preview the current file before confirming.',
    );
  const batch = (
    await db.query(
      'INSERT INTO import_batches(id,tenant_id,digest,row_count) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,digest) DO NOTHING RETURNING id',
      [randomUUID(), a.tenantId, p.digest, p.rows.length],
    )
  ).rows[0];
  if (!batch) return { imported: 0, duplicate: true };
  const values = p.rows.map((row) => ({ id: randomUUID(), ...row }));
  const inserted = await db.query(
    `INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description,skill_tags)
 SELECT (r->>'id')::uuid,$1,r->>'employee_external_id',r->>'role_name',r->>'task_external_id',r->>'task_description',ARRAY(SELECT jsonb_array_elements_text(r->'skill_tags')) FROM jsonb_array_elements($2::jsonb) AS r
 ON CONFLICT(tenant_id,employee_external_id,task_external_id) DO NOTHING RETURNING id,employee_external_id`,
    [a.tenantId, JSON.stringify(values)],
  );
  const ids = inserted.rows.map((r) => r.id);
  await db.query(
    "UPDATE learning_plans SET stale=true WHERE employee_external_id=ANY($1::text[]) AND status IN('draft','active')",
    [[...new Set(inserted.rows.map((r) => r.employee_external_id))]],
  );
  await db.query(
    'INSERT INTO task_versions(tenant_id,task_id,revision,description,role_name,skill_tags,created_by) SELECT tenant_id,id,revision,task_description,role_name,skill_tags,$2 FROM inventory_tasks WHERE id=ANY($1::uuid[])',
    [ids, a.userId],
  );
  onCommit(db, () => invalidateSummary(a.tenantId));
  await audit(db, a, a.tenantId, 'inventory.import', batch.id);
  return { imported: ids.length, skipped: p.rows.length - ids.length, duplicate: false };
}
export async function inventory(db: PoolClient, a: Actor, query: URLSearchParams) {
  const employees = await scope(db, a);
  const search = (query.get('search') || '').slice(0, 200);
  const cursor = query.get('cursor');
  if (cursor) id.parse(cursor);
  const rows = (
    await db.query(
      `SELECT * FROM inventory_tasks WHERE ($1::text[] IS NULL OR employee_external_id=ANY($1)) AND ($2='' OR role_name ILIKE '%'||$2||'%' OR task_description ILIKE '%'||$2||'%' OR employee_external_id ILIKE '%'||$2||'%') AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 101`,
      [employees, search, cursor],
    )
  ).rows;
  const counts = await inventoryCounts(db, a, employees);
  return { rows: rows.slice(0, 100), counts, nextCursor: rows.length > 100 ? rows[99].id : null };
}
export async function exportInventory(db: PoolClient, a: Actor) {
  const employees = await scope(db, a);
  const rows = (
    await db.query(
      'SELECT employee_external_id,role_name,task_external_id,task_description,skill_tags FROM inventory_tasks WHERE ($1::text[] IS NULL OR employee_external_id=ANY($1)) ORDER BY id',
      [employees],
    )
  ).rows;
  const columns = [
    'employee_external_id',
    'role_name',
    'task_external_id',
    'task_description',
    'skill_tags',
  ];
  return (
    columns.join(',') +
    '\n' +
    rows
      .map((r) => columns.map((k) => csvCell(k === 'skill_tags' ? r[k].join(';') : r[k])).join(','))
      .join('\n')
  );
}
export async function correctTask(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      taskId: id,
      revision: z.number().int().positive(),
      description: z.string().trim().min(1).max(4000),
    })
    .parse(input);
  const t = await task(db, a, b.taskId, true);
  if (t.revision !== b.revision) throw new HttpError(409, 'Task changed. Reload before editing.');
  const previousMap = (
    await db.query(
      'SELECT id,revision,review_state FROM inventory_tasks WHERE employee_external_id=$1 AND role_name=$2 ORDER BY id',
      [t.employee_external_id, t.role_name],
    )
  ).rows;
  const rejectedSnapshot = createHash('sha256').update(JSON.stringify(previousMap)).digest('hex');
  await db.query(
    'INSERT INTO role_map_reviews(id,tenant_id,employee_external_id,role_name,snapshot,accepted) VALUES($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING',
    [randomUUID(), a.tenantId, t.employee_external_id, t.role_name, rejectedSnapshot],
  );
  await db.query(
    "UPDATE inventory_tasks SET task_description=$2,revision=revision+1,review_state='pending' WHERE id=$1",
    [t.id, b.description],
  );
  await db.query(
    'INSERT INTO task_versions(tenant_id,task_id,revision,description,role_name,skill_tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [a.tenantId, t.id, t.revision + 1, b.description, t.role_name, t.skill_tags, a.userId],
  );
  await db.query("UPDATE assessments SET status='stale' WHERE task_id=$1", [t.id]);
  await db.query(
    "UPDATE learning_plans SET stale=true WHERE employee_external_id=$1 AND status IN('draft','active')",
    [t.employee_external_id],
  );
  await audit(db, a, a.tenantId, 'task.corrected', t.id);
  return { revision: t.revision + 1 };
}
export async function reviewTask(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      taskId: id,
      revision: z.number().int().positive(),
      decision: z.enum(['accepted', 'rejected']),
      reason: z.string().trim().min(3).max(2000),
    })
    .parse(input);
  const t = await task(db, a, b.taskId, true);
  if (a.employeeId !== t.employee_external_id) await assignedManager(db, a, t.employee_external_id);
  if (t.revision !== b.revision || t.review_state !== 'pending')
    throw new HttpError(409, 'This task revision has already changed or been reviewed.');
  await db.query(
    'INSERT INTO task_reviews(id,tenant_id,task_id,revision,reviewer_id,decision,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), a.tenantId, t.id, t.revision, a.userId, b.decision, b.reason],
  );
  await db.query('UPDATE inventory_tasks SET review_state=$2 WHERE id=$1', [t.id, b.decision]);
  const maps = (
    await db.query(
      'SELECT id,revision,review_state FROM inventory_tasks WHERE employee_external_id=$1 AND role_name=$2 ORDER BY id',
      [t.employee_external_id, t.role_name],
    )
  ).rows;
  if (maps.every((r) => r.review_state !== 'pending')) {
    const snapshot = createHash('sha256').update(JSON.stringify(maps)).digest('hex');
    await db.query(
      'INSERT INTO role_map_reviews(id,tenant_id,employee_external_id,role_name,snapshot,accepted) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [
        randomUUID(),
        a.tenantId,
        t.employee_external_id,
        t.role_name,
        snapshot,
        maps.every((r) => r.review_state === 'accepted'),
      ],
    );
  }
  await audit(db, a, a.tenantId, 'task.' + b.decision, t.id);
  return { ok: true };
}
export async function requestAssessment(db: PoolClient, a: Actor, input: unknown) {
  const b = z.object({ taskId: id }).parse(input);
  const t = await task(db, a, b.taskId);
  if (t.review_state !== 'accepted')
    throw new HttpError(409, 'Accept the current task map before requesting an assessment.');
  const eventId = await enqueue(db, a.tenantId, 'assess', `assess:${t.id}:${t.revision}:rubric-1`, {
    taskId: t.id,
    revision: t.revision,
  });
  await audit(db, a, a.tenantId, 'assessment.requested', eventId);
  return { eventId };
}
export async function reviewAssessment(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      taskId: id,
      revision: z.number().int().positive(),
      category: categories,
      reason: z.string().trim().min(5).max(2000),
    })
    .parse(input);
  const t = await task(db, a, b.taskId, true);
  await assignedManager(db, a, t.employee_external_id);
  if (t.revision !== b.revision || t.review_state !== 'accepted')
    throw new HttpError(409, 'Review the current accepted task revision.');
  const assessmentId = randomUUID();
  const saved = await db.query(
    `INSERT INTO assessments(id,tenant_id,task_id,task_revision,category,confidence,rationale,model,rubric_version,prompt_version,status,reviewer_id,review_reason) VALUES($1,$2,$3,$4,$5,'uncalibrated',$6,'human','rubric-1','prompt-1','reviewed',$7,$6)
 ON CONFLICT(tenant_id,task_id,task_revision,rubric_version) DO UPDATE SET category=EXCLUDED.category,status='reviewed',reviewer_id=EXCLUDED.reviewer_id,review_reason=EXCLUDED.review_reason RETURNING id`,
    [assessmentId, a.tenantId, t.id, t.revision, b.category, b.reason, a.userId],
  );
  await db.query(
    'INSERT INTO assessment_reviews(id,tenant_id,assessment_id,reviewer_id,category,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), a.tenantId, saved.rows[0].id, a.userId, b.category, b.reason],
  );
  await db.query(
    "UPDATE learning_plans SET stale=true WHERE employee_external_id=$1 AND status IN('draft','active')",
    [t.employee_external_id],
  );
  await audit(db, a, a.tenantId, 'assessment.reviewed', t.id);
  return { ok: true };
}
export async function gaps(db: PoolClient, a: Actor, employeeId: string) {
  await accessEmployee(db, a, employeeId);
  return (
    await db.query(
      `SELECT DISTINCT c.*,t.target_level,s.self_level,s.verified_level,
 CASE WHEN s.verified_at>now()-interval '180 days' THEN s.verified_level ELSE s.self_level END AS current_level
 FROM role_skill_targets t JOIN skill_catalogue c ON c.id=t.skill_id
 LEFT JOIN employee_skills s ON s.skill_id=t.skill_id AND s.employee_external_id=$1
 WHERE t.role_name IN(SELECT role_name FROM inventory_tasks WHERE employee_external_id=$1) ORDER BY c.id,t.target_level DESC`,
      [employeeId],
    )
  ).rows.reduce((result: any[], row) => {
    if (result.some((x) => x.id === row.id)) return result;
    result.push({
      ...row,
      unknown: row.current_level === null,
      gap: row.current_level === null ? null : Math.max(0, row.target_level - row.current_level),
    });
    return result;
  }, []);
}
export async function selfReport(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      skillId: z.string().min(1).max(100),
      level: z.number().int().min(0).max(4).nullable(),
    })
    .parse(input);
  if (!a.employeeId) throw new HttpError(403, 'Your account has no employee record.');
  if (!(await db.query('SELECT 1 FROM skill_catalogue WHERE id=$1', [b.skillId])).rowCount)
    throw new HttpError(404, 'Unknown skill.');
  await db.query(
    'INSERT INTO employee_skills(tenant_id,employee_external_id,skill_id,self_level) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,employee_external_id,skill_id) DO UPDATE SET self_level=EXCLUDED.self_level',
    [a.tenantId, a.employeeId, b.skillId, b.level],
  );
  await db.query(
    "UPDATE learning_plans SET stale=true WHERE employee_external_id=$1 AND status IN('draft','active')",
    [a.employeeId],
  );
  await audit(db, a, a.tenantId, 'skill.self_reported', b.skillId);
  return { ok: true };
}
export async function setTarget(db: PoolClient, a: Actor, input: unknown) {
  roles(a, 'admin', 'hr');
  const b = z
    .object({
      roleName: z.string().trim().min(1).max(200),
      skillId: z.string().min(1).max(100),
      level: z.number().int().min(1).max(4),
    })
    .parse(input);
  if (!(await db.query('SELECT 1 FROM skill_catalogue WHERE id=$1', [b.skillId])).rowCount)
    throw new HttpError(404, 'Unknown skill.');
  await db.query(
    'INSERT INTO role_skill_targets(tenant_id,role_name,skill_id,target_level) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,role_name,skill_id) DO UPDATE SET target_level=EXCLUDED.target_level',
    [a.tenantId, b.roleName, b.skillId, b.level],
  );
  await db.query(
    "UPDATE learning_plans SET stale=true WHERE employee_external_id IN(SELECT employee_external_id FROM inventory_tasks WHERE role_name=$1) AND status IN('draft','active')",
    [b.roleName],
  );
  await audit(db, a, a.tenantId, 'skill.target_set', b.skillId);
  return { ok: true };
}
async function taskSnapshot(db: PoolClient, employeeId: string) {
  const rows = (
    await db.query(
      `SELECT t.id,t.revision,t.review_state,a.status AS assessment_status,a.category FROM inventory_tasks t LEFT JOIN assessments a ON a.task_id=t.id AND a.task_revision=t.revision AND a.rubric_version='rubric-1' WHERE t.employee_external_id=$1 ORDER BY t.id`,
      [employeeId],
    )
  ).rows;
  if (
    !rows.length ||
    rows.some((r) => r.review_state !== 'accepted' || r.assessment_status !== 'reviewed')
  )
    throw new HttpError(
      409,
      'Every current task must be accepted and its assessment human-reviewed before planning.',
    );
  return rows;
}
export function scheduleActivities(
  skillGaps: {
    id: string;
    name: string;
    exercise: string;
    rubric: string;
    resource_url: string;
    target_level: number;
    current_level: number | null;
  }[],
  weeklyMinutes: number,
) {
  const selected = skillGaps
    .filter((s) => s.current_level === null || s.current_level < s.target_level)
    .slice(0, Math.min(16, Math.floor(weeklyMinutes / 30) * 4));
  if (!selected.length)
    throw new HttpError(409, 'No development gaps found. Add role targets or update proficiency.');
  return selected.map((s, i) => ({
    ...s,
    day: Math.min(
      28,
      Math.floor(i / Math.max(1, Math.floor(weeklyMinutes / 30))) * 7 +
        1 +
        (i % Math.max(1, Math.floor(weeklyMinutes / 30))),
    ),
    minutes: 30,
  }));
}
export async function generatePlan(db: PoolClient, a: Actor, input: unknown) {
  const b = z
    .object({
      employeeId: employee,
      weeklyMinutes: z.number().int().min(30).max(600),
      planId: id.optional(),
      revision: z.number().int().positive().optional(),
    })
    .parse(input);
  await accessEmployee(db, a, b.employeeId);
  let existing: any = null;
  if (b.planId) {
    existing = await plan(db, a, b.planId, true);
    if (
      existing.employee_external_id !== b.employeeId ||
      existing.revision !== b.revision ||
      !['draft', 'active'].includes(existing.status)
    )
      throw new HttpError(409, 'Plan changed. Reload before regenerating.');
  } else if (
    (
      await db.query(
        "SELECT 1 FROM learning_plans WHERE employee_external_id=$1 AND status IN('draft','active')",
        [b.employeeId],
      )
    ).rowCount
  )
    throw new HttpError(409, 'Revise the existing draft or active plan instead.');
  const tasks = await taskSnapshot(db, b.employeeId);
  const skillGaps = await gaps(db, a, b.employeeId);
  const activities = scheduleActivities(skillGaps, b.weeklyMinutes);
  const snapshot = { tasks, skills: skillGaps, rubricVersion: 'rubric-1', catalogueVersion: 1 };
  const planId = existing?.id || randomUUID();
  const revision = existing ? existing.revision + 1 : 1;
  if (existing)
    await db.query(
      "UPDATE learning_plans SET revision=$2,status='draft',weekly_minutes=$3,snapshot=$4,start_date=NULL,end_date=NULL,stale=false WHERE id=$1",
      [planId, revision, b.weeklyMinutes, JSON.stringify(snapshot)],
    );
  else
    await db.query(
      'INSERT INTO learning_plans(id,tenant_id,employee_external_id,weekly_minutes,snapshot) VALUES($1,$2,$3,$4,$5)',
      [planId, a.tenantId, b.employeeId, b.weeklyMinutes, JSON.stringify(snapshot)],
    );
  await db.query(
    'INSERT INTO plan_revisions(tenant_id,plan_id,revision,snapshot) VALUES($1,$2,$3,$4)',
    [a.tenantId, planId, revision, JSON.stringify(snapshot)],
  );
  for (const s of activities)
    await db.query(
      'INSERT INTO plan_activities(id,tenant_id,plan_id,plan_revision,skill_id,day,minutes,title,exercise,rubric,resource_url,target_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        randomUUID(),
        a.tenantId,
        planId,
        revision,
        s.id,
        s.day,
        s.minutes,
        s.name + ' practice',
        s.exercise,
        s.rubric,
        s.resource_url,
        s.target_level,
      ],
    );
  await audit(db, a, a.tenantId, 'plan.generated', planId);
  return { id: planId, revision };
}
export function planDates(start: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(422, 'Use a YYYY-MM-DD start date.');
  const date = new Date(start + 'T00:00:00Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== start)
    throw new HttpError(422, 'Invalid start date.');
  date.setUTCDate(date.getUTCDate() + 29);
  return { start, end: date.toISOString().slice(0, 10) };
}
export async function approvePlan(db: PoolClient, a: Actor, input: unknown) {
  roles(a, 'manager');
  const b = z
    .object({ planId: id, revision: z.number().int().positive(), startDate: z.string() })
    .parse(input);
  const p = await plan(db, a, b.planId, true);
  await assignedManager(db, a, p.employee_external_id);
  if (p.revision !== b.revision || p.status !== 'draft' || p.stale)
    throw new HttpError(409, 'Only the current, non-stale draft revision can be approved.');
  const current = await taskSnapshot(db, p.employee_external_id);
  if (
    JSON.stringify(
      current.map((r) => [r.id, r.revision, r.review_state, r.assessment_status, r.category]),
    ) !==
    JSON.stringify(
      p.snapshot.tasks.map((r: any) => [
        r.id,
        r.revision,
        r.review_state,
        r.assessment_status,
        r.category,
      ]),
    )
  )
    throw new HttpError(409, 'Tasks or assessments changed. Regenerate the plan.');
  const dates = planDates(b.startDate);
  await db.query(
    'INSERT INTO plan_approvals(id,tenant_id,plan_id,revision,reviewer_id,start_date) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), a.tenantId, p.id, p.revision, a.userId, dates.start],
  );
  await db.query(
    "UPDATE learning_plans SET status='active',start_date=$2,end_date=$3 WHERE id=$1",
    [p.id, dates.start, dates.end],
  );
  await db.query(
    'INSERT INTO cohort_members(tenant_id,employee_external_id,plan_id) VALUES($1,$2,$3) ON CONFLICT(tenant_id,employee_external_id) DO NOTHING',
    [a.tenantId, p.employee_external_id, p.id],
  );
  await audit(db, a, a.tenantId, 'plan.approved', p.id);
  return dates;
}
export async function completeActivity(db: PoolClient, a: Actor, input: unknown) {
  const b = z.object({ activityId: id }).parse(input);
  const act = (await db.query('SELECT * FROM plan_activities WHERE id=$1', [b.activityId])).rows[0];
  if (!act) throw new HttpError(404, 'Activity not found.');
  const p = await plan(db, a, act.plan_id, true);
  if (a.employeeId !== p.employee_external_id)
    throw new HttpError(403, 'Only the employee can complete an activity.');
  if (p.status !== 'active' || p.stale || act.plan_revision !== p.revision)
    throw new HttpError(409, 'Activity is not on a current approved plan.');
  await db.query(
    'UPDATE plan_activities SET completed_at=COALESCE(completed_at,now()) WHERE id=$1',
    [act.id],
  );
  const remaining = (
    await db.query(
      'SELECT 1 FROM plan_activities WHERE plan_id=$1 AND plan_revision=$2 AND completed_at IS NULL',
      [p.id, p.revision],
    )
  ).rowCount;
  if (!remaining)
    await db.query("UPDATE learning_plans SET status='completed' WHERE id=$1", [p.id]);
  await audit(db, a, a.tenantId, 'activity.completed', act.id);
  return { planCompleted: !remaining };
}
export async function withdraw(db: PoolClient, a: Actor, input: unknown) {
  const b = z.object({ planId: id, revision: z.number().int().positive() }).parse(input);
  const p = await plan(db, a, b.planId, true);
  if (p.revision !== b.revision) throw new HttpError(409, 'Plan revision changed.');
  if (a.employeeId !== p.employee_external_id) await assignedManager(db, a, p.employee_external_id);
  await db.query("UPDATE learning_plans SET status='cancelled' WHERE id=$1", [p.id]);
  await db.query(
    'UPDATE cohort_members SET withdrawn_at=COALESCE(withdrawn_at,now()) WHERE employee_external_id=$1',
    [p.employee_external_id],
  );
  await audit(db, a, a.tenantId, 'plan.withdrawn', p.id);
  return { ok: true };
}
export async function report(db: PoolClient, a: Actor) {
  roles(a, 'admin', 'hr', 'manager');
  const employees = await scope(db, a);
  const map = (
    await db.query(
      `WITH first_reviews AS(SELECT DISTINCT ON(employee_external_id,role_name) * FROM role_map_reviews WHERE ($1::text[] IS NULL OR employee_external_id=ANY($1)) ORDER BY employee_external_id,role_name,created_at,id) SELECT count(*)::int AS reviewed,count(*) FILTER(WHERE accepted)::int AS accepted FROM first_reviews`,
      [employees],
    )
  ).rows[0];
  const cohort = (
    await db.query(
      `SELECT count(*)::int AS approved,count(*) FILTER(WHERE p.status='completed' AND NOT p.stale)::int AS completed,count(*) FILTER(WHERE c.withdrawn_at IS NOT NULL)::int AS withdrawn,count(*) FILTER(WHERE p.end_date<CURRENT_DATE)::int AS observation_ended FROM cohort_members c JOIN learning_plans p ON p.id=c.plan_id WHERE ($1::text[] IS NULL OR c.employee_external_id=ANY($1))`,
      [employees],
    )
  ).rows[0];
  const verified = (
    await db.query(
      "SELECT count(*)::int AS verified FROM employee_skills WHERE verified_level IS NOT NULL AND verified_at>now()-interval '180 days' AND ($1::text[] IS NULL OR employee_external_id=ANY($1))",
      [employees],
    )
  ).rows[0];
  return {
    roleMaps: map,
    cohort,
    verifiedSkills: verified.verified,
    acceptanceRate: map.reviewed ? map.accepted / map.reviewed : null,
    completionRate: cohort.approved ? cohort.completed / cohort.approved : null,
    definitions: {
      acceptance:
        'First reviewed revision per employee/role map; later corrections do not inflate initial acceptance.',
      completion:
        'Completed non-stale plans / original approved employee cohort, including withdrawals in the denominator. Subjects permanently deleted for privacy are excluded. Early results are provisional until the 30-day observation ends.',
      verifiedSkills:
        'Evidence verified by assigned independent reviewer in the last 180 days; separate from activity completion.',
    },
  };
}
export async function workspace(db: PoolClient, a: Actor, selectedEmployee?: string) {
  if (selectedEmployee) await accessEmployee(db, a, employee.parse(selectedEmployee));
  const employees = selectedEmployee ? [selectedEmployee] : await scope(db, a);
  const filter = '($1::text[] IS NULL OR employee_external_id=ANY($1))';
  const tasks = (
    await db.query(
      `SELECT * FROM inventory_tasks WHERE ${filter} ORDER BY created_at,id LIMIT 200`,
      [employees],
    )
  ).rows;
  const assessments = (
    await db.query(
      `SELECT a.* FROM assessments a JOIN inventory_tasks t ON t.id=a.task_id WHERE ($1::text[] IS NULL OR t.employee_external_id=ANY($1)) ORDER BY a.created_at DESC LIMIT 200`,
      [employees],
    )
  ).rows;
  const plans = (
    await db.query(
      `SELECT * FROM learning_plans WHERE ${filter} ORDER BY created_at DESC LIMIT 100`,
      [employees],
    )
  ).rows;
  const activities = (
    await db.query(
      `SELECT a.* FROM plan_activities a JOIN learning_plans p ON p.id=a.plan_id AND p.revision=a.plan_revision WHERE ($1::text[] IS NULL OR p.employee_external_id=ANY($1)) ORDER BY a.day,a.id LIMIT 1000`,
      [employees],
    )
  ).rows;
  const evidence = (
    await db.query(
      `SELECT id,activity_id,employee_external_id,reviewer_id,filename,mime,bytes,status,review_reason,created_at FROM evidence WHERE employee_external_id=$1 OR reviewer_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [a.employeeId, a.userId],
    )
  ).rows;
  const jobs = ['hr', 'admin'].includes(a.role)
    ? (
        await db.query(
          'SELECT id,kind,status,attempts,last_error,created_at FROM jobs ORDER BY created_at DESC LIMIT 100',
        )
      ).rows
    : [];
  const catalogue = (await db.query('SELECT * FROM skill_catalogue ORDER BY name')).rows;
  const targets = ['hr', 'admin'].includes(a.role)
    ? (await db.query('SELECT * FROM role_skill_targets ORDER BY role_name,skill_id')).rows
    : [];
  const allSkills = [];
  for (const e of new Set(tasks.map((t) => t.employee_external_id)))
    allSkills.push({ employeeId: e, skills: await gaps(db, a, e) });
  return {
    actor: a,
    tasks,
    assessments,
    plans,
    activities,
    evidence,
    jobs,
    catalogue,
    targets,
    skillGaps: allSkills,
    report: ['admin', 'hr', 'manager'].includes(a.role) ? await report(db, a) : null,
    privacyRequests: (
      await db.query(
        `SELECT id,status,created_at FROM privacy_requests WHERE ${filter} ORDER BY created_at DESC LIMIT 100`,
        [employees],
      )
    ).rows,
  };
}
export async function assignManager(db: PoolClient, a: Actor, input: unknown) {
  roles(a, 'hr', 'admin');
  const b = z.object({ managerId: id, employeeId: employee }).parse(input);
  const m = (
    await db.query(
      'SELECT user_id,employee_external_id,role FROM memberships WHERE user_id=$1 AND active',
      [b.managerId],
    )
  ).rows[0];
  if (!m || !['manager', 'reviewer'].includes(m.role) || m.employee_external_id === b.employeeId)
    throw new HttpError(422, 'Choose an active manager or reviewer other than the employee.');
  await db.query(
    'INSERT INTO manager_assignments(tenant_id,manager_user_id,employee_external_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
    [a.tenantId, b.managerId, b.employeeId],
  );
  await audit(db, a, a.tenantId, 'manager.assigned', b.managerId);
  return { ok: true };
}
