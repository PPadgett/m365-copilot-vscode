const assert = require('node:assert/strict');
const { mkdtempSync, symlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = resolve(__dirname, '..');

test('Scorecard CLI fails identically through direct and symlinked paths', t => {
  compareDirectAndSymlink(t, join(root, 'scripts/check-scorecard-results.mjs'), ['missing-results.json']);
});

test('repository audit CLI fails identically through direct and symlinked paths', t => {
  compareDirectAndSymlink(t, join(root, 'scripts/audit-github-rules.mjs'), ['not-a-repository']);
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
