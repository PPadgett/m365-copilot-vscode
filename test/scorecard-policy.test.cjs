const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const policy = JSON.parse(readFileSync(join(root, '.github/scorecard-policy.json'), 'utf8'));
const evaluator = import(pathToFileURL(join(root, 'scripts/check-scorecard-sarif.mjs')).href);

test('exact Scorecard scores are used when SARIF legitimately omits a result', async () => {
  const localPolicy = structuredClone(policy);
  localPolicy.profiles.repository = ['MaintainedID'];
  delete localPolicy.checks.MaintainedID.waiver;

  const report = await run(
    sarif(['MaintainedID'], {}),
    exact([{ name: 'Maintained', score: 1 }]),
    localPolicy,
    'repository'
  );

  assert.equal(report.passed, false);
  assert.ok(report.failures.includes('Maintained scored 1; required minimum is 10.'));
  assert.equal(report.checks[0].score, 1);
  assert.equal(report.checks[0].sarifEvidence, 'omitted-as-expected');
});

test('missing and inconsistent Scorecard evidence fails closed', async () => {
  const selected = structuredClone(policy);
  selected.profiles['pull-request'] = ['SecurityPolicyID'];
  const missing = await run(
    sarif(['SecurityPolicyID'], {}),
    exact([{ name: 'Security-Policy', score: 4 }]),
    selected,
    'pull-request'
  );
  assert.equal(missing.passed, false);
  assert.ok(missing.failures.some(item => item.includes('no SARIF result was emitted')));

  const mismatch = await run(
    sarif(['SecurityPolicyID'], { SecurityPolicyID: 3 }),
    exact([{ name: 'Security-Policy', score: 4 }]),
    selected,
    'pull-request'
  );
  assert.equal(mismatch.passed, false);
  assert.ok(mismatch.failures.some(item => item.includes('disagrees with exact JSON score')));
});

async function run(sarifDocument, exactDocument, selectedPolicy, profileName) {
  const { evaluateScorecardPolicy } = await evaluator;
  return evaluateScorecardPolicy({
    sarif: sarifDocument,
    exactDocument,
    policy: selectedPolicy,
    profileName,
    evaluatedAt: new Date('2026-08-12T00:00:00Z')
  });
}

function sarif(ruleIds, scores) {
  return {
    runs: [{
      tool: {
        driver: {
          name: 'Scorecard',
          semanticVersion: 'v5.5.0',
          rules: ruleIds.map(id => ({ id }))
        }
      },
      results: Object.entries(scores).map(([ruleId, score]) => ({
        ruleId,
        message: { text: `${ruleId} score is ${score}` }
      }))
    }]
  };
}

function exact(checks) {
  return {
    scorecard: { version: 'v5.5.0' },
    checks: checks.map(check => ({ ...check, reason: 'synthetic test evidence' }))
  };
}
