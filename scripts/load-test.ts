import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GET } from '../apps/web/app/api/inventory/route';
import { fixture } from '../apps/web/tests/helpers';
import { pool } from '../apps/web/lib/server/core';
if (
  process.env.LOAD_TEST_CONFIRM_SYNTHETIC !== 'YES' ||
  !new URL(process.env.DATABASE_URL || 'http://invalid').pathname.includes('_load') ||
  process.env.NODE_ENV === 'production'
)
  throw new Error(
    'Run only against an isolated *_load database with LOAD_TEST_CONFIRM_SYNTHETIC=YES.',
  );
const fixtures = await Promise.all([fixture(), fixture()]);
const samples: number[] = [];
let failures = 0;
try {
  for (const f of fixtures) {
    await f.admin.query(
      `INSERT INTO inventory_tasks(id,tenant_id,employee_external_id,role_name,task_external_id,task_description,skill_tags) SELECT gen_random_uuid(),$1,'EMP-'||e,'Engineer','TASK-'||t,'Validate and document synthetic test case '||t,ARRAY['testing'] FROM generate_series(1,1000)e CROSS JOIN generate_series(1,20)t`,
      [f.tenantId],
    );
    await f.admin.query(
      'INSERT INTO task_versions(tenant_id,task_id,revision,description,role_name,skill_tags) SELECT tenant_id,id,revision,task_description,role_name,skill_tags FROM inventory_tasks WHERE tenant_id=$1',
      [f.tenantId],
    );
  }
  const requests: Request[] = [];
  for (let i = 0; i < 50; i++) {
    const f = fixtures[i % 2],
      userId = randomUUID(),
      key = 'load-user-' + i;
    await f.admin.query(
      "INSERT INTO app_users(id,tenant_id,issuer,subject,display_name) VALUES($1,$2,'urn:load',$3,'Synthetic load user')",
      [userId, f.tenantId, key],
    );
    await f.admin.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'hr')", [
      f.tenantId,
      userId,
    ]);
    f.users[key] = {
      tenantId: f.tenantId,
      userId,
      role: 'hr',
      employeeId: null,
      displayName: 'Synthetic load user',
    };
    requests.push(await f.request(key, '/api/inventory'));
  }
  const coldSamples: number[] = [];
  let coldFailures = 0;
  await Promise.all(
    requests.map(async (request) => {
      const start = performance.now();
      const r = await GET(request.clone());
      await r.arrayBuffer();
      coldSamples.push(performance.now() - start);
      if (r.status !== 200) coldFailures++;
    }),
  );
  coldSamples.sort((a, b) => a - b);
  await Promise.all(
    requests.map(async (request) => {
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const response = await GET(request.clone());
        await response.arrayBuffer();
        samples.push(performance.now() - start);
        if (response.status !== 200) failures++;
      }
    }),
  );
  samples.sort((a, b) => a - b);
  const result = {
    scope: 'In-process API + PostgreSQL, excludes public-network/browser latency',
    tenants: 2,
    employeesPerTenant: 1000,
    tasksPerEmployee: 20,
    concurrency: 50,
    distinctUsers: 50,
    poolSize: Number(process.env.DB_POOL_MAX || 5),
    warmupRequests: coldSamples.length,
    warmupFailures: coldFailures,
    coldP95Ms: Math.round(coldSamples[Math.floor(coldSamples.length * 0.95)]),
    requests: samples.length,
    failures,
    p50Ms: Math.round(samples[Math.floor(samples.length * 0.5)]),
    p95Ms: Math.round(samples[Math.floor(samples.length * 0.95)]),
    proposedReadTargetMs: 500,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures || result.p95Ms > 500) process.exitCode = 1;
} finally {
  for (const f of fixtures) await f.admin.end();
  await pool().end();
}
