import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Workspace, { State } from '../components/workspace';
const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const task = {
  id: 'task-1',
  employee_external_id: 'EMP-001',
  role_name: 'Engineer',
  revision: 1,
  review_state: 'pending',
  task_description: 'Review and explain test results.',
  skill_tags: ['testing'],
};
const activity = {
  id: 'activity-1',
  plan_id: 'plan-1',
  plan_revision: 1,
  title: 'Testing practice',
  day: 1,
  minutes: 30,
  exercise: 'Write boundary tests.',
  rubric: 'Tests cover empty and valid input.',
  resource_url: 'https://nodejs.org/api/test.html',
};
const state: State = {
  actor: {
    tenantId: 'tenant',
    userId: 'user-1',
    role: 'manager',
    employeeId: 'EMP-001',
    displayName: 'Sample user',
  },
  developmentMode: true,
  tasks: [task],
  assessments: [],
  plans: [
    {
      id: 'plan-1',
      employee_external_id: 'EMP-001',
      revision: 1,
      status: 'active',
      weekly_minutes: 120,
    },
  ],
  activities: [activity],
  evidence: [
    {
      id: 'evidence-1',
      activity_id: 'activity-1',
      employee_external_id: 'EMP-002',
      reviewer_id: 'user-1',
      filename: 'exercise.txt',
      mime: 'text/plain',
      bytes: 20,
      status: 'clean',
    },
  ],
  jobs: [{ id: 'job-1', kind: 'assess', status: 'failed', attempts: 5 }],
  catalogue: [{ id: 'testing', name: 'Testing' }],
  targets: [],
  skillGaps: [
    {
      employeeId: 'EMP-001',
      skills: [
        {
          id: 'testing',
          name: 'Testing',
          target_level: 2,
          current_level: null,
          gap: null,
          unknown: true,
        },
      ],
    },
  ],
  privacyRequests: [],
  report: {
    acceptanceRate: null,
    completionRate: null,
    verifiedSkills: 0,
    roleMaps: { accepted: 0, reviewed: 0 },
    cohort: { completed: 0, approved: 0, withdrawn: 0, observation_ended: 0 },
    definitions: { completion: 'Completed / approved cohort.' },
  },
};
test('static rendered screens pass axe WCAG rules (contrast/layout require browser review)', async () => {
  const cases = [
    { section: 'Sign in', state: null },
    ...[
      'Overview',
      'Inventory',
      'Assessments',
      'Skills',
      'Learning plans',
      'Evidence',
      'Team report',
      'Administration',
      'Privacy',
    ].map((section) => ({
      section,
      state: {
        ...state,
        actor: {
          ...state.actor,
          role: section === 'Administration' ? 'admin' : section === 'Inventory' ? 'hr' : 'manager',
        },
      },
    })),
  ];
  for (const c of cases) {
    const html = renderToStaticMarkup(
      React.createElement<{ initialState?: State | null; initialSection?: string }>(Workspace, {
        initialState: c.state,
        initialSection: c.section,
      }),
    );
    const dom = new JSDOM(
      '<!doctype html><html lang="en"><head><title>SkillShift</title></head><body>' +
        html +
        '</body></html>',
      { runScripts: 'outside-only' },
    );
    dom.window.eval(axeSource);
    const results = await (
      dom.window as unknown as {
        axe: {
          run: (
            doc: Document,
            options: unknown,
          ) => Promise<{ violations: { id: string; nodes: unknown[] }[] }>;
        };
      }
    ).axe.run(dom.window.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    assert.equal(
      results.violations.length,
      0,
      c.section +
        ': ' +
        JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))),
    );
    dom.window.close();
  }
});
