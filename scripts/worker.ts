import { pool } from '../apps/web/lib/server/core';
import { runBatch, maintenance } from '../apps/web/lib/server/worker';
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
const once = process.argv.includes('--once');
const configured = process.env.WORKER_TENANTS?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
if (!configured?.length) throw new Error('WORKER_TENANTS must explicitly list tenant UUIDs.');
try {
  do {
    const tenants = configured;
    let processed = 0;
    for (const tenant of tenants) {
      try {
        processed += await runBatch(tenant, 10);
        await maintenance(tenant);
      } catch {
        console.error(JSON.stringify({ event: 'worker_tenant_failed', tenantId: tenant }));
        if (once) process.exitCode = 1;
      }
    }
    console.log(JSON.stringify({ event: 'worker_tick', processed }));
    if (once) break;
    if (!stopping)
      await new Promise((resolve) =>
        setTimeout(resolve, Number(process.env.WORKER_POLL_MS || 2000)),
      );
  } while (!stopping);
} finally {
  await pool().end();
}
