'use client';
import { FormEvent, useCallback, useEffect, useState, useRef } from 'react';
type RecordData = Record<string, any>;
export type State = {
  actor: {
    tenantId: string;
    userId: string;
    role: string;
    employeeId: string | null;
    displayName: string;
  };
  developmentMode: boolean;
  tasks: RecordData[];
  assessments: RecordData[];
  plans: RecordData[];
  activities: RecordData[];
  evidence: RecordData[];
  jobs: RecordData[];
  catalogue: RecordData[];
  targets: RecordData[];
  skillGaps: { employeeId: string; skills: RecordData[] }[];
  privacyRequests: RecordData[];
  report: RecordData | null;
};
const sections = [
  'Overview',
  'Inventory',
  'Assessments',
  'Skills',
  'Learning plans',
  'Evidence',
  'Team report',
  'Administration',
  'Privacy',
];
const sample =
  'employee_external_id,role_name,task_external_id,task_description,skill_tags\nEMP-001,Software engineer,CSV-01,Write and explain an integration test,testing;typescript';
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries());
}
function date(value: unknown) {
  return value ? new Date(String(value)).toLocaleDateString(undefined, { timeZone: 'UTC' }) : '—';
}
export default function Workspace({
  initialState = null,
  initialSection = 'Overview',
}: { initialState?: State | null; initialSection?: string } = {}) {
  const [state, setState] = useState<State | null>(initialState);
  const [section, setSection] = useState(initialSection);
  const [persona, setPersona] = useState('hr');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tenant, setTenant] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<RecordData | null>(null);
  const [filter, setFilter] = useState('');
  const [focusDraft, setFocusDraft] = useState('');
  const focusEmployee = useRef('');
  const [memberList, setMemberList] = useState<RecordData[]>([]);
  const headers = useCallback(() => ({ 'x-demo-user': persona }), [persona]);
  const load = useCallback(async () => {
    const r = await fetch(
      '/api/workspace/state' +
        (focusEmployee.current ? '?employeeId=' + encodeURIComponent(focusEmployee.current) : ''),
      { headers: headers() },
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    setState(data);
  }, [headers]);
  useEffect(() => {
    setState(null);
    setError('');
    load().catch((e) => setError(e.message));
  }, [load]);
  async function action(path: string, input: unknown = {}) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/workspace/' + path, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (path === 'imports' && !(input as RecordData).confirm) {
        setPreview(result);
        setMessage(
          `${result.rowCount} valid rows; ${result.errors.length} errors. Review before confirming.`,
        );
      } else {
        setMessage(
          path === 'imports'
            ? `${result.imported} tasks imported; ${result.skipped || 0} skipped.`
            : 'Saved.',
        );
        if (path === 'imports') {
          setPreview(null);
          setCsv('');
        }
        await load();
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string, filename: string) {
    setError('');
    try {
      const r = await fetch('/api/workspace/' + path, { headers: headers() });
      if (!r.ok) throw new Error((await r.json()).error);
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    }
  }
  if (!state)
    return (
      <main className="signin">
        <a className="brand" href="/">
          ◈ SkillShift<span className="brand-ai">AI</span>
        </a>
        <div className="panel">
          <div className="eyebrow">WORKFORCE DEVELOPMENT</div>
          <h1>
            Build skills.
            <br />
            Keep people in control.
          </h1>
          <p>Sign in with your organisation’s identity provider.</p>
          {error && (
            <p role="alert" className="errors">
              {error}
            </p>
          )}
          <form action="/api/auth/login" method="get">
            <Field
              label="Workspace ID"
              name="tenant"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="Workspace UUID from your administrator"
              required
            />
            <button>Continue to sign in</button>
          </form>
          <p>
            Your administrator provides your workspace ID and grants access. Contact them if you
            cannot sign in.
          </p>
          <button className="secondary" onClick={() => load().catch((e) => setError(e.message))}>
            Retry connection
          </button>
        </div>
      </main>
    );
  const a = state.actor;
  const admin = ['admin', 'hr'].includes(a.role);
  const manager = a.role === 'manager';
  const employee = a.employeeId;
  const taskRows = state.tasks.filter((t) =>
    [t.role_name, t.employee_external_id, t.task_description]
      .join(' ')
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const visibleSections = sections.filter(
    (s) => !(s === 'Administration' && !admin) && !(s === 'Team report' && !state.report),
  );
  return (
    <div className="shell workbench">
      <aside>
        <a className="brand" href="/">
          ◈{' '}
          <span>
            SkillShift<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="workspace">
          {state.developmentMode ? 'SYNTHETIC DEMO' : 'YOUR WORKSPACE'}
        </div>
        <nav aria-label="Workspace sections">
          {visibleSections.map((s) => (
            <button
              key={s}
              className={section === s ? 'selected' : ''}
              onClick={() => {
                setSection(s);
                setError('');
                setMessage('');
              }}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <strong>AI suggests. People decide.</strong>
          <p>Completion and verified skills are measured separately.</p>
        </div>
        <div className="profile">
          <span className="avatar">{a.displayName.slice(0, 2).toUpperCase()}</span>
          <div>
            {a.displayName}
            <small>{a.role}</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>Workspace / {section}</span>
          {state.developmentMode ? (
            <label className="persona">
              Demo persona
              <select
                aria-label="Development persona"
                value={persona}
                onChange={(e) => {
                  focusEmployee.current = '';
                  setFocusDraft('');
                  setPersona(e.target.value);
                  setSection('Overview');
                  setPreview(null);
                }}
              >
                {['hr', 'manager', 'employee', 'reviewer', 'admin'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          ) : (
            <button
              className="secondary compact"
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/';
              }}
            >
              Sign out
            </button>
          )}
        </header>
        <div className="page-title">
          <div>
            <div className="eyebrow">
              {state.developmentMode
                ? 'DEVELOPMENT WORKSPACE · SAMPLE DATA ONLY'
                : 'WORKFORCE DEVELOPMENT'}
            </div>
            <h1>{section === 'Overview' ? 'A clear next step.' : section}</h1>
          </div>
          <button
            className="secondary compact"
            onClick={() => load().catch((e) => setError(e.message))}
          >
            Refresh
          </button>
        </div>
        <form
          className="inline-form employee-focus"
          onSubmit={(e) => {
            e.preventDefault();
            focusEmployee.current = focusDraft.trim();
            void load().catch((error) => setError(error.message));
          }}
        >
          <Field
            label="Focus on employee ID (optional)"
            name="employeeFocus"
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            placeholder="Enter an employee ID to load their full workflow"
          />
          <button className="secondary compact">Apply focus</button>
          <button
            className="secondary compact"
            type="button"
            onClick={() => {
              focusEmployee.current = '';
              setFocusDraft('');
              void load().catch((error) => setError(error.message));
            }}
          >
            Clear focus
          </button>
        </form>
        <div aria-live="polite">
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
        {section === 'Overview' && (
          <>
            <section className="stats">
              {[
                [state.tasks.length, 'Visible tasks'],
                [state.plans.filter((p) => p.status === 'active').length, 'Active plans'],
                [
                  state.evidence.filter((e) => e.status === 'verified').length,
                  'Visible verified evidence',
                ],
              ].map(([n, label]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{n}</strong>
                  <small>Within your access scope; list limits apply</small>
                </article>
              ))}
            </section>
            <section className="panel">
              <h2>From task maps to practical learning</h2>
              <p>
                1. Import tasks → 2. Employee accepts or corrects tasks → 3. Request an assessment →
                4. Assigned manager reviews it → 5. Employee reports skills and drafts a plan → 6.
                Manager approves → 7. Complete exercises and submit evidence → 8. Independent
                reviewer verifies skills.
              </p>
              <div className="actions left">
                <button onClick={() => setSection('Inventory')}>Open inventory</button>
                <button className="secondary" onClick={() => setSection('Learning plans')}>
                  Learning plans
                </button>
              </div>
              <p>
                No model output activates a plan, verifies a skill or scores employee performance.
              </p>
              {state.developmentMode && (
                <p>
                  Switch between employee and manager personas to try both sides of the workflow.
                  Use the administration section to run queued jobs locally. Without an AI provider,
                  assessments explicitly request manual review.
                </p>
              )}
            </section>
          </>
        )}
        {section === 'Inventory' && (
          <>
            {admin && (
              <section className="panel">
                <h2>Import roles & tasks</h2>
                <p>
                  Required columns: employee_external_id, role_name, task_external_id,
                  task_description. Optional skill_tags uses semicolons.
                </p>
                <label className="file-label">
                  Choose a CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) {
                        setError('CSV exceeds 10 MB.');
                        return;
                      }
                      setCsv(await f.text());
                      setPreview(null);
                    }}
                  />
                </label>
                <label className="field">
                  CSV content
                  <textarea
                    rows={6}
                    value={csv}
                    onChange={(e) => {
                      setCsv(e.target.value);
                      setPreview(null);
                    }}
                  />
                </label>
                <div className="actions left">
                  <button disabled={busy || !csv} onClick={() => void action('imports', { csv })}>
                    Preview
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setCsv(sample);
                      setPreview(null);
                    }}
                  >
                    Load sample
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void download('export', 'inventory.csv')}
                  >
                    Export inventory
                  </button>
                </div>
                {preview && (
                  <div className="preview">
                    <h3>{preview.rowCount} valid rows</h3>
                    {preview.errors.map((r: RecordData) => (
                      <p className="errors" key={r.row}>
                        Row {r.row}: {r.message}
                      </p>
                    ))}
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Role</th>
                            <th>Task</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r: RecordData, i: number) => (
                            <tr key={i}>
                              <td>{r.employee_external_id}</td>
                              <td>{r.role_name}</td>
                              <td>{r.task_description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>
                      Preview displays up to 50 rows. Confirmation is atomic. Existing IDs are
                      skipped.
                    </p>
                    <button
                      disabled={busy || preview.errors.length > 0}
                      onClick={() =>
                        void action('imports', { csv, confirm: true, digest: preview.digest })
                      }
                    >
                      Confirm import
                    </button>
                  </div>
                )}
              </section>
            )}
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Task map review</h2>
                  <p>
                    Showing up to 200 accessible tasks. Task corrections invalidate dependent
                    assessments and plans.
                  </p>
                </div>
                <label className="field">
                  Filter tasks
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Role, employee or task"
                  />
                </label>
              </div>
              {!taskRows.length && (
                <Empty text="No tasks in your scope. Ask HR to import an inventory." />
              )}
              {taskRows.map((t) => (
                <article className="resource-card" key={t.id}>
                  <div className="card-heading">
                    <h3>
                      {t.role_name} <small>{t.employee_external_id}</small>
                    </h3>
                    <Status value={`${t.review_state} · v${t.revision}`} />
                  </div>
                  <p>{t.task_description}</p>
                  <div className="tags">
                    {t.skill_tags.map((s: string) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  {(employee === t.employee_external_id || manager) && (
                    <>
                      <form
                        className="inline-form"
                        onSubmit={(e) => {
                          const v = values(e);
                          void action('tasks/correct', {
                            taskId: t.id,
                            revision: t.revision,
                            description: v.description,
                          });
                        }}
                      >
                        <Field
                          label="Propose task correction"
                          name="description"
                          defaultValue={t.task_description}
                          required
                          maxLength={4000}
                        />
                        <button disabled={busy} className="secondary">
                          Save correction
                        </button>
                      </form>
                      {t.review_state === 'pending' && (
                        <form
                          className="inline-form"
                          onSubmit={(e) => {
                            const v = values(e);
                            void action('tasks/review', {
                              taskId: t.id,
                              revision: t.revision,
                              decision: v.decision,
                              reason: v.reason,
                            });
                          }}
                        >
                          <label className="field">
                            Decision
                            <select name="decision">
                              <option value="accepted">Accept task map</option>
                              <option value="rejected">Needs correction</option>
                            </select>
                          </label>
                          <Field label="Review reason" name="reason" minLength={3} required />
                          <button disabled={busy}>Save review</button>
                        </form>
                      )}
                    </>
                  )}
                  {t.review_state === 'accepted' && (
                    <button
                      disabled={busy}
                      className="secondary compact"
                      onClick={() => void action('assessments/request', { taskId: t.id })}
                    >
                      Queue assessment
                    </button>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
        {section === 'Assessments' && (
          <section className="panel">
            <h2>Explainable suggestions, human decisions</h2>
            <p>
              Exposure describes tasks, never employee performance. Provider confidence is
              uncalibrated. An assigned manager must review each accepted task before a plan can be
              generated.
            </p>
            {!state.tasks.length && <Empty text="Import and review task maps first." />}
            {state.tasks.map((t) => {
              const assessment = state.assessments.find(
                (r) => r.task_id === t.id && r.task_revision === t.revision && r.status !== 'stale',
              );
              return (
                <article className="resource-card" key={t.id}>
                  <div className="card-heading">
                    <h3>
                      {t.employee_external_id} · {t.role_name}
                    </h3>
                    <Status value={assessment?.status || 'Not assessed'} />
                  </div>
                  <p>{t.task_description}</p>
                  {assessment ? (
                    <>
                      <strong>{assessment.category.replaceAll('_', ' ')}</strong>
                      <p>{assessment.rationale}</p>
                      <p className="meta">
                        Confidence: {assessment.confidence} · Model: {assessment.model} ·{' '}
                        {assessment.rubric_version} / {assessment.prompt_version}
                      </p>
                      {assessment.review_reason && (
                        <p>Human decision: {assessment.review_reason}</p>
                      )}
                    </>
                  ) : (
                    <p>
                      No suggestion yet. Manual classification is available to the assigned manager.
                    </p>
                  )}
                  <button
                    className="secondary compact"
                    disabled={busy || t.review_state !== 'accepted'}
                    onClick={() => void action('assessments/request', { taskId: t.id })}
                  >
                    Queue suggestion
                  </button>
                  {manager && t.review_state === 'accepted' && (
                    <form
                      className="inline-form"
                      onSubmit={(e) => {
                        const v = values(e);
                        void action('assessments/review', {
                          taskId: t.id,
                          revision: t.revision,
                          category: v.category,
                          reason: v.reason,
                        });
                      }}
                    >
                      <label className="field">
                        Human classification
                        <select name="category" defaultValue={assessment?.category || 'uncertain'}>
                          {['assist', 'partially_automate', 'human_led', 'uncertain'].map((c) => (
                            <option key={c} value={c}>
                              {c.replaceAll('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label="Explanation / override reason"
                        name="reason"
                        required
                        minLength={5}
                      />
                      <button disabled={busy}>Save classification</button>
                    </form>
                  )}
                </article>
              );
            })}
          </section>
        )}
        {section === 'Skills' && (
          <>
            <section className="panel">
              <h2>Skills gaps</h2>
              <p>
                Unknown proficiency is different from a missing skill. Evidence-backed proficiency
                takes precedence while its verification remains current.
              </p>
              {!state.skillGaps.length && (
                <Empty text="Skills gaps appear after tasks and role targets are configured." />
              )}
              {state.skillGaps.map((group) => (
                <article className="resource-card" key={group.employeeId}>
                  <h3>{group.employeeId}</h3>
                  {!group.skills.length && (
                    <p>No targets for this employee’s roles. Ask HR to set targets.</p>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Skill</th>
                          <th>Target</th>
                          <th>Current</th>
                          <th>Gap</th>
                          <th>Your self-report</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.skills.map((s) => (
                          <tr key={s.id}>
                            <td>{s.name}</td>
                            <td>{s.target_level}</td>
                            <td>{s.current_level ?? 'Unknown'}</td>
                            <td>{s.gap ?? 'Needs assessment'}</td>
                            <td>
                              {employee === group.employeeId ? (
                                <form
                                  className="mini-form"
                                  onSubmit={(e) => {
                                    const v = values(e);
                                    void action('skills/self-report', {
                                      skillId: s.id,
                                      level: v.level === '' ? null : Number(v.level),
                                    });
                                  }}
                                >
                                  <label className="sr-only" htmlFor={'level-' + s.id}>
                                    Self-reported level for {s.name}
                                  </label>
                                  <select
                                    id={'level-' + s.id}
                                    name="level"
                                    defaultValue={s.self_level ?? ''}
                                  >
                                    <option value="">Unknown</option>
                                    {[0, 1, 2, 3, 4].map((n) => (
                                      <option key={n}>{n}</option>
                                    ))}
                                  </select>
                                  <button disabled={busy} className="secondary compact">
                                    Save
                                  </button>
                                </form>
                              ) : (
                                'Employee self-report only'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </section>
            {admin && (
              <section className="panel">
                <h2>Set role targets</h2>
                <p>
                  0 = introductory, 1 = assisted practice, 2 = independent practice, 3 = advanced
                  practice, 4 = guides others. Targets require domain-owner agreement.
                </p>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    const v = values(e);
                    void action('skills/targets', {
                      roleName: v.roleName,
                      skillId: v.skillId,
                      level: Number(v.level),
                    });
                  }}
                >
                  <Field name="roleName" label="Role name" required />
                  <label className="field">
                    Skill
                    <select name="skillId">
                      {state.catalogue.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Target level
                    <select name="level">
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy}>Set target</button>
                </form>
                <div className="tags">
                  {state.targets.map((t) => (
                    <span key={t.role_name + t.skill_id}>
                      {t.role_name} · {t.skill_id}: {t.target_level}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        {section === 'Learning plans' && (
          <>
            <section className="panel">
              <h2>Create a 30-day plan</h2>
              <p>
                All current tasks must be accepted and their assessments human-reviewed. Plans use
                curated resources, practical exercises and your available time.
              </p>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  const v = values(e);
                  void action('plans/generate', {
                    employeeId: v.employeeId,
                    weeklyMinutes: Number(v.weeklyMinutes),
                  });
                }}
              >
                <EmployeeField
                  employees={state.skillGaps.map((g) => g.employeeId)}
                  defaultValue={employee || undefined}
                />
                <Field
                  name="weeklyMinutes"
                  label="Minutes per week"
                  type="number"
                  min={30}
                  max={600}
                  defaultValue={120}
                  required
                />
                <button disabled={busy}>Generate draft</button>
              </form>
            </section>
            {!state.plans.length && <Empty text="No learning plans yet." />}
            {state.plans.map((p) => (
              <section className="panel" key={p.id}>
                <div className="card-heading">
                  <h2>
                    {p.employee_external_id} · Revision {p.revision}
                  </h2>
                  <Status value={p.stale ? 'Stale — regenerate' : p.status} />
                </div>
                <p>
                  {date(p.start_date)} → {date(p.end_date)} · {p.weekly_minutes} minutes/week
                </p>
                {manager && p.status === 'draft' && (
                  <form
                    className="inline-form"
                    onSubmit={(e) => {
                      const v = values(e);
                      void action('plans/approve', {
                        planId: p.id,
                        revision: p.revision,
                        startDate: v.startDate,
                      });
                    }}
                  >
                    <Field
                      label="Start date"
                      name="startDate"
                      type="date"
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      required
                    />
                    <button disabled={busy || p.stale}>Approve current revision</button>
                  </form>
                )}
                <div className="actions left">
                  {['draft', 'active'].includes(p.status) && (
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void action('plans/generate', {
                          planId: p.id,
                          revision: p.revision,
                          employeeId: p.employee_external_id,
                          weeklyMinutes: p.weekly_minutes,
                        })
                      }
                    >
                      Regenerate & require reapproval
                    </button>
                  )}
                  {(employee === p.employee_external_id || manager) && p.status !== 'cancelled' && (
                    <button
                      className="secondary compact"
                      disabled={busy}
                      onClick={() =>
                        void action('plans/withdraw', { planId: p.id, revision: p.revision })
                      }
                    >
                      Withdraw plan
                    </button>
                  )}
                </div>
                <ol className="activity-list">
                  {state.activities
                    .filter((t) => t.plan_id === p.id && t.plan_revision === p.revision)
                    .map((t) => (
                      <li key={t.id}>
                        <div className="activity-day">Day {t.day}</div>
                        <div>
                          <h3>
                            {t.title} · {t.minutes} min
                          </h3>
                          <p>{t.exercise}</p>
                          <p>
                            <strong>Verification rubric:</strong> {t.rubric}
                          </p>
                          <a
                            className="resource-link"
                            href={t.resource_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open learning resource ↗
                          </a>
                          <p>
                            <Status
                              value={t.completed_at ? 'Activity completed' : 'Activity incomplete'}
                            />
                          </p>
                          {employee === p.employee_external_id && (
                            <div className="actions left">
                              <button
                                disabled={
                                  busy || !!t.completed_at || p.status !== 'active' || p.stale
                                }
                                className="secondary compact"
                                onClick={() =>
                                  void action('activities/complete', { activityId: t.id })
                                }
                              >
                                Mark activity complete
                              </button>
                              <button
                                disabled={
                                  busy || p.stale || !['active', 'completed'].includes(p.status)
                                }
                                className="secondary compact"
                                onClick={() => setSection('Evidence')}
                              >
                                Submit evidence
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                </ol>
              </section>
            ))}
          </>
        )}
        {section === 'Evidence' && (
          <>
            <section className="panel">
              <h2>Evidence-based skill verification</h2>
              <p>
                Uploads remain quarantined until the malware scanner passes them. Completion is
                separate from verification. Only an assigned independent reviewer can verify a
                skill.
              </p>
              {employee && (
                <form
                  className="inline-form"
                  onSubmit={async (e) => {
                    const v = values(e);
                    const file = v.file as File;
                    if (!file?.size || file.size > 5 * 1024 * 1024) {
                      setError('Choose a text or PDF file up to 5 MB.');
                      return;
                    }
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let binary = '';
                    for (let i = 0; i < bytes.length; i += 8192)
                      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                    void action('evidence/submit', {
                      activityId: v.activityId,
                      filename: file.name,
                      mime: file.name.toLowerCase().endsWith('.txt') ? 'text/plain' : file.type,
                      contentBase64: btoa(binary),
                    });
                  }}
                >
                  <label className="field">
                    Activity
                    <select name="activityId" required>
                      <option value="">Choose a current approved activity</option>
                      {state.activities
                        .filter((t) =>
                          state.plans.some(
                            (p) =>
                              p.id === t.plan_id &&
                              p.employee_external_id === employee &&
                              p.revision === t.plan_revision &&
                              !p.stale &&
                              ['active', 'completed'].includes(p.status),
                          ),
                        )
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title} · Day {t.day}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Evidence file
                    <input
                      name="file"
                      type="file"
                      accept=".txt,.pdf,text/plain,application/pdf"
                      required
                    />
                  </label>
                  <button disabled={busy}>Upload to quarantine</button>
                </form>
              )}
            </section>
            {!state.evidence.length && (
              <Empty text="No evidence in your employee or assigned-reviewer scope." />
            )}
            {state.evidence.map((e) => (
              <section className="panel" key={e.id}>
                <div className="card-heading">
                  <h3>{e.filename}</h3>
                  <Status value={e.status} />
                </div>
                <p>
                  {e.employee_external_id} · {e.bytes} bytes · {date(e.created_at)}
                </p>
                {e.review_reason && <p>Review: {e.review_reason}</p>}
                {['clean', 'verified', 'rejected'].includes(e.status) && (
                  <button
                    className="secondary compact"
                    onClick={() => void download('evidence/' + e.id, e.filename)}
                  >
                    Download evidence
                  </button>
                )}
                {e.status === 'quarantined' && (
                  <p>Waiting for malware scanning. Scanner failures keep evidence inaccessible.</p>
                )}
                {e.reviewer_id === a.userId && e.status === 'clean' && (
                  <form
                    className="inline-form"
                    onSubmit={(event) => {
                      const v = values(event);
                      void action('evidence/review', {
                        evidenceId: e.id,
                        decision: v.decision,
                        reason: v.reason,
                      });
                    }}
                  >
                    <label className="field">
                      Rubric decision
                      <select name="decision">
                        <option value="verified">Rubric met — verify skill</option>
                        <option value="rejected">Changes requested</option>
                      </select>
                    </label>
                    <Field
                      label="Evidence and rubric review"
                      name="reason"
                      minLength={5}
                      required
                    />
                    <button disabled={busy}>Record verification decision</button>
                  </form>
                )}
              </section>
            ))}
          </>
        )}
        {section === 'Team report' && state.report && (
          <section className="panel">
            <h2>Learning outcomes in your scope</h2>
            <div className="stats">
              {[
                [
                  state.report.acceptanceRate === null
                    ? '—'
                    : Math.round(state.report.acceptanceRate * 100) + '%',
                  'Initial role-map acceptance',
                ],
                [
                  state.report.completionRate === null
                    ? '—'
                    : Math.round(state.report.completionRate * 100) + '%',
                  'Learning-plan completion',
                ],
                [state.report.verifiedSkills, 'Verified skills'],
              ].map(([n, label]) => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{n}</strong>
                </article>
              ))}
            </div>
            <p>
              {state.report.roleMaps.accepted} accepted / {state.report.roleMaps.reviewed} initially
              reviewed role maps.
            </p>
            <p>
              {state.report.cohort.completed} completed / {state.report.cohort.approved} approved
              employees · {state.report.cohort.withdrawn} withdrawals ·{' '}
              {state.report.cohort.observation_ended} observation windows ended.
            </p>
            {Object.entries(state.report.definitions).map(([k, v]) => (
              <p key={k}>
                <strong>{k}: </strong>
                {String(v)}
              </p>
            ))}
          </section>
        )}
        {section === 'Administration' && admin && (
          <>
            <section className="panel">
              <h2>Background processing</h2>
              <p>
                Run <code>npm run worker</code> on a persistent worker host. A development-only
                button is available for local demos. Deployed requests cannot start worker batches.
              </p>
              {state.developmentMode && (
                <button disabled={busy} onClick={() => void action('jobs/run')}>
                  Process up to 10 queued jobs
                </button>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Result / actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.jobs.map((j) => (
                      <tr key={j.id}>
                        <td>
                          {j.kind}
                          <small>{j.id.slice(0, 8)}</small>
                        </td>
                        <td>{j.status}</td>
                        <td>{j.attempts}</td>
                        <td>
                          {j.last_error}
                          {['failed', 'cancelled'].includes(j.status) ? (
                            <button
                              disabled={busy}
                              className="secondary compact"
                              onClick={() => void action('jobs/retry', { jobId: j.id })}
                            >
                              Retry
                            </button>
                          ) : ['queued', 'running', 'retry_wait'].includes(j.status) ? (
                            <button
                              disabled={busy}
                              className="secondary compact"
                              onClick={() => void action('jobs/cancel', { jobId: j.id })}
                            >
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <h2>Assign a manager or reviewer</h2>
              <button
                className="secondary compact"
                onClick={async () => {
                  try {
                    const r = await fetch('/api/workspace/members', { headers: headers() });
                    if (!r.ok) throw new Error((await r.json()).error);
                    setMemberList(await r.json());
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not load members.');
                  }
                }}
              >
                Load workspace members
              </button>
              <form
                className="inline-form"
                onSubmit={(e) => {
                  const v = values(e);
                  void action('managers/assign', {
                    employeeId: v.employeeId,
                    managerId: v.managerId,
                  });
                }}
              >
                <EmployeeField employees={state.skillGaps.map((g) => g.employeeId)} />
                <label className="field">
                  Independent manager / reviewer
                  <select name="managerId" required>
                    <option value="">Choose a provisioned member</option>
                    {memberList
                      .filter((m) => ['manager', 'reviewer'].includes(m.role))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name} · {m.role}
                        </option>
                      ))}
                  </select>
                </label>
                <button disabled={busy}>Assign</button>
              </form>
              <p>
                Provision identities through the administrator CLI; users cannot grant themselves
                membership or roles.
              </p>
            </section>
            {a.role === 'admin' && (
              <section className="panel">
                <h2>Approved retention policy</h2>
                <p>
                  Configure only after customer approval. Legal holds block deletion and
                  evidence-retention sweeps.
                </p>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    const v = values(e);
                    void action('policy', {
                      evidenceRetentionDays: Number(v.days),
                      legalHold: v.hold === 'on',
                      confirmation: v.confirmation,
                    });
                  }}
                >
                  <Field
                    label="Evidence retention days after plan end"
                    name="days"
                    type="number"
                    min={1}
                    max={3650}
                    defaultValue={180}
                    required
                  />
                  <label className="check-field">
                    <input type="checkbox" name="hold" /> Legal hold
                  </label>
                  <Field label="Type POLICY APPROVED" name="confirmation" required />
                  <button disabled={busy}>Save policy</button>
                </form>
              </section>
            )}
          </>
        )}
        {section === 'Privacy' && (
          <section className="panel">
            <h2>Your data and privacy</h2>
            <p>
              Exports include your task history, assessments, plans, activities and evidence
              metadata. Private files remain available through authorised downloads. Deletion is a
              background process and may be blocked by a legal hold.
            </p>
            {employee && (
              <button
                className="secondary"
                onClick={() =>
                  void download(
                    'privacy/export?employeeId=' + encodeURIComponent(employee),
                    'skillshift-personal-data.json',
                  )
                }
              >
                Export my data
              </button>
            )}
            <form
              className="inline-form"
              onSubmit={(e) => {
                const v = values(e);
                void action('privacy/delete', { employeeId: v.employeeId, confirm: v.confirm });
              }}
            >
              {admin ? (
                <EmployeeField employees={state.skillGaps.map((g) => g.employeeId)} />
              ) : (
                <Field
                  name="employeeId"
                  label="Employee ID"
                  value={employee || ''}
                  readOnly
                  required
                />
              )}
              <Field label="Type DELETE to request permanent deletion" name="confirm" required />
              <button disabled={busy}>Request deletion</button>
            </form>
            <p>
              Deletion removes employee-linked application records and private evidence. An
              external, opaque deletion ledger is replayed after backup restoration. Minimal audit
              records follow a separately approved retention policy.
            </p>
            <ul>
              {state.privacyRequests.map((r) => (
                <li key={r.id}>
                  {r.id.slice(0, 8)} · {r.status} · {date(r.created_at)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <footer>
          <span>SkillShift AI · Human-reviewed workforce development</span>
          <span>Tenant: {a.tenantId.slice(0, 8)} · No employee performance scoring</span>
        </footer>
      </main>
    </div>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      {label}
      <input {...props} />
    </label>
  );
}
function EmployeeField({
  employees,
  defaultValue,
}: {
  employees: string[];
  defaultValue?: string;
}) {
  return (
    <label className="field">
      Employee
      <select name="employeeId" defaultValue={defaultValue} required>
        {employees.map((e) => (
          <option key={e}>{e}</option>
        ))}
      </select>
    </label>
  );
}
function Status({ value }: { value: string }) {
  return <span className="review">{value}</span>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span aria-hidden="true">◫</span>
      <p>{text}</p>
    </div>
  );
}
