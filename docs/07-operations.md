# Operations and release runbooks

## Credentials and environments

Keep dev, staging and production in separate databases/buckets/IdP clients. Migration credentials own the schema; runtime credentials must be non-owner, NOSUPERUSER and NOBYPASSRLS. Provision with `scripts/provision-role.mjs` after migrations. Do not grant runtime membership in privileged roles. The app checks role flags when each pooled connection is first used. Every request/job sets tenant context inside a transaction and clears it on commit/rollback. Only the authentication rate-counter transaction uses asynchronous commit; a crash can lose recent request counts. Sessions, approvals, token budgets, audit and other domain writes explicitly use synchronous commits.

Use secret managers for runtime secrets, rotate session signing secrets to invalidate cookies, and revoke sessions/memberships when offboarding. Preserve `DELETION_HMAC_SECRET` separately and durably: changing it without migrating the ledger prevents restore-time deletion matching. Configure current provider contract, region, retention and training restrictions before setting `AI_DATA_PROCESSING_APPROVED=true`.

`ops/compose.production.yaml` provides web, worker and private ClamAV services. It expects an untracked `.env.production`, managed/private PostgreSQL and encrypted S3. Build only immutable tagged images; deploy a reviewed commit. Caddy supplies HTTPS for self-hosting. On Vercel, deploy the Next.js workspace and use a separate persistent worker host. No production services have been provisioned by this code change.

## Worker operations

`npm run worker` runs the durable worker; `npm run worker:once` drains at most ten jobs per tenant. `WORKER_TENANTS` must explicitly list its authorised tenant IDs. Outbox dispatch and job insertion commit atomically; dispatch can safely repeat. Jobs are at least once, with unique keys, two-minute leases, fencing tokens, five attempts and capped exponential backoff/jitter. Expired leases are recoverable; exhausted jobs are retained as failed for operator inspection.

Manual job retry/cancellation is available to HR/admin. Cancellation fences result persistence but cannot undo an already-started remote request or its provider charge. The per-tenant circuit opens for five minutes after three actual provider failures. Jobs waiting for the circuit defer until its existing expiry without extending the cooldown or consuming a provider-attempt slot; token-budget rejection does not count as a provider failure. A configured daily budget reserves a conservative token estimate before each provider attempt; this is not an exact dollar-cost meter. Actual response token usage is stored with assessments. Configure provider-side limits as a second guard.

On provider outage, inspect jobs/circuit, confirm endpoint/credentials and wait for recovery. Assigned managers can classify accepted tasks manually while AI is unavailable. Do not change model/rubric versions without evaluating and explicitly reviewing affected task maps/plans. On scanner outage, preserve quarantine and fix the scanner; never mark unscanned files clean. On infected evidence, leave downloads blocked, notify the owning organisation through its agreed incident process and follow its retention policy.

## Monitoring

`npm run health` emits tenant job counts, oldest ages, outbox backlog, reserved tokens and circuit state as JSON; it exits nonzero for failed jobs or queue age above ten minutes. Send output and redacted application logs to an operator-controlled monitoring system. Configure alerts for sustained 5xx, queue/outbox lag, failed scans, budget exhaustion, failed backups and database/storage capacity. Restrict log access; never log task text, file bodies, tokens or database URLs.

Initial proposed targets remain 99.5% monthly availability, ordinary reads p95 <500 ms, assessment batches of 100 tasks within ten minutes when provider is healthy, RPO 24 hours and RTO eight hours. Customer acceptance, real-host HTTP load tests and provider benchmarks remain release gates. In-process measurements do not prove public-network latency or availability.

## Backup and restore

Use managed PostgreSQL PITR plus a daily encrypted off-site dump according to the approved policy. Monitor backup age and failures. Back up evidence separately with an approved lifecycle; the deletion ledger must survive database restores and must not be rolled back with a database snapshot. Private objects and dumps contain confidential data; restrict access and expire them on schedule. Do not assume any free tier provides adequate PITR or retention.

With PostgreSQL client tools installed, `npm run db:backup -- /secure/path/backup.dump` uses the schema-owner URL from the local admin environment. Passwords are passed to child processes in environment variables, not command arguments. Transfer dumps using encrypted storage and least-privilege access.

Restore rehearsal:

1. Stop traffic to the recovery environment. Create a new isolated database with `_restore` in its name; do not overwrite the active database.
2. Point the administrator `DATABASE_URL` at the new database. Set `RESTORE_CONFIRM=RESTORE_ISOLATED_DATABASE` and run `npm run db:restore -- /secure/path/backup.dump`.
3. Run migrations and restricted-role provisioning against the recovered database. Point its runtime `APP_DATABASE_URL` at that database.
4. Reconnect the CURRENT external deletion ledger and preserved HMAC secret. For every tenant, run `npm run deletions:reapply -- <tenant-uuid>` before exposing any restored data. Expire old session rows or rotate the session secret before reopening.
5. Validate tenant isolation, schema version, known row counts, object availability, deletion reapplication and a synthetic employee/manager workflow. Reconcile orphan objects against the deletion ledger and storage records if a previous storage operation failed compensation.
6. Record backup timestamp, actual RPO/RTO, checks and operator sign-off. Switch traffic only after checks pass. Keep the old database isolated until the retention policy permits removal.

The test suite simulates deleted records reappearing and verifies ledger replay. A local database dump/restore exercise is reported in `08-validation.md`; it does not replace a rehearsal on the selected production provider and object store.

## Rollback

Migrations are numbered, tracked in Git and recorded in `schema_migrations`; a PostgreSQL advisory lock serialises migration runs. They are additive for this release. Application images must remain compatible with the deployed schema. Roll back to the last compatible image; never blindly drop tables/columns as a rollback. Reverting to the original development-only API is unsafe for a live employee tenant and is not a supported production rollback.

For an irreversible data problem, restore to a new database and follow the deletion-reapplication procedure above. Test on staging first. Worker and web should use the same reviewed schema/rubric version.

## Incident response and privacy

For suspected tenant leakage: restrict ingress, revoke affected sessions, pause workers, preserve minimal audit records, scope affected tenant/resource IDs and follow the organisation's notification requirements. Do not export employee records into tickets or logs.

Self/authorised HR requests delete employee-linked identities, task history, assessments/reviews, skills, plans, evidence and cohort entries. Audit records retain opaque IDs/action/time under a separately approved audit policy. Legal holds block deletion and retention sweeps; holds must be resolved through the customer's policy process. Data already sent to an external model provider is governed by that provider contract and requires its documented deletion/retention process; the app cannot retroactively erase a provider's logs through this adapter.

Evidence retention is disabled until a tenant policy is explicitly configured. Raw CSV uploads are never retained. Review storage usage and stale quarantines; failed storage-compensation events require operator reconciliation. Product-level privacy approval and backup expiry remain external release work.
