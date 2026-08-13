import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const requiredFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/extended-qa.yml',
  'docs/qa-strategy.md',
  'scripts/check-performance.mjs',
  'scripts/lint-source.mjs',
  'scripts/mutation-test.mjs',
  'scripts/smoke-vsix.mjs',
  'scripts/summarize-quality.mjs',
  'scripts/vsix-archive.mjs',
  'src/graphProtocol.ts',
  'src/httpClient.ts',
  'test/extension-smoke.test.cjs',
  'test/graph-client.integration.test.cjs',
  'test/graph-protocol.test.cjs',
  'test/http-client.integration.test.cjs'
];
for (const path of requiredFiles) {
  if (!(await exists(path))) fail(`Missing advanced QA file: ${path}`);
}

const pkg = await json('package.json');
for (const script of [
  'lint',
  'quality:policy',
  'test:unit',
  'test:integration',
  'quality:report',
  'performance',
  'smoke:vsix',
  'test:mutation'
]) {
  if (typeof pkg.scripts?.[script] !== 'string') fail(`package.json is missing ${script}.`);
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  fail('Advanced QA changes must not add runtime npm dependencies.');
}

const ci = await text('.github/workflows/ci.yml');
for (const marker of [
  'name: Workflow Lint',
  'name: Static Quality',
  'name: Tests (Node ${{ matrix.node }})',
  'name: SAST',
  'name: Package',
  'name: Compatibility (${{ matrix.os }})',
  'name: Required'
]) {
  if (!ci.includes(marker)) fail(`CI is missing ${marker}.`);
}
for (const runner of ['ubuntu-24.04', 'windows-2022', 'macos-14']) {
  if (!ci.includes(`- ${runner}`)) fail(`Compatibility matrix is missing ${runner}.`);
}
if (!/raven-actions\/actionlint@[0-9a-f]{40}/.test(ci) || !/version:\s*1\.7\.12/.test(ci)) {
  fail('CI must use a pinned actionlint action and tool version.');
}
if (!/actions\/download-artifact@[0-9a-f]{40}/.test(ci)) {
  fail('Compatibility testing must consume the exact build artifact with a pinned download action.');
}
if ((ci.match(/cache:\s*npm/g) ?? []).length < 4) {
  fail('CI must cache npm downloads in dependency-installing jobs.');
}
for (const marker of [
  'scripts/run-tests.mjs unit',
  'scripts/run-tests.mjs integration',
  'scripts/summarize-quality.mjs',
  'npm run performance',
  'npm run smoke:vsix',
  'npm audit --audit-level=moderate',
  'TESTS_RESULT:',
  'COMPATIBILITY_RESULT:'
]) {
  if (!ci.includes(marker)) fail(`CI is missing advanced quality control ${marker}.`);
}
if (!/if:\s*always\(\)[\s\S]*quality-node-/m.test(ci)) {
  fail('Test evidence must be uploaded even when a test job fails.');
}

const release = await text('.github/workflows/release.yml');
for (const marker of ['npm run verify', 'npm audit --audit-level=moderate', 'npm run performance', 'npm run smoke:vsix']) {
  if (!release.includes(marker)) fail(`Release workflow is missing ${marker}.`);
}

const extended = await text('.github/workflows/extended-qa.yml');
if (!/\bschedule\s*:/.test(extended) || !/name:\s*Mutation Testing/.test(extended) || !/npm run test:mutation/.test(extended)) {
  fail('Extended QA must schedule curated mutation testing.');
}

const strategy = await text('docs/qa-strategy.md');
for (const heading of [
  '## Automated pull-request gates',
  '## Scheduled extended QA',
  '## Manual and conditional validation',
  '## Not currently applicable'
]) {
  if (!strategy.includes(heading)) fail(`QA strategy is missing ${heading}.`);
}

if (failures.length > 0) {
  console.error(`Advanced QA policy failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Advanced QA and DevSecOps pipeline policy passed.');

async function text(path) { return readFile(join(root, path), 'utf8'); }
async function json(path) { return JSON.parse(await text(path)); }
async function exists(path) { try { return (await stat(join(root, path))).isFile(); } catch { return false; } }
function fail(message) { failures.push(message); }
