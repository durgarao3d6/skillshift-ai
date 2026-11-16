# SkillShift AI implementation tracker

Status baseline: 16 November 2026. A checked task means its stated implementation and verification are finished; it does not imply customer approval or a successful pilot.

## Development

- [x] D01 — OIDC login, signed sessions, tenant membership, scoped access and forced PostgreSQL RLS (T02).
- [x] D02 — Versioned domain schema, taxonomy, migrations, audit and outbox (T03).
- [x] D03 — Authenticated CSV preview/import/export with atomicity and idempotency (T04).
- [x] D04 — Employee task corrections, manager decisions, concurrency and stale-result handling (T05).
- [x] D05 — Durable background jobs, provider adapter, quotas, retries, leases and recovery (T06).
- [x] D06 — Explainable assessment review and benchmark tooling (implementation portion of T07).
- [x] D07 — Skills self-report, verified proficiency and deterministic gap calculation (T08).
- [x] D08 — 30-day plans, revisions and assigned-manager approval (T09).
- [x] D09 — Private evidence, quarantine/scanning, completion and independent verification (T10).
- [x] D10 — Scoped manager reporting and documented metric denominators (T11).
- [x] D11 — Privacy export, deletion ledger, retention and restore reapplication (implementation portion of T12).
- [x] D12 — Security, abuse, cross-tenant and workflow integration tests (T13).
- [x] D13 — Automated workflow, accessibility and load validation tooling (implementation portion of T14).
- [x] D14 — CI, web/worker container builds, non-root image checks, operations and restore/rollback runbooks (implementation portion of T15).
- [x] D15 — Functional UI for inventory, reviews, assessment, skills, plans, evidence, reporting and privacy.

## Open technical release gates

- [ ] P01 — Validate the <500 ms read p95 on the selected deployed host. A fresh local reference profile with ten connections passed at 251 ms p95 for 50 users; the five-connection profile still needs tuning (732 ms p95). See [validation evidence](docs/08-validation.md).
- [ ] P02 — Validate the 100-task AI batch target with an approved live provider and expert-reviewed benchmark.
- [ ] P03 — Test the actual customer IdP, private S3 bucket, ClamAV service and backup/ledger recovery on the deployed host.

## External release work — cannot be truthfully checked by writing code

- [ ] T01 — Conduct ten interviews and secure two design partners.
- [ ] T07 — Domain experts label the five-role benchmark and approve quality thresholds.
- [ ] T12 — Customer approves privacy terms, retention, data region and provider contracts.
- [ ] T14 — Complete browser/manual accessibility review and HTTP-level load validation on the selected deployment; the local ten-connection reference profile passes the proposed read target.
- [ ] T15 — Provision production services/secrets and rehearse customer-approved recovery targets there.
- [ ] T16 — Obtain release sign-off, onboard two partner tenants and train their reviewers.
- [ ] T17 — Observe the 30-day pilot and report actual adoption and buyer payment decisions.

## Verification evidence

- 18 automated tests pass against real PostgreSQL using restricted runtime credentials, with no skipped integration tests.
- [GitHub Actions](https://github.com/durgarao3d6/skillshift-ai/actions) verifies the application suite and both container builds, including non-root image users.
- Static axe checks pass across sign-in and nine workspace screens; browser-only checks remain above.
- Type checking, formatting and dependency audit pass; zero dependency vulnerabilities at the recorded check.
- Local dump/restore matches 320,000 tasks and 320,000 versions. Deletion reapplication is covered separately.
- [Validation report](docs/08-validation.md) records exact load observations, container environment limits and external verification boundaries.
- [Setup/deployment](docs/05-development-and-deployment.md), [implemented architecture](docs/06-implementation-architecture.md), and [operations](docs/07-operations.md) describe the delivered application.

Original backlog rows remain uncompleted where their acceptance criteria require interviews, expert labels, production rehearsal or actual pilot outcomes. Development checkboxes above describe verified implementation; they do not replace those requirements.
