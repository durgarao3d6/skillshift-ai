# Implemented MVP architecture

This document supersedes the planning-only status in the original HLD. The planning requirements remain the product baseline; the architecture decisions below reflect the actual repository.

## Components

- Next.js 16, React 19 and TypeScript implement the web app and Node API route handlers. A separate NestJS API is deferred because route handlers cover the MVP without a second API host.
- PostgreSQL stores identities, memberships, task snapshots, human reviews, assessments, skills, plans, evidence metadata, audit events, outbox and jobs. All tenant-owned tables use forced RLS and transaction-local tenant context. Runtime refuses superuser or BYPASSRLS credentials.
- A persistent Node worker dispatches the transactional outbox and leases PostgreSQL jobs. `SKIP LOCKED`, a tenant claim lock, lease tokens and unique idempotency keys provide bounded, repeatable processing. A separate external queue is deferred.
- An approved OpenAI-compatible provider is optional. No provider, model or processing approval means explicit manual-review uncertainty, not a simulated AI decision. Production endpoints require HTTPS. Model confidence is uncalibrated. Structured output, employment-recommendation rejection, redaction, token reservations, concurrency limits, circuit breaker and five-attempt retries constrain execution.
- Private encrypted S3 storage holds evidence and an external deletion ledger. Local private filesystem storage exists only for development; production rejects it. ClamAV's INSTREAM protocol scans evidence. Scanner failures leave evidence quarantined and inaccessible.

## Identity and access

OIDC discovery uses an exact issuer. Login uses PKCE S256, random state and nonce, an encrypted ten-minute flow cookie, signature/audience/issuer checks and an eight-hour signed session backed by a revocable database row. Cookies are HttpOnly, SameSite=Lax and Secure in production. No self-service signup or role escalation exists. Provision memberships with the schema-owner CLI.

An identity record belongs to one tenant; the same OIDC subject can have separately provisioned identities in multiple tenants. API authentication reloads membership and checks session validity on every request. Database tenant context is set only from a verified session or a development-only fixed persona. Production ignores demo personas even when their flag is set.

HR/admin import inventory and set role targets. Employees see and correct their own tasks. Managers see assigned employees. Employees or assigned managers review task maps; an assigned manager reviews assessment categories and approves the exact plan revision. Employees cannot approve their own plans. Evidence is visible only to its employee and designated independent reviewer; HR can see progress without reading private files. Reviewer assignment is recorded at upload.

## Version and workflow invariants

Corrections append immutable task versions and make assessments and open plans stale. Human assessment decisions have append-only review history. Model/prompt/rubric versions, hashes and token usage are recorded for provider suggestions. A worker never overwrites a human-reviewed assessment.

Plans snapshot accepted tasks, reviewed assessments and skill targets. New revisions append immutable plan snapshots, reset approval and preserve older activities/approvals. Approval checks exact revision, current task snapshot, stale state and manager assignment. Dates cover 30 calendar days (start through start + 29 days). Activities respect the declared weekly time budget. A completed plan is preserved; create a new plan for a new development cycle.

Completing an activity records participation. An independent reviewer must inspect clean evidence against the activity's snapshotted rubric to verify proficiency. Self-reports cannot write verified proficiency. Verified levels expire after 180 days in gap calculations; expiration and rubric suitability require domain-owner approval before pilot.

## Metrics and performance

First reviewed employee/role-map revisions define initial acceptance (an initial correction records rejection of the original map), so repeated corrections cannot inflate the denominator. Approved employee cohorts define completion; withdrawals stay in the denominator. Privacy deletion removes the subject and excludes their data from subsequent reports. Reports distinguish activity completion from verified skills and label unfinished observation windows as provisional.

Inventory is cursor-paginated at 100 rows with server search; the workspace overview is bounded to 200 tasks, 100 plans, 1,000 current activities and 100 evidence/jobs. Inventory aggregate counts use a two-second in-process cache keyed by tenant and access scope; imports/deletions invalidate after commit. Other processes converge within the TTL. The employee-focus control loads an authorised employee’s workflow independently of the overview bounds. These limits are explicit, not a claim that the overview lists every employee in a large pilot.

## Privacy and failure behaviour

CSV data is validated in memory and never stored as a raw upload. Imports are atomic; duplicate files and existing employee/task IDs are idempotently skipped. CSV export neutralises formula prefixes. Database and object-storage operations have rollback compensation for newly uploaded evidence.

Self/authorised HR deletion requests create background jobs. Legal holds block deletion. Before deleting files and employee records, the worker writes an external ledger containing an HMAC of the employee ID and opaque tenant ID. Restoration must reapply that ledger before traffic resumes. Audit events retain only opaque actor/resource IDs, action and timestamp; they are immutable to the app role. Separate customer-approved audit retention remains an operational decision.

Retention sweeps are disabled until an administrator records an approved policy. They remove evidence after the plan's end plus the configured retention period; legal holds pause sweeps. Backup expiry, provider retention and bucket lifecycle are deployment responsibilities documented in the operations guide.

## API surfaces

`/api/auth/login`, `/callback`, `/logout`; authenticated `/api/imports` and `/api/inventory`; `/api/workspace/state`, `/inventory`, `/export`, `/report`, `/members`, `/evidence/{id}`, `/privacy/export`; POST actions cover tasks, assessments, skills, plans, activities, evidence, privacy requests, manager assignment, policy and job management. Schemas are in `lib/server/domain.ts` and adjacent modules. No request accepts a client-selected tenant ID for domain operations.

Errors have a request ID and stable HTTP semantics: 401 authentication, 403 permission, 404 inaccessible resource, 409 stale/invalid workflow state, 413 size, 422 validation, 429 quota, 503 dependency failure. Unexpected errors log type and request ID, not task text, files or credentials.

## Boundaries of validation

Automated tests use real PostgreSQL with restricted credentials, a synthetic OIDC issuer and controlled provider/scanner fixtures. They exercise protocol/error behaviour, not real customer IdP/provider/S3/ClamAV service entitlements. Static axe checks cannot prove contrast, visual layout or keyboard behaviour in a browser. Deployment integration, expert-labelled quality thresholds, buyer research and actual pilot outcomes remain release work in `tasks.md`.
