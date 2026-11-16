# Development and deployment

The MVP now includes authentication, task and assessment reviews, skills gaps, revisioned learning plans, evidence, reporting and privacy workflows. See [implemented architecture](06-implementation-architecture.md), [operations](07-operations.md) and [tasks](../tasks.md).

## Local development

Requires Node 22+, npm and Docker or PostgreSQL 17.

```sh
npm ci
cp .env.example .env
# Edit APP_DATABASE_PASSWORD and the password in APP_DATABASE_URL to match.
# Replace SESSION_SECRET and DELETION_HMAC_SECRET with separate random secrets.
docker compose up -d
npm run db:migrate
npm run db:provision-role
npm run db:seed
npm run dev
```

Open http://localhost:3000. Development mode offers HR, employee, manager, reviewer and admin personas. The seed contains five synthetic roles and assigns their manager. Demo personas are disabled unconditionally in production. The dev launcher reads the root `.env` and removes schema-owner credentials before starting Next.js; do not copy the owner URL into Vercel or web/worker runtime configuration.

Try the full workflow:

1. Employee accepts or corrects their task in Inventory.
2. Employee queues an assessment; HR runs the development job button or `npm run worker:once`.
3. Manager reviews the assessment. Missing provider configuration explicitly requires manual classification.
4. Employee self-reports proficiency, generates a draft and waits for assigned-manager approval.
5. Manager approves a start date; employee completes exercises and submits text/PDF evidence.
6. Run a configured ClamAV scanner and worker. The manager downloads clean evidence and records a rubric decision.
7. Compare activity completion and verified skills in Team report. Test privacy export/deletion using synthetic data.

Start a persistent worker with `npm run worker`. Configure `CLAMD_HOST` and a real scanner to process uploads; no bypass switch declares files clean. For local standalone ClamAV, run it on a private Docker network or bind its port to loopback and keep it off public networks. Without a scanner, evidence remains quarantined.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Integration tests require `RUN_DB_TESTS=true`, the schema-owner `DATABASE_URL` for isolated fixtures and restricted `APP_DATABASE_URL` for application queries. CI provisions PostgreSQL, migrations and the app role, then runs the complete suite. Tests create synthetic tenants; use a disposable test database. Static accessibility tests exclude contrast/layout and require follow-up browser review.

`npm run evaluate` runs five synthetic role smoke cases. They are not expert labels and cannot pass the release quality gate. An approved provider is optional; set `AI_DATA_PROCESSING_APPROVED=true` only after the customer approves provider terms and task-text processing. Regex redaction removes common identifiers but cannot guarantee anonymisation of arbitrary prose; do not send unreviewed personal/confidential text.

## Neon + Vercel + worker

Recommended hosted layout: Neon PostgreSQL, Vercel for Next.js UI/API, private S3-compatible storage, and a persistent Node worker plus ClamAV on a host you control. Vercel alone does not run the durable worker. Render or another worker host can run it if its plan supports persistent workers and the scanner's memory needs. Free web-service tiers may sleep; do not assume free worker hosting.

1. Create a PostgreSQL database in the customer-approved region. Run migrations with its schema-owner URL, then provision a separate runtime role. On a provider without role-creation permission, create an equivalent non-owner NOSUPERUSER/NOBYPASSRLS role through its admin UI and grant only the tables in `scripts/provision-role.mjs`.
2. Use the pooled runtime URL as `APP_DATABASE_URL`. Preserve required TLS options; never disable certificate verification. Keep the owner URL only on a trusted migration workstation/CI secret, never in web/worker runtime.
3. Import this repository into Vercel; root directory `apps/web`, Next.js preset, default output and `npm run build`. Enable access to workspace files outside the root if prompted by the npm-workspace configuration.
4. Configure `APP_DATABASE_URL`, `SESSION_SECRET`, `DELETION_HMAC_SECRET`, `APP_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional client secret and private storage credentials. Register the exact HTTPS `/api/auth/callback` URI with your IdP. Production never accepts demo identities.
5. Provision each tenant/user through `scripts/provision-user.mjs`; use the OIDC subject, not email as identity. HR assigns managers/reviewers and role targets in the app.
6. Give web/worker access to a private encrypted S3 bucket with public access blocked. Restrict IAM to required prefixes and actions. Keep deletion ledger storage and its HMAC secret independent of DB backups, encrypted and durable.
7. Deploy `Dockerfile` target `worker` with runtime secrets, `WORKER_TENANTS` and a private ClamAV endpoint. Deploy target `web` if self-hosting instead of Vercel. `ops/compose.production.yaml` and `ops/Caddyfile` provide self-hosting examples.
8. Run the smoke workflow, health checks and restore procedure before adding real employees. Configure retention only after customer approval.

Vercel request limits can be below local 10 MB CSV / 5 MB file limits, particularly after JSON/base64 overhead. Use small uploads on that host; larger files require a platform with suitable limits or a future direct-upload flow. Import is batched in PostgreSQL and never runs AI synchronously. Provider assessment batches run on the worker.

## Free-tier choices

| Service                            | Suitable use                                  | Check before choosing                                                                                           |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Neon                               | Managed PostgreSQL                            | Current storage/compute quotas, pooling, idle behaviour and backup coverage                                     |
| Supabase                           | Managed PostgreSQL plus optional auth/storage | Current free quotas/inactivity; this implementation uses generic OIDC and S3 interfaces, not Supabase auth APIs |
| Vercel                             | Next.js UI and short API requests             | Current Hobby commercial-use terms, execution/body limits and quotas                                            |
| Render                             | Separate worker/API host where supported      | Persistent worker eligibility, sleeping policies and scanner resources                                          |
| Coolify, PostgreSQL, Caddy, ClamAV | Open-source self-hosted stack                 | Software is free; hardware/VPS, backups and operations may cost money                                           |

These are deployment options, not verified current pricing or entitlements. No external hosting account or service has been provisioned by this development work. A real employee pilot should not depend on an unverified claim that every required service is free.
