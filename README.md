# SkillShift AI

Human-reviewed workforce skills planning: map tasks, review AI exposure, identify development needs, approve a 30-day plan and verify skills through practical evidence. No automated layoffs, employee performance scoring or job-loss predictions.

The MVP implementation includes:

- OIDC login, revocable sessions, role/resource authorisation and forced PostgreSQL tenant isolation.
- Atomic CSV preview/import/export, immutable task revisions and employee/manager reviews.
- Durable outbox/jobs, optional approved AI provider, manual classification, retries, quotas and provenance.
- Versioned skill targets, unknown-aware gaps, curated learning exercises and revision-bound manager approval.
- Private evidence, malware quarantine, independent verification and scoped progress reporting.
- Privacy export, deletion ledger replay, approved-policy retention, CI and container/operations configuration.

Start with [development and deployment](docs/05-development-and-deployment.md). Progress and remaining release gates are recorded in [tasks.md](tasks.md). This is an implemented MVP awaiting production integration and pilot validation; checked engineering tasks do not imply customer approval or successful market validation.

## Run locally

Requires Node 22+, npm and Docker/PostgreSQL 17.

```sh
npm ci
cp .env.example .env
# Set matching runtime DB credentials and separate random secrets in .env.
docker compose up -d
npm run db:migrate
npm run db:provision-role
npm run db:seed
npm run dev
```

Open http://localhost:3000 and switch development personas to exercise the workflow. Production never accepts demo personas. Start `npm run worker` to process jobs; evidence requires a configured malware scanner. Missing AI configuration uses explicit manual review.

## Documentation

| Document                                                           | Purpose                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Task tracker](tasks.md)                                           | Completed implementation and open release/business work           |
| [PRD analysis](docs/01-prd-analysis.md)                            | Scope, requirements, acceptance criteria and unresolved decisions |
| [Original HLD](docs/02-hld.md)                                     | Proposed architecture baseline                                    |
| [Delivery plan](docs/03-delivery-plan.md)                          | Estimates, phases and gates                                       |
| [Architecture decisions](docs/04-decisions-and-risks.md)           | Original trade-offs and risk register                             |
| [Setup/deployment](docs/05-development-and-deployment.md)          | Local commands, Neon/Vercel and self-hosting                      |
| [Implemented architecture](docs/06-implementation-architecture.md) | Actual modules, permissions, invariants and boundaries            |
| [Operations](docs/07-operations.md)                                | Worker, secrets, monitoring, backup, rollback and privacy         |
| [Validation evidence](docs/08-validation.md)                       | Checks run and what remains unverified                            |
| [Importable backlog](backlog/tasks.csv)                            | Original T01–T17 requirements and current status                  |

The [original upload](source/original-brief.txt) contains only SkillShift AI's full PRD, despite announcing three products. Its economic reporting is context, not verified input to assessments. Buyer demand, expert rubrics, production service terms and the 30-day pilot remain external validation work.
