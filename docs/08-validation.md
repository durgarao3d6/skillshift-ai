# Validation evidence

Validation date: 16 November 2026. All data used for checks is synthetic. This records observed results, not a production certification.

## Automated checks

- 18 automated tests pass with real PostgreSQL 17, restricted runtime credentials and no skipped integration tests.
- The employee → manager → evidence workflow covers task correction/review, queued manual fallback, independent classification, unknown-aware gaps, stale revision rejection, 30-day approval, completion versus verification, scoped reports, privacy export/deletion and restore-time deletion replay.
- Security checks cover cross-tenant reads/writes/resource IDs, forced RLS, connection-context clearing, privileged-runtime rejection, CSRF origin, CSV formula escaping, transactional rollback, immutable snapshots, upload validation, quarantine, malware protocol responses, private paths and compensation of failed evidence writes.
- OIDC tests use a signed synthetic issuer and verify PKCE, state/nonce, session signatures/expiry, logout revocation and production rejection of demo personas.
- Provider/worker tests cover identifier redaction, strict output validation, unsupported employment recommendations, malformed responses, outage retries, circuit opening, quotas, outbox re-dispatch, lease expiry/exhaustion and job cancellation/retry.
- Static axe checks pass for sign-in and all nine workspace screens. Contrast/layout checks are excluded because they require an actual browser; visual and keyboard review remains open.
- Type checks, source formatting and production dependency audit pass; the full dependency audit reports zero vulnerabilities at validation time. Dependency audits are point-in-time checks.
- The Next.js production build has passed locally. GitHub Actions also runs the complete tests/type/build suite and separate web/worker container checks for the pushed revision.

## Container validation

The local environment's normal inner-container npm request failed; using the documented session CA as a BuildKit secret restored package installation with TLS verification enabled. The rootless Docker VFS build then ran out of disk while copying the dependency layer. Unused validation build cache was removed; source and PostgreSQL volumes were preserved. No session proxy CA or credentials are tracked in this repository.

The production Dockerfile is validated in the `containers` GitHub Actions job on a standard runner: web and worker images build; the standalone server file passes Node syntax validation; image users are asserted to be non-root. This does not claim live production deployment or real S3/ClamAV/provider integration.

## Load observations — target remains open

The harness seeds two active tenants, each with 1,000 synthetic employees and 20 tasks per employee, and issues inventory requests from 50 distinct concurrent users. It explicitly reports cold/warm phases and exits nonzero when the proposed 500 ms p95 target is missed. It measures the in-process API plus PostgreSQL, excluding public HTTP/browser latency. Use a fresh isolated `*_load` database for each reproducible run.

Latest recorded run with pool size 20:

| Measure                      | Observed              |
| ---------------------------- | --------------------- |
| Warmup requests / failures   | 50 / 0                |
| Cold p95                     | 899 ms                |
| Measured requests / failures | 500 / 0               |
| Measured p50 / p95           | 550 / 694 ms          |
| Proposed ordinary-read p95   | <500 ms — **not met** |

Earlier runs varied with pool size and shared-environment load; no result is presented as a production SLO guarantee. A two-second, tenant/scope-keyed aggregate-count cache and fewer authentication round trips improved the initial slow summary path, but the release performance gate remains open. The default pool remains five connections per instance to avoid assuming a free-tier connection budget. Tune against the selected deployment and total connection limits, then rerun HTTP-level load tests before promising pilot capacity. The 100-task live-provider batch target has not been validated without an approved provider.

## Backup/restore exercise

An isolated PostgreSQL custom-format dump and restore completed locally:

| Measure                               | Observed         |
| ------------------------------------- | ---------------- |
| Inventory tasks in source and restore | 320,000 each     |
| Task versions in source and restore   | 320,000 each     |
| Migrations at backup snapshot         | 6 each           |
| Dump duration                         | 5.25 s           |
| Restore duration                      | 6.70 s           |
| Dump size                             | 16,368,050 bytes |

The seventh migration was applied after the snapshot; recovery procedures explicitly apply migrations before reopening. The separate integration test reintroduces a deleted employee record and verifies external-ledger replay deletes it again. This local exercise does not establish the customer's production RPO/RTO, object-store recovery, backup expiry or provider retention compliance.

## Quality and external checks

Five synthetic role cases are supplied for smoke evaluation. Tentative categories are not expert labels. The evaluator can score a separately supplied expert-reviewed benchmark with agreed thresholds; the included smoke fixture cannot pass the release quality gate. No interviews, design-partner approvals, customer IdP/provider/storage/scanner entitlements, production deployment, real learning completions or buyer payment decisions are invented.

The remaining external and performance gates are explicit in [tasks.md](../tasks.md).
