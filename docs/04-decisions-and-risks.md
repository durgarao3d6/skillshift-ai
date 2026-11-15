# Architecture decisions and risks

All decisions below are proposed pending implementation review.

## ADR-001 — Modular monolith with independent worker

Choose shared-domain modules with one API deployment and a separately scalable worker. This reduces operational burden for an unvalidated product while keeping slow model calls off request paths. Microservices add distributed consistency and deployment overhead without demonstrated need. Extract assessment only when independent scaling, ownership or isolation warrants it.

## ADR-002 — PostgreSQL as system of record

Use relational constraints, transactions, immutable revisions and RLS for interdependent workflow and tenant data. Object storage holds private files; queue carries job references rather than employee payloads. A document database is less convenient for approval consistency. No semantic retrieval is required by the MVP, so defer vector infrastructure.

## ADR-003 — AI suggestions with human decisions

Use versioned structured outputs, evidence-backed review and explicit uncertainty. No employee ranking or performance score. Deterministic rules own access, workflow state and skills calculations. Model outputs cannot activate plans or verify skills. This costs reviewer time but supports the PRD's human workflow and reduces unsupported employment conclusions.

## ADR-004 — Tenant isolation from the first pilot

Shared schema with tenant keys, composite FKs, forced RLS and application authorisation. A database per tenant provides stronger operational isolation but increases provisioning cost. Revisit for regulated buyers, contractual isolation requirements or residency needs.

## ADR-005 — Approval binds to immutable plan revision

Manager approval references an exact revision and assessed task/skill snapshots. Corrections mark dependent drafts stale; active plans require an explicit superseding revision and reapproval for substantive changes. Do not silently rewrite an employee's active plan after a model upgrade.

## Risk register

| Risk | Mitigation / detection | Proposed owner |
|---|---|---|
| Buyer will not pay for task-level mapping | Ten interviews, compare existing matrix, secure two partners before full build | Product |
| Incorrect or biased exposure categories | Labelled benchmark, explanation review, overrides, cohort error analysis with lawful data | AI/domain lead |
| Low completion or reviewer bottleneck | Time budget, practical exercises, review queue age and partner staffing | L&D lead |
| Employee data leakage | Minimal model input, tenant tests, private storage, redacted logs, incident drill | Security lead |
| Capability/model drift | Pinned versions, recurring evaluation and explicit migration/review | Engineering |
| Unbounded token cost | Bounded inputs, per-tenant quotas, measured cost/task and circuit breaker | Engineering |
| Wrong or unlicensed course recommendations | Curated catalogue and rights review; no invented URLs | Product |
| Skills verification mistaken for performance evaluation | Distinct statuses and UI wording; restricted access and no ranking | Product/privacy |
| CSV duplicates or lost updates | Preview, transactional import, idempotency and revision checks | Backend |
| Data residency or retention conflicts | Choose region/provider before onboarding; tested deletion and approved policy | Privacy/customer |

## Decisions needed before pilot

1. Product/L&D: category rubric, proficiency scale, evidence criteria, reviewer authority and training hours.
2. Customer/security: region, identity provider, role access scope, provider data terms and retention/deletion policy.
3. Engineering/product: quality thresholds, availability/recovery commitments, budget and catalogue ownership.
4. Product: metric treatment of withdrawn employees, approved revisions and late completions.

These items block the corresponding implementation or pilot release gate, not preparation of this planning repository.
