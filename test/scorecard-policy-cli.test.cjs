const assert = require('node:assert/strict');
const {
  mkdtempSync,
  readFileSync,
  writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const cli = import(
  pathToFileURL(resolve(root, 'scripts/lib/scorecard-policy-cli.mjs')).href
);

test('schema failures still produce a diagnostic policy report', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scorecard-report-'));
  const exactPath = join(directory, 'results.json');
  const policyPath = join(directory, 'policy.json');
  const reportPath = join(directory, 'report.json');

  writeFileSync(
    exactPath,
    JSON.stringify({
      scorecard: { version: 'v5.5.0' },
      checks: [
        {
          name: 'Security-Policy',
          score: 10,
          reason: 'synthetic evidence'
        }
      ]
    })
  );
  writeFileSync(
    policyPath,
    JSON.stringify({
      version: 3,
      defaultMinimumScore: 10,
      failOnUnconfiguredResults: true,
      profiles: {
        repository: ['SecurityPolicyID']
      },
      checks: {
        SecurityPolicyID: {
          name: 'Security-Policy',
          minimumScore: 10
        }
      }
    })
  );

  const output = captureOutput();
  const result = await (await cli).runScorecardPolicyCli(
    [exactPath, policyPath, reportPath, 'repository'],
    {},
    output
  );

  assert.equal(result.exitCode, 1);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.passed, false);
  assert.match(report.failures[0], /scorecard\.commit/);
  assert.equal(report.error.name, 'TypeError');
  assert.match(output.stderr.join('\n'), /Scorecard policy failed/);
});

function captureOutput() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    log(value) {
      stdout.push(String(value));
    },
    error(value) {
      stderr.push(String(value));
    }
  };
}
