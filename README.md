# SkillShift AI — Architecture and delivery plan

Planning baseline, 15 November 2026. This repository contains PRD analysis, a high-level design (HLD), and an implementation backlog. It does not contain a working application.

## Read in order

1. [PRD analysis](docs/01-prd-analysis.md): scope, gaps, acceptance criteria and traceability.
2. [High-level design](docs/02-hld.md): components, workflows, data, API, security and operations.
3. [Delivery plan](docs/03-delivery-plan.md): phases, dependencies, estimates and release gates.
4. [Architecture decisions](docs/04-decisions-and-risks.md): rationale, alternatives, risks and decisions needed.
5. [Task backlog](backlog/tasks.csv): importable tasks with acceptance criteria and estimates.

[Original upload](source/original-brief.txt) is preserved for provenance. Its economic reporting is context, not verified architectural evidence. Only PRD 01 is present, despite the brief announcing three PRDs. Proposed engineering choices and targets are assumptions pending design-partner validation.

## Product boundaries

Help employees and managers agree task maps, identify development needs, approve 30-day plans, and verify learning evidence. Exclude automated layoffs, employee performance scoring, and predictions that particular jobs will disappear. AI proposes; people review.

## Repository use

Work through the backlog in dependency order. Resolve the pilot-blocking decisions before production data ingestion. Suggested future layout: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `infra`, `tests`. These are intended boundaries, not implemented services.
