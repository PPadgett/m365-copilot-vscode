const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const policy = JSON.parse(readFileSync(join(root, '.github/scorecard-policy.json'), 'utf8'));
const evaluator = import(pathToFileURL(join(root, 'scripts/lib/scorecard-policy.mjs')).href);

const knownPinnedChecks = [
  'Binary-Artifacts',
  'Branch-Protection',
  'CII-Best-Practices',
  'CI-Tests',
  'Code-Review',
  'Contributors',
  'Dangerous-Workflow',
  'Dependency-Update-Tool',
  'Fuzzing',
  'License',
  'Maintained',
  'Packaging',
  'Pinned-Dependencies',
  'SAST',
  'Security-Policy',
  'Signed-Releases',
  'Token-Permissions',
  'Vulnerabilities'
];

test('an exact-only unconfigured low-scoring check fails closed', async () => {
  const report = await run(
    exact([
      check('Security-Policy', 10),
      check('Dangerous-New-Check', 0)
    ]),
    profilePolicy(['SecurityPolicyID'])
  );

  assert.equal(report.passed, false);
  assert.ok(report.failures.some(item => item.includes('Unconfigured Scorecard check Dangerous-New-Check scored 0')));
  assert.equal(report.checks.find(entry => entry.ruleId === 'DangerousNewCheckID').status, 'fail');
});

test('an unconfigured inconclusive check fails closed', async () => {
  const report = await run(
    exact([check('Security-Policy', 10), check('Future-Check', -1)]),
    profilePolicy(['SecurityPolicyID'])
  );
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(item => item.includes('Future-Check was inconclusive')));
});

test('an unconfigured check meeting the default minimum is reported without failing', async () => {
  const report = await run(
    exact([check('Security-Policy', 10), check('Future-Check', 10)]),
    profilePolicy(['SecurityPolicyID'])
  );
  assert.equal(report.passed, true);
  const entry = report.checks.find(candidate => candidate.ruleId === 'FutureCheckID');
  assert.equal(entry.configured, false);
  assert.equal(entry.status, 'pass');
});

test('an active waiver applies to a below-threshold selected check', async () => {
  const selected = profilePolicy(['MaintainedID']);
  const report = await run(exact([check('Maintained', 0)]), selected, 'repository', '2026-08-12T00:00:00Z');
  assert.equal(report.passed, true);
  assert.equal(report.checks[0].status, 'waived');
});

test('an expired waiver does not hide a below-threshold score', async () => {
  const selected = profilePolicy(['MaintainedID']);
  const report = await run(exact([check('Maintained', 0)]), selected, 'repository', '2026-11-11T00:00:00Z');
  assert.equal(report.passed, false);
  assert.equal(report.checks[0].status, 'fail');
});

test('an active waiver applies to an inconclusive selected check', async () => {
  const selected = profilePolicy(['MaintainedID']);
  const report = await run(exact([check('Maintained', -1)]), selected, 'repository', '2026-08-12T00:00:00Z');
  assert.equal(report.passed, true);
  assert.equal(report.checks[0].status, 'waived');
});

test('a missing selected check fails even when it has an active waiver', async () => {
  const selected = profilePolicy(['MaintainedID']);
  const report = await run(exact([check('Security-Policy', 10)]), selected, 'repository', '2026-08-12T00:00:00Z');
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(item => item.includes('selected check was absent')));
});

test('a configured but profile-excluded low score is visible and does not fail the profile', async () => {
  const report = await run(
    exact([check('Security-Policy', 10), check('Packaging', -1)]),
    profilePolicy(['SecurityPolicyID'])
  );
  assert.equal(report.passed, true);
  const entry = report.checks.find(candidate => candidate.ruleId === 'PackagingID');
  assert.equal(entry.status, 'profile-excluded');
  assert.equal(entry.selected, false);
});

test('duplicate exact checks are rejected', async () => {
  await assert.rejects(
    run(exact([check('Security-Policy', 10), check('Security-Policy', 9)]), profilePolicy(['SecurityPolicyID'])),
    /duplicate check Security-Policy/
  );
});

test('invalid exact scores are rejected', async () => {
  await assert.rejects(
    run(exact([check('Security-Policy', 11)]), profilePolicy(['SecurityPolicyID'])),
    /invalid score/
  );
});

test('unknown profiles are rejected', async () => {
  const { evaluateScorecardPolicy } = await evaluator;
  assert.throws(
    () => evaluateScorecardPolicy({
      exactDocument: exact([check('Security-Policy', 10)]),
      policy,
      profileName: 'unknown',
      evaluatedAt: new Date('2026-08-12T00:00:00Z')
    }),
    /Unknown Scorecard policy profile/
  );
});

test('report ordering and output are deterministic', async () => {
  const selected = profilePolicy(['SecurityPolicyID']);
  const document = exact([
    check('Future-Check', 10),
    check('Packaging', -1),
    check('Security-Policy', 10)
  ]);
  const left = await run(document, selected);
  const right = await run(document, selected);
  assert.deepEqual(left, right);
  assert.deepEqual(left.checks.map(entry => entry.name), ['Future-Check', 'Packaging', 'Security-Policy']);
});

test('the committed policy explicitly configures every check in the pinned Scorecard release', async () => {
  const { scorecardRuleId } = await evaluator;
  for (const name of knownPinnedChecks) {
    assert.ok(policy.checks[scorecardRuleId(name)], `missing policy entry for ${name}`);
  }
});

async function run(exactDocument, selectedPolicy, profileName = 'repository', date = '2026-08-12T00:00:00Z') {
  const { evaluateScorecardPolicy } = await evaluator;
  return evaluateScorecardPolicy({
    exactDocument,
    policy: selectedPolicy,
    profileName,
    evaluatedAt: new Date(date)
  });
}

function profilePolicy(ruleIds) {
  const selected = structuredClone(policy);
  selected.profiles.repository = ruleIds;
  selected.profiles['pull-request'] = ruleIds;
  return selected;
}

function check(name, score) {
  return {
    name,
    score,
    reason: `synthetic ${name} evidence`,
    documentation: { url: `https://example.test/${name}` }
  };
}

function exact(checks) {
  return {
    repo: { name: 'github.com/PPadgett/m365-copilot-vscode', commit: 'abc123' },
    scorecard: { version: 'v5.5.0', commit: 'scorecard-commit' },
    checks
  };
}
