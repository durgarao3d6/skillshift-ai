# Delivery plan

## Planning basis

Discovery is a one-week experiment from the PRD. Engineering estimate is a proposed 10-week pilot build after discovery, with two full-time engineers, a half-time product designer/PM, a half-time QA engineer and part-time security/domain reviewers. Backlog estimates are engineering person-days, including implementation and local verification; they exclude waiting for providers, contracts, customer review and the 30-day learning observation period. Estimates are rough, allow 20–30% contingency and re-estimate after discovery. No automatic schedule or hiring commitments are implied.

## Phases and gates

| Phase | Timing | Deliverables | Exit gate |
|---|---|---|---|
| Discovery | Week 1 | T01, buyer interviews, five-role prototype, draft rubric | Two design partners or explicit decision to revise hypothesis |
| Foundation | Build weeks 1–2 | T02–T03, T15 baseline pipeline | Tenant isolation, identity and privacy policy agreed before real data |
| Inventory and assessment | Build weeks 3–4 | T04–T07 | Reviewed task revisions, safe async assessment and labelled benchmark |
| Skills and learning | Build weeks 5–6 | T08–T09 | Reproducible gap calculation; revision-safe approved plans |
| Evidence and reporting | Build weeks 7–8 | T10–T12 | Verified skills separate from completion; access and deletion work |
| Pilot readiness | Build weeks 9–10 | T13–T16 | Security, quality, accessibility, load and recovery gates pass |
| Pilot measurement | Next 30 days plus review | T17 | Report acceptance, completion, quality and buyer willingness to pay |

Timing assumes parallel frontend/backend work where dependencies allow; task IDs define the actual precedence. Critical dependency chain: T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T14 → T16 → T17. T15 begins after T02 and hardens throughout. T12 and T13 can progress alongside feature completion after their prerequisites.

## Definition of ready

Named owner, accepted requirement and error states, agreed access rules, contract/schema and acceptance criteria. AI tasks additionally require versioned rubric, test cases and provider budget. Tasks involving personal data require retention/notice/provider decisions resolved.

## Definition of done

Implementation reviewed, relevant automated checks pass, auth/tenant isolation covered, migration and rollback documented, metrics and audit events in place, documentation updated, and acceptance criteria demonstrated in staging. A task is not done because its UI alone is complete.

## Release gates

- Product: all R1–R8 demonstrated; exclusions upheld; manual review operational; partner signs off task/skill rubrics.
- AI: agreed benchmark thresholds pass, low confidence/unknown paths are safe, prompt/model/rubric versions recorded, cost budget tested.
- Security: no unresolved critical/high findings; tenant and resource access tested; provider contract, region, notice and retention approved.
- Reliability: duplicate delivery and provider outage rehearsed; backup restoration meets accepted RPO/RTO; monitoring and rollback exercised.
- Adoption: onboarding guidance, reviewer capacity and training time budget confirmed; five-role dry run complete.

## Operating the backlog

`backlog/tasks.csv` is the source of planned tasks; statuses track milestone progress; In progress does not mean release criteria are met. Assign people during kickoff. Estimates are not deadlines. Import into a tracker if desired; GitHub issues have not been created automatically. Use one issue per task ID and include dependencies and acceptance criteria from the CSV. Discovery may change the backlog; record scope changes in an ADR.
