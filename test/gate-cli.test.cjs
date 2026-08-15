const assert = require('node:assert/strict');
const {
  existsSync,
  mkdtempSync,
  symlinkSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = resolve(__dirname, '..');

test('Scorecard CLI fails identically through direct and symlinked paths', t => {
  const directory = mkdtempSync(join(tmpdir(), 'scorecard-cli-'));
  const report = join(directory, 'report.json');
  compareDirectAndSymlink(
    t,
    join(root, 'scripts/check-scorecard-results.mjs'),
    [
      join(directory, 'missing-results.json'),
      join(root, '.github/scorecard-policy.json'),
      report,
      'pull-request'
    ]
  );
  assert.equal(existsSync(report), true);
});

test('repository audit CLI fails identically through direct and symlinked paths', t => {
  compareDirectAndSymlink(
    t,
    join(root, 'scripts/audit-github-rules.mjs'),
    ['not-a-repository']
  );
});

test('importing CLI implementation modules has no side effects', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gate-import-'));
  const scorecardModule = pathToFileURL(
    join(root, 'scripts/lib/scorecard-policy-cli.mjs')
  ).href;
  const repositoryModule = pathToFileURL(
    join(root, 'scripts/lib/repository-audit-cli.mjs')
  ).href;
  const source = `await import(${JSON.stringify(scorecardModule)}); await import(${JSON.stringify(repositoryModule)});`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' }
    }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(directory, 'scorecard-policy-report.json')), false);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

function compareDirectAndSymlink(t, script, args) {
  const direct = run(script, args);
  assert.notEqual(direct.status, 0, direct.stdout + direct.stderr);

  const directory = mkdtempSync(join(tmpdir(), 'gate-symlink-'));
  const link = join(directory, basename(script));
  try {
    symlinkSync(script, link);
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`symlink creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const linked = run(link, args);
  assert.notEqual(linked.status, 0, linked.stdout + linked.stderr);
  assert.equal(linked.status, direct.status);
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });
}
