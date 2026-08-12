import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, 'test');
const files = (await readdir(directory))
  .filter(name => name.endsWith('.test.cjs'))
  .map(name => join(directory, name))
  .sort();

if (files.length === 0) {
  throw new Error('No test files were found.');
}

const result = spawnSync(process.execPath, [
  '--experimental-test-coverage',
  '--test',
  '--test-coverage-include=dist/core.js',
  '--test-coverage-lines=95',
  '--test-coverage-branches=90',
  '--test-coverage-functions=100',
  ...files
], {
  cwd: root,
  stdio: 'inherit'
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
