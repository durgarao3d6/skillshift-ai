# Development milestone 1

Implemented a Next.js/TypeScript workspace, responsive dashboard, CSV preview and confirmation, and PostgreSQL-backed inventory. This is a single-tenant development slice, not a production workforce platform. T02 (OIDC/RLS) remains unfinished, T03/T04 are partial; discovery and product decisions are still open. No AI classifications, learning plans or verified skills are fabricated.

## Local setup

Requires Node 22+ and Docker (or an existing PostgreSQL database).

```sh
npm ci
cp .env.example .env
cp .env.example apps/web/.env.local
docker compose up -d
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Choose sample data, preview, then confirm import. Database availability is reported separately from the page rendering. Restarting preserves inventory in the PostgreSQL volume. Re-importing the identical file is idempotent; existing employee/task IDs in changed files are skipped without overwriting data. Files with invalid rows cannot be confirmed. Preview returns at most 50 rows; inventory shows the most recent 100 and search covers only those records. Task review is not yet implemented.

All inventory APIs fail closed unless `SKILLSHIFT_DEMO_MODE=true`. This flag is not authentication. Do not expose this milestone publicly with the flag enabled or upload real employee data. Use an authenticated deployment preview for demonstrations. No application roles, production tenant access controls, audit trail or rate limiting are implemented yet. Migrations are idempotent for this initial schema; backup before future migration changes.

## Free-tier deployment proposal

Recommended first slice: Vercel (Next.js UI + API) and Neon (PostgreSQL). A separate backend host is unnecessary for these short database/API requests. The `pg` pool uses a maximum of three connections per function instance; use Neon's pooled application URL and review total connection limits. Use the direct URL for migrations when recommended by the provider. Keep the URL's required TLS parameters and never disable certificate verification.

1. Create a Neon database in the chosen region. Keep real employee data out until privacy/provider agreements are complete.
2. Apply `db/001-inventory.sql` in Neon's SQL editor or run `npm run db:migrate` with the database URL in your local `.env`.
3. Import this GitHub repository into Vercel. Set **Root Directory** to `apps/web`; framework preset Next.js. Retain access to workspace files outside the root if Vercel requests this for the npm workspace. Build command: `npm run build`; output directory: Next.js default.
4. Set `DATABASE_URL` in Vercel environment variables. For an access-protected synthetic-data preview only, set `SKILLSHIFT_DEMO_MODE=true`. Otherwise leave it unset and the data APIs will remain disabled.
5. Enable available deployment authentication before exposing a demo. If access protection is unavailable on your plan, keep the demo local rather than enabling unauthenticated inventory endpoints.
6. Redeploy after changing environment variables. Run schema migration explicitly; builds never mutate the database.

Vercel request body and function duration limits may be lower than the app's 10 MB / 5,000-row local limits. Use small sample files on Vercel; bulk imports require direct private object uploads and a background worker before production. Transactional row-by-row import is intentionally simple and must be benchmarked or replaced with batched insertion for larger pilots.

### Other options

| Service | Use | Main consideration |
| --- | --- | --- |
| Neon | Managed PostgreSQL | Free-tier compute/storage and idle behaviour vary; pooled connections recommended |
| Supabase | Managed PostgreSQL plus optional auth/storage | Free quotas and inactivity policies; adopting its auth requires a separate implementation |
| Vercel | Next.js frontend and short API routes | Verify current Hobby commercial-use eligibility and quotas |
| Render | Separate Node API | Free services may sleep; check worker availability separately |
| Coolify + PostgreSQL + Caddy | Open-source self-hosted deployment | Software free, but hardware/VPS, backups and operations are your responsibility |

These are proposed choices, not verified current prices or account entitlements. A free plan is not an availability, backup or long-term cost guarantee. No external hosting project has been created or deployed by this milestone.

## Next milestone

Implement OIDC, scoped membership and transaction-local PostgreSQL RLS on a non-owner application role, with cross-tenant integration tests. Then add task revisions, employee review and auditable import metadata. Only after those foundations should the assessment worker and provider integration begin. Introduce a standalone NestJS API when the worker/integration workload justifies it; this first UI/API slice uses Next.js route handlers to simplify free-tier hosting (a deliberate staging adjustment to the HLD).
