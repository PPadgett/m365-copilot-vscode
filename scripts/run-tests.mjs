import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = join(root, 'test');
const suite = process.argv[2] ?? 'all';
const supportedSuites = new Set(['all', 'unit', 'integration']);
if (!supportedSuites.has(suite)) {
  throw new Error(`Unknown test suite ${JSON.stringify(suite)}. Use all, unit, or integration.`);
}

const candidates = (await readdir(directory))
  .filter(name => name.endsWith('.test.cjs'))
  .sort();
const files = candidates
  .filter(name => {
    const integration = name.endsWith('.integration.test.cjs');
    return suite === 'all' || (suite === 'integration' ? integration : !integration);
  })
  .map(name => join(directory, name));

if (files.length === 0) {
  throw new Error(`No ${suite} test files were found.`);
}

const coverageIncludes = suite === 'unit'
  ? ['dist/core.js', 'dist/graphProtocol.js']
  : suite === 'integration'
    ? ['dist/httpClient.js']
    : ['dist/core.js', 'dist/graphProtocol.js', 'dist/httpClient.js'];

const coverageArgs = [
  '--experimental-test-coverage',
  '--test',
  ...coverageIncludes.map(path => `--test-coverage-include=${path}`),
  '--test-coverage-lines=95',
  '--test-coverage-branches=90',
  '--test-coverage-functions=100'
];

const reportDirectory = process.env.TEST_REPORT_DIR
  ? resolve(root, process.env.TEST_REPORT_DIR)
  : undefined;
if (reportDirectory) {
  await mkdir(reportDirectory, { recursive: true });
  coverageArgs.push(
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${join(reportDirectory, `${suite}-lcov.info`)}`
  );
}
coverageArgs.push(...files);
run(coverageArgs);

if (reportDirectory) {
  run([
    '--test',
    '--test-reporter=junit',
    `--test-reporter-destination=${join(reportDirectory, `${suite}-junit.xml`)}`,
    ...files
  ]);
}

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_NO_WARNINGS: process.env.NODE_NO_WARNINGS ?? '1'
    }
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
