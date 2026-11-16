import { spawn } from 'node:child_process';
const file = process.argv[2];
if (
  !file ||
  !process.env.DATABASE_URL ||
  process.env.RESTORE_CONFIRM !== 'RESTORE_ISOLATED_DATABASE'
)
  throw new Error(
    'Requires dump path, DATABASE_URL for a NEW isolated database and RESTORE_CONFIRM=RESTORE_ISOLATED_DATABASE.',
  );
const u = new URL(process.env.DATABASE_URL);
if (!u.pathname.includes('_restore'))
  throw new Error(
    'Target database name must contain _restore. Never restore over the active database.',
  );
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || '5432',
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
  PGDATABASE: u.pathname.slice(1),
  PGSSLMODE: u.searchParams.get('sslmode') || 'prefer',
};
delete env.DATABASE_URL;
const child = spawn(
  'pg_restore',
  ['--no-owner', '--exit-on-error', '--dbname', env.PGDATABASE, file],
  { env, stdio: 'inherit' },
);
child.on('error', () => {
  console.error('pg_restore could not start');
  process.exitCode = 1;
});
child.on('exit', (code) => (process.exitCode = code || 0));
