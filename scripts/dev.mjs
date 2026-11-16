import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = { ...process.env };
delete env.DATABASE_URL;
delete env.APP_DATABASE_PASSWORD;
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev'], {
  cwd: new URL('../apps/web/', import.meta.url),
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => (process.exitCode = code || 0));
