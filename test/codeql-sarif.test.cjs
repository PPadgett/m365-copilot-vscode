const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = resolve(__dirname, '..');
const script = join(root, 'scripts/check-codeql-sarif.mjs');

test('CodeQL policy accepts a valid run with no findings', () => {
  const result = evaluate(makeSarif([]));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.passed, true);
  assert.equal(result.report.codeqlRuns, 1);
  assert.equal(result.report.findingCount, 0);
});

test('CodeQL policy rejects every unsuppressed finding', () => {
  const result = evaluate(makeSarif([
    {
      ruleId: 'js/incomplete-url-substring-sanitization',
      level: 'error',
      message: { text: 'Incomplete URL substring sanitization' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: 'scripts/check-repo.mjs' },
            region: { startLine: 75 }
          }
        }
      ]
    }
  ]));

  assert.notEqual(result.status, 0);
  assert.equal(result.report.passed, false);
  assert.equal(result.report.findingCount, 1);
  assert.equal(result.report.findings[0].ruleId, 'js/incomplete-url-substring-sanitization');
});

test('CodeQL policy ignores explicitly suppressed SARIF results', () => {
  const result = evaluate(makeSarif([
    {
      ruleId: 'js/reviewed-result',
      message: { text: 'Reviewed finding' },
      suppressions: [{ kind: 'external', status: 'accepted', justification: 'Reviewed' }]
    }
  ]));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.findingCount, 0);
});

test('CodeQL policy fails closed on missing CodeQL runs and malformed SARIF', () => {
  const noCodeql = evaluate({ version: '2.1.0', runs: [{ tool: { driver: { name: 'Other' } }, results: [] }] });
  assert.notEqual(noCodeql.status, 0);
  assert.match(noCodeql.stderr, /no CodeQL runs/i);

  const malformed = evaluate({ version: '2.1.0' });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /no runs array/i);
});

function evaluate(sarif) {
  const directory = mkdtempSync(join(tmpdir(), 'codeql-policy-'));
  const sarifPath = join(directory, 'results.sarif');
  const reportPath = join(directory, 'report.json');
  writeFileSync(sarifPath, JSON.stringify(sarif));

  const child = spawnSync(process.execPath, [script, sarifPath, reportPath], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '' }
  });

  return {
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr,
    report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null
  };
}

function makeSarif(results) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeQL',
            rules: [
              {
                id: 'js/incomplete-url-substring-sanitization',
                defaultConfiguration: { level: 'error' }
              },
              {
                id: 'js/reviewed-result',
                defaultConfiguration: { level: 'warning' }
              }
            ]
          }
        },
        results
      }
    ]
  };
}
