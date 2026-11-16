import { randomUUID, createHash } from 'node:crypto';
import { transaction, audit, Actor } from './core';
import { classifyTask } from './provider';
import { getPrivate, scanClamAV } from './storage';
import { processDeletion, retentionSweep } from './privacy';
export async function dispatchOutbox(tenantId: string) {
  return transaction(tenantId, async (db) => {
    const events = (
      await db.query(
        'SELECT * FROM outbox_events WHERE delivered_at IS NULL ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED',
      )
    ).rows;
    for (const event of events) {
      await db.query(
        'INSERT INTO jobs(id,tenant_id,kind,idempotency_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING',
        [event.id, tenantId, event.kind, event.idempotency_key, event.payload],
      );
      await db.query('UPDATE outbox_events SET delivered_at=now() WHERE id=$1', [event.id]);
    }
    return events.length;
  });
}
export async function claimJob(tenantId: string) {
  return transaction(tenantId, async (db) => {
    await db.query(
      "UPDATE jobs SET status='failed',last_error='Lease exhausted after maximum attempts',lease_until=NULL WHERE status='running' AND lease_until<now() AND attempts>=5",
    );
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['job-claim:' + tenantId]);
    const running = (
      await db.query(
        "SELECT count(*)::int AS n FROM jobs WHERE kind='assess' AND status='running' AND lease_until>now()",
      )
    ).rows[0].n;
    const token = randomUUID();
    return (
      (
        await db.query(
          `UPDATE jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '2 minutes',lease_token=$1 WHERE id=(SELECT id FROM jobs WHERE attempts<5 AND (kind<>'assess' OR $2::boolean) AND ((status IN('queued','retry_wait') AND available_at<=now()) OR (status='running' AND lease_until<now())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
          [token, running < Number(process.env.ASSESSMENT_CONCURRENCY || 2)],
        )
      ).rows[0] || null
    );
  });
}
async function assess(job: any) {
  const input = await transaction(job.tenant_id, async (db) => {
    const task = (await db.query('SELECT * FROM inventory_tasks WHERE id=$1', [job.payload.taskId]))
      .rows[0];
    if (!task || task.revision !== job.payload.revision || task.review_state !== 'accepted')
      return null;
    const existing = (
      await db.query(
        "SELECT status FROM assessments WHERE task_id=$1 AND task_revision=$2 AND rubric_version='rubric-1'",
        [task.id, task.revision],
      )
    ).rows[0];
    if (existing) return null;
    if (
      !process.env.OPENAI_API_KEY ||
      !process.env.OPENAI_MODEL ||
      process.env.AI_DATA_PROCESSING_APPROVED !== 'true'
    )
      return task;
    const health = (await db.query('SELECT open_until FROM provider_health')).rows[0];
    if (health?.open_until && new Date(health.open_until).getTime() > Date.now())
      throw Object.assign(new Error('Provider circuit is open'), {
        deferUntil: new Date(health.open_until),
      });
    const charge =
      process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
        ? Math.ceil(task.task_description.length / 4) + 700
        : 0;
    const limit = Number(process.env.DAILY_TOKEN_BUDGET || 100000);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid tenant token quota');
    const budget = await db.query(
      'INSERT INTO token_budgets(tenant_id,day,used_tokens) VALUES($1,CURRENT_DATE,$2) ON CONFLICT(tenant_id,day) DO UPDATE SET used_tokens=token_budgets.used_tokens+$2 WHERE token_budgets.used_tokens+$2<=$3 RETURNING used_tokens',
      [job.tenant_id, charge, limit],
    );
    if (!budget.rowCount || charge > limit)
      throw Object.assign(new Error('Tenant token budget exhausted'), { permanent: true });
    return task;
  });
  if (!input) return null;
  try {
    return { input, result: await classifyTask(input.task_description) };
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('Provider request failed'), {
      providerFailure: true,
    });
  }
}
export async function runOne(tenantId: string) {
  await dispatchOutbox(tenantId);
  const job = await claimJob(tenantId);
  if (!job) return false;
  try {
    let assessment: Awaited<ReturnType<typeof assess>> = null;
    let scanResult: 'clean' | 'infected' | null = null;
    if (job.kind === 'assess') assessment = await assess(job);
    else if (job.kind === 'scan') {
      const evidence = await transaction(
        tenantId,
        async (db) =>
          (await db.query('SELECT * FROM evidence WHERE id=$1', [job.payload.evidenceId])).rows[0],
      );
      if (evidence?.status === 'quarantined')
        scanResult = await scanClamAV(await getPrivate(evidence.object_key));
    }
    await transaction(tenantId, async (db) => {
      const current = (await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [job.id]))
        .rows[0];
      if (
        current.status !== 'running' ||
        current.lease_token !== job.lease_token ||
        new Date(current.lease_until).getTime() < Date.now()
      )
        return;
      if (assessment) {
        await db.query(
          'INSERT INTO provider_health(tenant_id,failures) VALUES($1,0) ON CONFLICT(tenant_id) DO UPDATE SET failures=0,open_until=NULL',
          [tenantId],
        );
        const task = (
          await db.query(
            'SELECT revision,review_state FROM inventory_tasks WHERE id=$1 FOR UPDATE',
            [assessment.input.id],
          )
        ).rows[0];
        if (task?.revision === assessment.input.revision && task.review_state === 'accepted') {
          const r = assessment.result;
          await db.query(
            `INSERT INTO assessments(id,tenant_id,task_id,task_revision,category,confidence,rationale,model,rubric_version,prompt_version,suggested_category,input_hash,output_hash,tokens) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'rubric-1','prompt-1',$5,$9,$10,$11) ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              tenantId,
              assessment.input.id,
              assessment.input.revision,
              r.category,
              r.confidence,
              r.rationale,
              r.model,
              createHash('sha256').update(assessment.input.task_description).digest('hex'),
              createHash('sha256').update(JSON.stringify(r)).digest('hex'),
              r.tokens,
            ],
          );
        }
      }
      if (scanResult)
        await db.query("UPDATE evidence SET status=$2 WHERE id=$1 AND status='quarantined'", [
          job.payload.evidenceId,
          scanResult,
        ]);
      if (job.kind === 'delete') await processDeletion(db, tenantId, job.payload.requestId);
      await db.query(
        "UPDATE jobs SET status='succeeded',lease_until=NULL,last_error=NULL WHERE id=$1",
        [job.id],
      );
      await audit(db, null, tenantId, 'job.succeeded', job.id);
    });
  } catch (error) {
    await transaction(tenantId, async (db) => {
      const deferred = (error as { deferUntil?: Date })?.deferUntil;
      if (deferred) {
        await db.query(
          "UPDATE jobs SET status='retry_wait',attempts=GREATEST(0,attempts-1),available_at=$2,last_error='Provider circuit is open',lease_until=NULL WHERE id=$1 AND lease_token=$3 AND status='running'",
          [job.id, deferred, job.lease_token],
        );
        await audit(db, null, tenantId, 'job.deferred', job.id);
        return;
      }
      if (job.kind === 'assess' && (error as { providerFailure?: boolean })?.providerFailure)
        await db.query(
          "INSERT INTO provider_health(tenant_id,failures) VALUES($1,1) ON CONFLICT(tenant_id) DO UPDATE SET failures=provider_health.failures+1,open_until=CASE WHEN provider_health.failures+1>=3 THEN now()+interval '5 minutes' ELSE provider_health.open_until END",
          [tenantId],
        );
      const permanent = Boolean((error as { permanent?: boolean })?.permanent);
      const failed = permanent || job.attempts >= 5;
      const message =
        error instanceof Error &&
        [
          'Tenant token budget exhausted',
          'Provider rate limit',
          'Provider request failed',
          'Malware scanner is not configured',
          'Malware scanner unavailable',
          'Malware scanner timed out',
        ].includes(error.message)
          ? error.message
          : 'Processing failed; inspect configuration and retry.';
      await db.query(
        "UPDATE jobs SET status=$2,last_error=$3,available_at=now()+($4::int * interval '1 second'),lease_until=NULL WHERE id=$1 AND lease_token=$5 AND status='running'",
        [
          job.id,
          failed ? 'failed' : 'retry_wait',
          message,
          Math.min(900, 2 ** job.attempts * 5) + Math.floor(Math.random() * 5),
          job.lease_token,
        ],
      );
      await audit(db, null, tenantId, failed ? 'job.failed' : 'job.retry', job.id);
    });
  }
  return true;
}
export async function runBatch(tenantId: string, limit = 10) {
  let n = 0;
  while (n < limit && (await runOne(tenantId))) n++;
  return n;
}
export async function maintenance(tenantId: string) {
  return transaction(tenantId, async (db) => {
    await db.query('DELETE FROM sessions WHERE expires_at<now()');
    await db.query('DELETE FROM request_limits WHERE bucket<$1', [
      Math.floor(Date.now() / 60000) - 60,
    ]);
    return retentionSweep(db, tenantId);
  });
}
