import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { classifyTask } from '../apps/web/lib/server/provider';
const category = z.enum(['assist', 'partially_automate', 'human_led', 'uncertain']);
const schema = z.object({
  expertApproved: z.boolean(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.iso.date().optional(),
  minimumAccuracy: z.number().min(0).max(1).optional(),
  cases: z
    .array(
      z.object({
        role: z.string(),
        task: z.string(),
        expectedCategory: category.optional(),
        tentativeExpected: category.optional(),
      }),
    )
    .min(5),
});
const file = process.argv[2] || new URL('../fixtures/assessment-smoke.json', import.meta.url);
const data = schema.parse(JSON.parse(await readFile(file, 'utf8')));
const results = [];
for (const row of data.cases) {
  try {
    const result = await classifyTask(row.task);
    results.push({
      role: row.role,
      category: result.category,
      confidence: result.confidence,
      model: result.model,
      match: row.expectedCategory ? result.category === row.expectedCategory : null,
      error: false,
    });
  } catch {
    results.push({
      role: row.role,
      category: null,
      confidence: null,
      model: null,
      match: false,
      error: true,
    });
  }
}
const labelled = results.filter((x) => x.match !== null);
const accuracy = labelled.length ? labelled.filter((x) => x.match).length / labelled.length : null;
const labelsReady =
  data.expertApproved &&
  !!data.reviewedBy &&
  !!data.reviewedAt &&
  data.minimumAccuracy !== undefined &&
  data.cases.every((x) => x.expectedCategory) &&
  new Set(data.cases.map((x) => x.role)).size >= 5 &&
  new Set(data.cases.map((x) => x.expectedCategory)).size >= 3;
const passed =
  !!labelsReady &&
  accuracy !== null &&
  accuracy >= data.minimumAccuracy! &&
  results.every((x) => !x.error && x.model !== 'manual-review');
console.log(
  JSON.stringify(
    {
      expertApproved: data.expertApproved,
      labelledCases: labelled.length,
      accuracy,
      releaseGatePassed: passed,
      note: labelsReady
        ? 'Quality result uses the supplied expert labels and threshold; production integration and privacy gates are separate.'
        : 'Synthetic smoke only. Supply expert-approved labels, reviewer/date, five roles, three categories and minimumAccuracy for a quality gate.',
      results,
    },
    null,
    2,
  ),
);
if (labelsReady && !passed) process.exitCode = 1;
