const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = resolve(__dirname, '..');
const script = join(root, 'scripts/check-scorecard-sarif.mjs');
const committedPolicy = JSON.parse(readFileSync(join(root, '.github/scorecard-policy.json'), 'utf8'));
const configuredIds = Object.keys(committedPolicy.checks);

test('Scorecard policy accepts passing checks and active, documented waivers', () => {
  const result = evaluate(makeSarif({
    CodeReviewID: 0,
    MaintainedID: 0,
    CIIBestPracticesID: 0
  }), committedPolicy, '2026-08-12T00:00:00Z');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.passed, true);
  assert.deepEqual(
    result.report.checks.filter(check => check.status === 'waived').map(check => check.ruleId).sort(),
    ['CIIBestPracticesID', 'CodeReviewID', 'MaintainedID']
  );
});

test('Scorecard policy fails non-waived security regressions', () => {
  const result = evaluate(makeSarif({
    BranchProtectionID: 0,
    SecurityPolicyID: 4,
    FuzzingID: 0,
    CodeReviewID: 0,
    MaintainedID: 0,
    CIIBestPracticesID: 0
  }), committedPolicy, '2026-08-12T00:00:00Z');

  assert.notEqual(result.status, 0);
  assert.equal(result.report.passed, false);
  assert.deepEqual(result.report.failures, [
    'Branch-Protection scored 0; required minimum is 6.',
    'Security-Policy scored 4; required minimum is 7.',
    'Fuzzing scored 0; required minimum is 10.'
  ]);
});

test('Scorecard policy makes waivers fail closed after their expiry', () => {
  const result = evaluate(makeSarif({ CodeReviewID: 0 }), committedPolicy, '2026-10-16T00:00:00Z');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.includes('Code-Review scored 0; required minimum is 6.'));
});

test('Scorecard policy rejects missing expected checks', () => {
  const sarif = makeSarif({});
  sarif.runs[0].tool.driver.rules = sarif.runs[0].tool.driver.rules.filter(rule => rule.id !== 'FuzzingID');
  const result = evaluate(sarif, committedPolicy, '2026-08-12T00:00:00Z');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.some(failure => failure.includes('FuzzingID')));
});

test('Scorecard policy rejects newly introduced low-scoring checks until configured', () => {
  const sarif = makeSarif({ UnexpectedFutureCheckID: 2 }, ['UnexpectedFutureCheckID']);
  const result = evaluate(sarif, committedPolicy, '2026-08-12T00:00:00Z');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.includes('Unconfigured Scorecard result UnexpectedFutureCheckID scored 2; required minimum is 10.'));
});

function evaluate(sarif, policy, date) {
  const directory = mkdtempSync(join(tmpdir(), 'scorecard-policy-'));
  const sarifPath = join(directory, 'results.sarif');
  const policyPath = join(directory, 'policy.json');
  const reportPath = join(directory, 'report.json');
  writeFileSync(sarifPath, JSON.stringify(sarif));
  writeFileSync(policyPath, JSON.stringify(policy));

  const child = spawnSync(process.execPath, [script, sarifPath, policyPath, reportPath], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SCORECARD_POLICY_DATE: date,
      GITHUB_STEP_SUMMARY: ''
    }
  });
  return {
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
    report: JSON.parse(readFileSync(reportPath, 'utf8'))
  };
}

function makeSarif(scores, extraRuleIds = []) {
  const ruleIds = [...configuredIds, ...extraRuleIds];
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Scorecard',
            rules: ruleIds.map(id => ({ id }))
          }
        },
        results: Object.entries(scores).map(([ruleId, score]) => ({
          ruleId,
          message: {
            text: `${ruleId} score is ${score}`
          }
        }))
      }
    ]
  };
}
