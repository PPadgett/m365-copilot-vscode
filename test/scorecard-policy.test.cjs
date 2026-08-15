const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const committedPolicy = JSON.parse(
  readFileSync(join(root, '.github/scorecard-policy.json'), 'utf8')
);
const evaluator = import(
  pathToFileURL(join(root, 'scripts/lib/scorecard-policy.mjs')).href
);

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
    policyFor(['SecurityPolicyID'])
  );

  assert.equal(report.passed, false);
  assert.ok(
    report.failures.some(item =>
      item.includes('Unconfigured Scorecard check Dangerous-New-Check scored 0')
    )
  );
  assert.equal(
    report.checks.find(entry => entry.ruleId === 'DangerousNewCheckID').status,
    'fail'
  );
});

test('an unconfigured inconclusive check fails closed', async () => {
  const report = await run(
    exact([check('Security-Policy', 10), check('Future-Check', -1)]),
    policyFor(['SecurityPolicyID'])
  );
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(item => item.includes('Future-Check was inconclusive')));
});

test('an unconfigured check meeting the default minimum is reported without failing', async () => {
  const report = await run(
    exact([check('Security-Policy', 10), check('Future-Check', 10)]),
    policyFor(['SecurityPolicyID'])
  );
  assert.equal(report.passed, true);
  const entry = report.checks.find(candidate => candidate.ruleId === 'FutureCheckID');
  assert.equal(entry.configured, false);
  assert.equal(entry.status, 'pass');
});

