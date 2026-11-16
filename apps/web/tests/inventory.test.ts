import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCsv, MAX_ROWS } from '../lib/inventory';
const header = 'employee_external_id,role_name,task_external_id,task_description,skill_tags\n';
test('handles quoted descriptions, BOM, skill tags and stable digest', () => {
  const csv =
    '\ufeff' + header + 'e1,Engineer,t1,"Review, test and ship",TypeScript;Testing;Testing';
  const result = previewCsv(csv);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].task_description, 'Review, test and ship');
  assert.deepEqual(result.rows[0].skill_tags, ['TypeScript', 'Testing']);
  assert.equal(result.digest, previewCsv(csv).digest);
});
test('duplicate rows and blank required values block confirmation', () => {
  const result = previewCsv(
    header + 'e1,Engineer,t1,Review,\ne1,Engineer,t1,Other,\ne2,,t2,Review,',
  );
  assert.equal(result.errors.length, 2);
  assert.equal(result.rows.length, 1);
});
test('rejects malformed, empty, missing and duplicate headers', () => {
  for (const csv of [
    '',
    header,
    'a,b\n1,2',
    'employee_external_id,role_name,task_external_id,task_description,role_name\nx,y,z,t,u',
    header + 'e1,"unterminated',
  ])
    assert.throws(() => previewCsv(csv));
});
test('caps row count and description length', () => {
  assert.throws(() =>
    previewCsv(
      header +
        Array.from({ length: MAX_ROWS + 1 }, (_, i) => `e${i},Engineer,t1,Review,`).join('\n'),
    ),
  );
  assert.equal(previewCsv(header + 'e1,Engineer,t1,' + 'x'.repeat(4001) + ',').errors.length, 1);
});
