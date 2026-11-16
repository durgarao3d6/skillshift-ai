import { pool, transaction } from '../apps/web/lib/server/core';
const tenants = process.env.WORKER_TENANTS?.split(',').filter(Boolean);
if (!tenants?.length) throw new Error('WORKER_TENANTS is required.');
try {
  for (const tenantId of tenants) {
    const result = await transaction(tenantId, async (db) => {
      const jobs = (
        await db.query(
          'SELECT status,count(*)::int AS count,max(extract(epoch FROM(now()-created_at)))::int AS oldest_seconds FROM jobs GROUP BY status',
        )
      ).rows;
      const outbox = (
        await db.query(
          'SELECT count(*)::int AS pending FROM outbox_events WHERE delivered_at IS NULL',
        )
      ).rows[0];
      const budget = (
        await db.query('SELECT used_tokens FROM token_budgets WHERE day=CURRENT_DATE')
      ).rows[0];
      const circuit = (await db.query('SELECT failures,open_until FROM provider_health')).rows[0];
      return { jobs, outbox, estimatedReservedTokens: budget?.used_tokens || 0, circuit };
    });
    console.log(JSON.stringify({ tenantId, ...result }));
    if (
      result.jobs.some(
        (j) =>
          j.status === 'failed' ||
          (['queued', 'retry_wait'].includes(j.status) && j.oldest_seconds > 600),
      )
    )
      process.exitCode = 1;
  }
} finally {
  await pool().end();
}
