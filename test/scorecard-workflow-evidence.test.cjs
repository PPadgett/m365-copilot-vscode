const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '..');
const workflow = readFileSync(
  join(root, '.github/workflows/scorecard.yml'),
  'utf8'
);

test('Scorecard exact JSON is explicit and advisory SARIF cannot gate policy', () => {
  const actionUses =
    workflow.match(/uses:\s*ossf\/scorecard-action@[0-9a-f]{40}/g) ?? [];
  assert.equal(
    actionUses.length,
    1,
    'the workflow must execute one pinned Scorecard scan per event'
  );

  const action = stepBlock('Run OpenSSF Scorecard once');
  assert.match(action, /results_file:\s*results\.json/);
  assert.match(action, /results_format:\s*json/);
  assert.match(action, /publish_results:/);
  assert.doesNotMatch(action, /results_file:.*github\.event_name/);
  assert.doesNotMatch(action, /results_format:.*github\.event_name/);

  const conversion = stepBlock(
    'Generate advisory Scorecard SARIF from exact JSON'
  );
  assert.match(conversion, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(conversion, /scorecard-json-to-sarif\.mjs/);
  assert.match(conversion, /results\.json/);
  assert.match(conversion, /results\.sarif/);

  const verification = stepBlock(
    'Verify exact JSON and advisory SARIF evidence'
  );
  assert.match(verification, /test -s results\.json/);
  assert.match(verification, /JSON\.parse/);
  assert.match(verification, /report\.checks/);
  assert.match(verification, /test -s results\.sarif/);

  const advisory = stepBlock(
    'Upload advisory Scorecard SARIF to code scanning'
  );
  assert.match(advisory, /if:\s*github\.event_name != 'pull_request'/);
  assert.match(advisory, /continue-on-error:\s*true/);
  assert.match(advisory, /sarif_file:\s*results\.sarif/);

  const policy = stepBlock(
    'Evaluate exact Scorecard results against policy'
  );
  assert.match(policy, /check-scorecard-results\.mjs/);
  assert.match(policy, /results\.json/);
  assert.doesNotMatch(policy, /results\.sarif/);
});

function stepBlock(name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step ${name}`);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}
