import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const {
  REQUIRED_GRAPH_SCOPES,
  cleanCompletion,
  inspectDelegatedGraphToken,
  parseToolCall
} = require(resolve(root, 'dist/core.js'));

const budgets = {
  maxVsixBytes: 512 * 1024,
  maxCompiledJavaScriptBytes: 256 * 1024,
  maxTotalBenchmarkMilliseconds: 3000
};
const artifacts = resolve(root, 'artifacts');
const vsixPath = await findVsix(artifacts);
const vsix = await readFile(vsixPath);
const compiledBytes = await directoryBytes(resolve(root, 'dist'), '.js');
const now = Date.UTC(2026, 0, 1, 0, 0, 0);
const jwt = createJwt({
  aud: 'https://graph.microsoft.com',
  exp: Math.floor(now / 1000) + 3600,
  scp: REQUIRED_GRAPH_SCOPES.join(' ')
});
const toolCall = '<vscode_tool_call>{"name":"read_file","input":{"path":"README.md"}}</vscode_tool_call>';
const allowedTools = new Set(['read_file']);

const benchmarks = [
  benchmark('completion sanitization', 100000, () => cleanCompletion('```ts\nreturn value;\n```')),
  benchmark('tool-call validation', 25000, () => parseToolCall(toolCall, allowedTools)),
  benchmark('delegated-token inspection', 15000, () => inspectDelegatedGraphToken(jwt, now))
];
const totalBenchmarkMilliseconds = benchmarks.reduce((sum, item) => sum + item.durationMilliseconds, 0);
const failures = [];
if (vsix.length > budgets.maxVsixBytes) {
  failures.push(`VSIX size ${vsix.length} exceeds ${budgets.maxVsixBytes} bytes.`);
}
if (compiledBytes > budgets.maxCompiledJavaScriptBytes) {
  failures.push(`Compiled JavaScript size ${compiledBytes} exceeds ${budgets.maxCompiledJavaScriptBytes} bytes.`);
}
if (totalBenchmarkMilliseconds > budgets.maxTotalBenchmarkMilliseconds) {
  failures.push(
    `Core benchmark duration ${totalBenchmarkMilliseconds.toFixed(2)} ms exceeds ` +
    `${budgets.maxTotalBenchmarkMilliseconds} ms.`
  );
}

const digest = createHash('sha256').update(vsix).digest('hex');
const report = {
  schemaVersion: 1,
  budgets,
  measurements: {
    vsixBytes: vsix.length,
    compiledJavaScriptBytes: compiledBytes,
    totalBenchmarkMilliseconds,
    benchmarks
  },
  artifact: {
    path: relative(root, vsixPath).replaceAll('\\', '/'),
    sha256: digest
  },
  runtime: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version
  },
  failures,
  generatedAt: new Date().toISOString()
};
await mkdir(artifacts, { recursive: true });
await writeFile(resolve(artifacts, 'performance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const summary = [
  '## Performance and size budget',
  '',
  `- VSIX: **${formatBytes(vsix.length)}** / ${formatBytes(budgets.maxVsixBytes)}`,
  `- Compiled JavaScript: **${formatBytes(compiledBytes)}** / ${formatBytes(budgets.maxCompiledJavaScriptBytes)}`,
  `- Deterministic core benchmarks: **${totalBenchmarkMilliseconds.toFixed(2)} ms** / ${budgets.maxTotalBenchmarkMilliseconds} ms`,
  ...benchmarks.map(item => `  - ${item.name}: ${item.durationMilliseconds.toFixed(2)} ms (${Math.round(item.operationsPerSecond).toLocaleString()} ops/s)`),
  `- VSIX SHA-256: \`${digest}\``
].join('\n');
await writeFile(resolve(artifacts, 'performance-summary.md'), `${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
}
console.log(summary);
if (failures.length > 0) {
  throw new Error(`Performance policy failed: ${failures.join(' ')}`);
}

function benchmark(name, iterations, operation) {
  for (let index = 0; index < 1000; index += 1) operation();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) operation();
  const durationMilliseconds = performance.now() - started;
  return {
    name,
    iterations,
    durationMilliseconds,
    operationsPerSecond: iterations / (durationMilliseconds / 1000)
  };
}

async function directoryBytes(directory, extension) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(path, extension);
    else if (entry.isFile() && entry.name.endsWith(extension)) bytes += (await stat(path)).size;
  }
  return bytes;
}

async function findVsix(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await collectVsix(path));
    else if (entry.isFile() && entry.name.endsWith('.vsix')) matches.push(path);
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one VSIX under artifacts, found ${matches.length}.`);
  return matches[0];
}

async function collectVsix(directory) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await collectVsix(path));
    else if (entry.isFile() && entry.name.endsWith('.vsix')) matches.push(path);
  }
  return matches;
}

function createJwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.${encode('signature')}`;
}
function formatBytes(value) { return `${(value / 1024).toFixed(1)} KiB`; }
