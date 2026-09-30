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

const fixtureChecks = { ...committedPolicy.checks, PackagingID: { name: 'Packaging', minimumScore: 10 } };

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
    fixtureChecks.PackagingID
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

test('unconfigured pinned checks remain fail closed without new floors or waivers', async () => {
  const { scorecardRuleId, validatePolicy } = await evaluator;
  validatePolicy(committedPolicy);
  for (const name of knownPinnedChecks) {
    const ruleId = scorecardRuleId(name);
    if (committedPolicy.checks[ruleId]) continue;
    const report = await run(exact([check(name, 0)]), committedPolicy);
    assert.ok(report.failures.some(item => item.includes('Unconfigured Scorecard check ' + name)));
  }
});

for (const [date, active] of [
  ['2026-09-30T23:59:59.999Z', true],
  ['2026-10-01T00:00:00.000Z', false]
]) {
  for (const score of [0, -1, null]) {
    test('CII waiver boundary ' + date + ' with score ' + score, async () => {
      const policy = policyFor(['CIIBestPracticesID']);
      policy.checks.CIIBestPracticesID.waiver = {
        expires: '2026-09-30', reason: 'Synthetic expiry boundary test only.'
      };
      const evidence = score === null
        ? [check('Security-Policy', 10)] : [check('CII-Best-Practices', score)];
      const report = await run(exact(evidence), policy, 'repository', date);
      assert.equal(report.passed, active);
    });
  }
}

test('CII score 2 passes after midnight without a waiver; regressions fail', async () => {
  assert.equal(committedPolicy.checks.CIIBestPracticesID.waiver, undefined);
  for (const score of [2, 0, -1, null]) {
    const evidence = score === null
      ? [check('Security-Policy', 10)] : [check('CII-Best-Practices', score)];
    const report = await run(exact(evidence), policyFor(['CIIBestPracticesID']),
      'repository', '2026-10-01T00:00:00Z');
    assert.equal(report.passed, score === 2);
  }
});

test('historical main evidence passes CII and preserves four unrelated failures after midnight', async () => {
  const evidence = JSON.parse(readFileSync(join(root,
    'docs/evidence/scorecard-2026-09-21.json'), 'utf8'));
  const report = await run(evidence, committedPolicy, 'repository', '2026-10-01T00:00:00Z');
  assert.equal(report.passed, false);
  assert.equal(report.checks.find(entry => entry.ruleId === 'CIIBestPracticesID').status, 'pass');
  assert.deepEqual(report.checks.filter(entry => entry.status === 'fail').map(entry => entry.ruleId),
    ['CITestsID', 'ContributorsID', 'PackagingID', 'SignedReleasesID']);
  assert.equal(committedPolicy.checks.BranchProtectionID.minimumScore, 8);
  assert.equal(committedPolicy.checks.CodeReviewID.minimumScore, 6);
});

test('legacy SARIF gate refuses ambiguous evidence', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-scorecard-sarif.mjs')],
    { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SARIF is advisory only/);
});

test('scanner diagnostic details survive evaluation without changing scores or failures', async () => {
  const evidence = JSON.parse(readFileSync(join(root,
    'docs/evidence/scorecard-pr21-2026-09-30.json'), 'utf8'));
  const report = await run(evidence, committedPolicy, 'pull-request', '2026-09-30T22:31:43Z');
  assert.deepEqual(report.checks.filter(entry => entry.status === 'fail').map(entry => entry.ruleId),
    ['LicenseID', 'PackagingID']);
  for (const name of ['License', 'Packaging']) {
    const entry = report.checks.find(candidate => candidate.name === name);
    assert.deepEqual(entry.details, evidence.checks.find(check => check.name === name).details);
  }
});

test('malformed diagnostic details are rejected; null details remain valid', async () => {
  for (const details of [{ warning: 'bad' }, [123]]) {
    const item = check('Security-Policy', 10);
    item.details = details;
    await assert.rejects(run(exact([item]), policyFor(['SecurityPolicyID'])), /invalid details/);
  }
  const item = check('Security-Policy', 10);
  item.details = null;
  const report = await run(exact([item]), policyFor(['SecurityPolicyID']));
  assert.equal(report.passed, true);
  assert.deepEqual(report.checks[0].details, []);
});

test('local schema gate remains valid after all waiver dates; evidence gate enforces expiry', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [join(root, 'scripts/check-repo.mjs')], {
    encoding: 'utf8', env: { ...process.env, REPOSITORY_POLICY_DATE: '2027-01-01T00:00:00Z' }
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
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
    checks[ruleId] = structuredClone(fixtureChecks[ruleId]);
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
