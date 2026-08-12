import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const reportDirectory = resolve(root, process.argv[2] ?? process.env.TEST_REPORT_DIR ?? 'artifacts/quality');
const suite = process.argv[3] ?? 'all';
const lcovPath = resolve(reportDirectory, `${suite}-lcov.info`);
const junitPath = resolve(reportDirectory, `${suite}-junit.xml`);
const lcov = await readFile(lcovPath, 'utf8');
const junit = await readFile(junitPath, 'utf8');

const coverage = parseLcov(lcov);
const tests = parseJunit(junit);
const report = {
  schemaVersion: 1,
  suite,
  tests,
  coverage,
  generatedAt: new Date().toISOString()
};

await mkdir(reportDirectory, { recursive: true });
await writeFile(
  resolve(reportDirectory, `${suite}-quality-report.json`),
  `${JSON.stringify(report, null, 2)}\n`
);

const summary = [
  `## ${title(suite)} quality report`,
  '',
  `- Tests: **${tests.tests}** total, **${tests.failures}** failed, **${tests.skipped}** skipped`,
  `- Line coverage: **${coverage.lines.percent.toFixed(2)}%** (${coverage.lines.covered}/${coverage.lines.total})`,
  `- Branch coverage: **${coverage.branches.percent.toFixed(2)}%** (${coverage.branches.covered}/${coverage.branches.total})`,
  `- Function coverage: **${coverage.functions.percent.toFixed(2)}%** (${coverage.functions.covered}/${coverage.functions.total})`,
  '',
  `Evidence: \`${basename(junitPath)}\`, \`${basename(lcovPath)}\``
].join('\n');
await writeFile(resolve(reportDirectory, `${suite}-quality-summary.md`), `${summary}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
console.log(summary);

function parseLcov(source) {
  const totals = {
    lines: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 }
  };
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('LF:')) totals.lines.total += number(line.slice(3), 'LF');
    else if (line.startsWith('LH:')) totals.lines.covered += number(line.slice(3), 'LH');
    else if (line.startsWith('BRF:')) totals.branches.total += number(line.slice(4), 'BRF');
    else if (line.startsWith('BRH:')) totals.branches.covered += number(line.slice(4), 'BRH');
    else if (line.startsWith('FNF:')) totals.functions.total += number(line.slice(4), 'FNF');
    else if (line.startsWith('FNH:')) totals.functions.covered += number(line.slice(4), 'FNH');
  }
  for (const value of Object.values(totals)) {
    if (value.total <= 0 || value.covered < 0 || value.covered > value.total) {
      throw new Error('LCOV totals are missing or inconsistent.');
    }
    value.percent = (value.covered / value.total) * 100;
  }
  return totals;
}

function parseJunit(source) {
  const tests = commentNumber(source, 'tests');
  const failures = count(source, /<failure\b/g) + count(source, /<error\b/g);
  const skipped = count(source, /<skipped\b/g);
  if (tests <= 0 || failures > tests || skipped > tests) {
    throw new Error('JUnit totals are missing or inconsistent.');
  }
  return { tests, failures, skipped };
}

function commentNumber(source, label) {
  const match = source.match(new RegExp(`<!--\\s*${label}\\s+(\\d+)\\s*-->`));
  if (!match) throw new Error(`JUnit report is missing the ${label} count.`);
  return number(match[1], label);
}
function count(source, pattern) { return source.match(pattern)?.length ?? 0; }
function number(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label} value.`);
  return parsed;
}
function title(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
