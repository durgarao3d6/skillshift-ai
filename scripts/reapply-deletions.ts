import { transaction, pool } from '../apps/web/lib/server/core';
import { reapplyDeletionLedger } from '../apps/web/lib/server/privacy';
const tenant = process.argv[2];
if (!tenant)
  throw new Error('Pass tenant UUID. Run before reopening restored database to traffic.');
try {
  const count = await transaction(tenant, (db) => reapplyDeletionLedger(db, tenant));
  console.log(JSON.stringify({ reapplied: count }));
} finally {
  await pool().end();
}
