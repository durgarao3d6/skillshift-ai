# PRD analysis

## Source and interpretation

The uploaded economic brief contains a compact SkillShift AI PRD. The product addresses uncertainty about how AI changes job tasks and which skills deserve development. Buyers are CHROs and L&D heads at IT services firms, GCCs and corporate learning teams. Employees, managers and tenant administrators are separate actors. Buyer willingness to pay is unvalidated; per-employee annual pricing is a hypothesis.

The architecture below is a proposal, not an expansion of validated requirements. The other two announced PRDs are absent and are excluded. News claims are not relied on as factual inputs to exposure scoring.

## MVP requirements and traceability

| ID | Requirement | Proposed acceptance criterion | Component / tasks |
|---|---|---|---|
| R1 | CSV role/task inventory | Preview validates required fields, duplicates and row errors; confirmation is atomic; re-import is idempotent | Inventory / T03–T04 |
| R2 | Explainable AI exposure | Each task has a category, explanation, confidence label, rubric/model version and review state; unavailable/uncertain results need review | Assessment / T06–T07 |
| R3 | Skills-gap assessment | Gap compares declared or evidence-backed proficiency against a versioned role target; unknown skill is distinct from missing skill | Skills / T08 |
| R4 | Personalised 30-day plan | Plan covers 30 calendar days, addresses accepted gaps and contains exercises, evidence criteria and estimated time | Learning / T09 |
| R5 | Manager completion and verified skills dashboard | Assigned manager sees completion separately from verification; employee uploads evidence; authorised reviewer accepts or requests changes | Evidence and reporting / T10–T11 |
| R6 | Employee task review | Employee can accept or propose corrections; changes preserve versions and invalidate affected draft assessments | Review / T05 |
| R7 | Manager approval | No plan becomes active until assigned manager approves the current revision; edits require reapproval | Learning / T09 |
| R8 | Product exclusions and privacy | No performance score, layoff ranking or job-loss prediction; employee access and tenant isolation tested | All / T02, T12–T14 |

These criteria operationalise the compact PRD and require product-owner review.

## Proposed pilot boundaries

English-only web application, one organisation per tenant, CSV/manual onboarding and an initially curated training catalogue. Suggested CSV columns: `employee_external_id`, `role_name`, `task_external_id`, `task_description`, `skill_tags`. Keep email/name mapping in a separate protected employee record; omit identifiers from model inputs. Identity integration and catalogue licensing must be settled before pilot onboarding.

Defer HRIS/LMS integrations, SCORM, course marketplaces, multilingual support, billing automation, native mobile, and autonomous agents. Multi-tenant security is required even if the first pilot has one tenant.

## Success measurement

- Discovery: 10 interviews (3 L&D leaders and 7 professionals), 2 design partners. Track separately from software delivery.
- Role-map acceptance: accepted role maps / reviewed role maps, target 80%; report cohort and count, count each reviewed revision once and distinguish initial acceptance from acceptance after edits.
- Learning-plan completion: employees completing all required activities / employees with an approved plan in the pilot cohort, target at least 60%; measure after the 30-day window and report withdrawals and non-approvals separately.
- Verified skill: evidence meets an agreed rubric approved by a reviewer; completion alone is not verification. Threshold and reviewer qualifications are open decisions.
- Classification quality: build a labelled five-role benchmark with expert reviewers; agree category accuracy, disagreement and confidence-calibration thresholds before release. Confidence is not a guarantee.

## Gaps requiring decisions

Before real employee data: controller/processor roles, processing region, retention/deletion policy, employee notice and lawful basis, AI-provider retention/training terms, manager access scope, identity provider and evidence file policy.

Before scoring: exposure categories and rubric, confidence semantics, reviewer qualifications, skills taxonomy, role proficiency targets and acceptable error thresholds. Before adoption: training time budget, content rights, accessibility needs and evidence-review capacity.

## Discovery experiment

Week 1: conduct the specified ten interviews; manually map five roles; show explanations and a mock learning plan; compare with buyers' current skills matrices. Seek two design partners, named budget owners and a documented pilot agreement. If buyers prefer generic course recommendations or cannot provide reviewers, revise scope before implementing the full pipeline.
