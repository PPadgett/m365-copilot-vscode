const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..');
const workflow = readFileSync(join(root, '.github/workflows/scorecard.yml'), 'utf8');

test('Scorecard workflow produces both SARIF alerts and exact JSON evidence', () => {
  assert.equal(
    (workflow.match(/uses:\s*ossf\/scorecard-action@[0-9a-f]{40}/g) ?? []).length,
    2,
    'the pinned Scorecard action must run once per evidence format'
  );
  assert.match(workflow, /results_file:\s*results\.sarif[\s\S]*results_format:\s*sarif/);
  assert.match(workflow, /results_file:\s*results\.json[\s\S]*results_format:\s*json/);
  assert.match(workflow, /path:\s*\|[\s\S]*results\.sarif[\s\S]*results\.json/);
});

test('Scorecard policy evaluation consumes exact JSON evidence and fails closed', () => {
  assert.match(
    workflow,
    /check-scorecard-sarif\.mjs[\s\S]*results\.sarif[\s\S]*scorecard-policy-report\.json[\s\S]*results\.json/
  );
  assert.match(workflow, /Scorecard analysis did not complete successfully/);
  assert.match(workflow, /Scorecard results violate the committed policy/);
});