test('an active waiver applies to a below-threshold selected check', async () => {
  const report = await run(
    exact([check('Maintained', 0)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-08-12T00:00:00Z'
  );
  assert.equal(report.passed, true);
  assert.equal(report.checks[0].status, 'waived');
});

test('an expired waiver does not hide a below-threshold score', async () => {
  const report = await run(
    exact([check('Maintained', 0)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-11-11T00:00:00Z'
  );
  assert.equal(report.passed, false);
  assert.equal(report.checks[0].status, 'fail');
});

test('an expired waiver is harmless when the score already passes', async () => {
  const report = await run(
    exact([check('Maintained', 10)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-11-11T00:00:00Z'
  );
  assert.equal(report.passed, true);
  assert.equal(report.checks[0].status, 'pass');
});

test('an active waiver applies to an inconclusive selected check', async () => {
  const report = await run(
    exact([check('Maintained', -1)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-08-12T00:00:00Z'
  );
  assert.equal(report.passed, true);
  assert.equal(report.checks[0].status, 'waived');
});

test('an active waiver covers an absent selected check', async () => {
  const report = await run(
    exact([check('Security-Policy', 10)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-08-12T00:00:00Z'
  );
  assert.equal(report.passed, true);
  const entry = report.checks.find(candidate => candidate.ruleId === 'MaintainedID');
  assert.equal(entry.status, 'waived');
  assert.equal(entry.score, null);
});

test('an expired waiver does not cover an absent selected check', async () => {
  const report = await run(
    exact([check('Security-Policy', 10)]),
    policyFor(['MaintainedID']),
    'repository',
    '2026-11-11T00:00:00Z'
  );
  assert.equal(report.passed, false);
  assert.ok(report.failures.some(item => item.includes('selected check was absent')));
});

test('a configured but profile-excluded low score is visible and does not fail the profile', async () => {
  const selectedPolicy = policyFor(
    ['SecurityPolicyID'],
    ['PackagingID']
  );
  const report = await run(
    exact([check('Security-Policy', 10), check('Packaging', -1)]),
    selectedPolicy
  );
  assert.equal(report.passed, true);
  const entry = report.checks.find(candidate => candidate.ruleId === 'PackagingID');
  assert.equal(entry.status, 'profile-excluded');
  assert.equal(entry.selected, false);
});

test('duplicate exact checks are rejected', async () => {
  await assert.rejects(
    run(
      exact([check('Security-Policy', 10), check('Security-Policy', 9)]),
      policyFor(['SecurityPolicyID'])
    ),
    /duplicate check Security-Policy/
  );
});

test('invalid exact scores are rejected', async () => {
  await assert.rejects(
    run(
      exact([check('Security-Policy', 11)]),
      policyFor(['SecurityPolicyID'])
    ),
    /invalid score/
  );
});

test('policy schema does not create a dated outage for a valid past waiver', async () => {
  const { validatePolicy } = await evaluator;
  const past = policyFor(['MaintainedID']);
  past.checks.MaintainedID.waiver.expires = '2020-01-01';
  assert.doesNotThrow(() => validatePolicy(past));
});

test('invalid calendar waiver dates are rejected instead of rolling over', async () => {
  const { validatePolicy } = await evaluator;
  for (const expires of ['2026-04-31', '2026-02-30']) {
    const malformed = policyFor(['MaintainedID']);
    malformed.checks.MaintainedID.waiver.expires = expires;
    assert.throws(() => validatePolicy(malformed), /Invalid waiver expiry/);
  }
});

test('policy checks and profiles must be plain objects', async () => {
  const { validatePolicy } = await evaluator;
  const checksArray = structuredClone(committedPolicy);
  checksArray.checks = [];
  assert.throws(() => validatePolicy(checksArray), /define checks/);

  const profilesArray = structuredClone(committedPolicy);
  profilesArray.profiles = [];
  assert.throws(() => validatePolicy(profilesArray), /define profiles/);
});

test('every configured check must belong to at least one profile', async () => {
  const { validatePolicy } = await evaluator;
  const malformed = policyFor(['SecurityPolicyID']);
  malformed.checks.PackagingID = structuredClone(
    committedPolicy.checks.PackagingID
  );
  assert.throws(
    () => validatePolicy(malformed),
    /PackagingID must belong to at least one policy profile/
  );
});

test('unknown profiles are rejected', async () => {
  const { evaluateScorecardPolicy } = await evaluator;
  assert.throws(
    () =>
      evaluateScorecardPolicy({
        exactDocument: exact([check('Security-Policy', 10)]),
        policy: committedPolicy,
        profileName: 'unknown',
        evaluatedAt: new Date('2026-08-12T00:00:00Z')
      }),
    /Unknown Scorecard policy profile/
  );
});

test('report ordering and output are deterministic', async () => {
  const selected = policyFor(['SecurityPolicyID'], ['PackagingID']);
  const document = exact([
    check('Future-Check', 10),
    check('Packaging', -1),
    check('Security-Policy', 10)
  ]);
  const left = await run(document, selected);
  const right = await run(document, selected);
  assert.deepEqual(left, right);
  assert.deepEqual(
    left.checks.map(entry => entry.name),
    ['Future-Check', 'Packaging', 'Security-Policy']
  );
});

test('the committed policy explicitly configures and selects every pinned check', async () => {
  const { scorecardRuleId, validatePolicy } = await evaluator;
  validatePolicy(committedPolicy);
  const selected = new Set(Object.values(committedPolicy.profiles).flat());
  for (const name of knownPinnedChecks) {
    const ruleId = scorecardRuleId(name);
    assert.ok(committedPolicy.checks[ruleId], `missing policy entry for ${name}`);
    assert.ok(selected.has(ruleId), `configured check is not selected: ${name}`);
  }
});

async function run(
  exactDocument,
  selectedPolicy,
  profileName = 'repository',
  date = '2026-08-12T00:00:00Z'
) {
  const { evaluateScorecardPolicy } = await evaluator;
  return evaluateScorecardPolicy({
    exactDocument,
    policy: selectedPolicy,
    profileName,
    evaluatedAt: new Date(date)
  });
}

function policyFor(selectedRuleIds, excludedRuleIds = []) {
  const checks = {};
  for (const ruleId of [...selectedRuleIds, ...excludedRuleIds]) {
    checks[ruleId] = structuredClone(committedPolicy.checks[ruleId]);
  }
  return {
    version: 3,
    defaultMinimumScore: 10,
    failOnUnconfiguredResults: true,
    profiles: {
      repository: [...selectedRuleIds],
      'pull-request': [...selectedRuleIds, ...excludedRuleIds]
    },
    checks
  };
}

function check(name, score) {
  return {
    name,
    score,
    reason: `synthetic ${name} evidence`,
    documentation: {
      url: `https://example.test/${name}`,
      short: `Synthetic ${name} check`
    }
  };
}

function exact(checks) {
  return {
    repo: {
      name: 'github.com/PPadgett/m365-copilot-vscode',
      commit: 'abc123'
    },
    scorecard: {
      version: 'v5.5.0',
      commit: 'scorecard-commit'
    },
    checks
  };
}
