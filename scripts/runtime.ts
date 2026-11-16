const mode = process.argv[2];
process.argv.splice(2, 1);
delete process.env.DATABASE_URL;
delete process.env.APP_DATABASE_PASSWORD;
if (mode === 'worker') await import('./worker');
else if (mode === 'health') await import('./health');
else if (mode === 'reapply') await import('./reapply-deletions');
else throw new Error('Unknown runtime command');
