const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = resolve(__dirname, '..');
const script = join(root, 'scripts/check-scorecard-sarif.mjs');
const committedPolicy = JSON.parse(readFileSync(join(root, '.github/scorecard-policy.json'), 'utf8'));
const configuredIds = Object.keys(committedPolicy.checks);

test('repository profile accepts passing checks and active, documented waivers', () => {
  const result = evaluate(makeSarif({
    CodeReviewID: 0,
    MaintainedID: 0,
    CIIBestPracticesID: 0
  }), committedPolicy, '2026-08-12T00:00:00Z', 'repository');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.passed, true);
  assert.equal(result.report.profile, 'repository');
  assert.deepEqual(
    result.report.checks.filter(check => check.status === 'waived').map(check => check.ruleId).sort(),
    ['CIIBestPracticesID', 'CodeReviewID', 'MaintainedID']
  );
});

test('repository profile fails non-waived security regressions', () => {
  const result = evaluate(makeSarif({
    BranchProtectionID: 0,
    SecurityPolicyID: 4,
    FuzzingID: 0,
    SASTID: 0,
    CodeReviewID: 0,
    MaintainedID: 0,
    CIIBestPracticesID: 0
  }), committedPolicy, '2026-08-12T00:00:00Z', 'repository');

  assert.notEqual(result.status, 0);
  assert.equal(result.report.passed, false);
  assert.deepEqual(result.report.failures, [
    'Branch-Protection scored 0; required minimum is 6.',
    'Security-Policy scored 4; required minimum is 7.',
    'Fuzzing scored 0; required minimum is 10.',
    'SAST scored 0; required minimum is 10.'
  ]);
});

test('repository profile applies active waivers to absent repository-history checks', () => {
  const ruleIds = configuredIds.filter(id => !['CodeReviewID', 'MaintainedID', 'CIIBestPracticesID'].includes(id));
  const result = evaluate(makeSarif({}, ruleIds), committedPolicy, '2026-08-12T00:00:00Z', 'repository');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.report.checks.filter(check => check.status === 'waived').map(check => check.ruleId).sort(),
    ['CIIBestPracticesID', 'CodeReviewID', 'MaintainedID']
  );
});

test('Scorecard policy makes waivers fail closed after their expiry', () => {
  const result = evaluate(makeSarif({ CodeReviewID: 0 }), committedPolicy, '2026-10-16T00:00:00Z', 'repository');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.includes('Code-Review scored 0; required minimum is 6.'));
});

test('pull-request profile ignores unavailable repository-state checks', () => {
  const result = evaluate(
    makeSarif({}, committedPolicy.profiles['pull-request']),
    committedPolicy,
    '2026-08-12T00:00:00Z',
    'pull-request'
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.passed, true);
  assert.deepEqual(result.report.checks.map(check => check.ruleId).sort(), [
    'FuzzingID',
    'SASTID',
    'SecurityPolicyID'
  ]);
});

test('pull-request profile rejects a SAST regression', () => {
  const result = evaluate(
    makeSarif({ SASTID: 0 }, committedPolicy.profiles['pull-request']),
    committedPolicy,
    '2026-08-12T00:00:00Z',
    'pull-request'
  );

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.includes('SAST scored 0; required minimum is 10.'));
});

test('pull-request profile rejects a missing expected check', () => {
  const ruleIds = committedPolicy.profiles['pull-request'].filter(id => id !== 'FuzzingID');
  const result = evaluate(makeSarif({}, ruleIds), committedPolicy, '2026-08-12T00:00:00Z', 'pull-request');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.some(failure => failure.includes('FuzzingID')));
});

test('Scorecard policy rejects newly introduced low-scoring checks until configured', () => {
  const sarif = makeSarif(
    { UnexpectedFutureCheckID: 2 },
    [...committedPolicy.profiles['pull-request'], 'UnexpectedFutureCheckID']
  );
  const result = evaluate(sarif, committedPolicy, '2026-08-12T00:00:00Z', 'pull-request');

  assert.notEqual(result.status, 0);
  assert.ok(result.report.failures.includes('Unconfigured Scorecard result UnexpectedFutureCheckID scored 2; required minimum is 10.'));
});

test('Scorecard policy rejects unknown profiles', () => {
  const result = evaluate(makeSarif({}), committedPolicy, '2026-08-12T00:00:00Z', 'unknown');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown Scorecard policy profile/);
});

function evaluate(sarif, policy, date, profile) {
  const directory = mkdtempSync(join(tmpdir(), 'scorecard-policy-'));
  const sarifPath = join(directory, 'results.sarif');
  const policyPath = join(directory, 'policy.json');
  const reportPath = join(directory, 'report.json');
  writeFileSync(sarifPath, JSON.stringify(sarif));
  writeFileSync(policyPath, JSON.stringify(policy));

  const child = spawnSync(process.execPath, [script, sarifPath, policyPath, reportPath, profile], {
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
    report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
  };
}

function makeSarif(scores, ruleIds = configuredIds) {
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
