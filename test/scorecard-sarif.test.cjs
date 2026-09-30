const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const converter = import(
  pathToFileURL(resolve(root, 'scripts/lib/scorecard-sarif.mjs')).href
);

test('exact Scorecard JSON converts to locationless advisory SARIF', async () => {
  const { convertScorecardJsonToSarif } = await converter;
  const sarif = convertScorecardJsonToSarif({
    repo: {
      name: 'github.com/PPadgett/m365-copilot-vscode',
      commit: 'abc123'
    },
    scorecard: {
      version: 'v5.5.0',
      commit: 'scorecard-commit'
    },
    checks: [
      check('Security-Policy', 10),
      check('Maintained', 0),
      check('Packaging', -1)
    ]
  });

  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs.length, 1);
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, 'OpenSSF Scorecard');
  assert.equal(run.tool.driver.semanticVersion, '5.5.0');
  assert.deepEqual(
    run.results.map(result => result.ruleId),
    ['MaintainedID', 'PackagingID']
  );
  assert.ok(
    run.results.every(result => !Object.hasOwn(result, 'locations')),
    'repository-level Scorecard findings must remain locationless'
  );
  assert.equal(
    run.versionControlProvenance[0].repositoryUri,
    'https://github.com/PPadgett/m365-copilot-vscode'
  );
});

test('malformed exact evidence fails before SARIF generation', async () => {
  const { convertScorecardJsonToSarif } = await converter;
  assert.throws(
    () =>
      convertScorecardJsonToSarif({
        scorecard: { version: 'v5.5.0' },
        checks: [check('Security-Policy', 10)]
      }),
    /scorecard\.commit/
  );
});

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
