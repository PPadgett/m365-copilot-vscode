import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZip } from './vsix-archive.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const vsixPath = process.argv[2]
  ? resolve(root, process.argv[2])
  : await findVsix(resolve(root, 'artifacts'));
const reportDirectory = resolve(
  root,
  process.env.SMOKE_REPORT_DIR ?? 'artifacts'
);
const archive = await readFile(vsixPath);
const files = readZip(archive);
const packagePath = 'extension/package.json';
const manifest = parseJson(files.get(packagePath), packagePath);
const extensionId = `${manifest.publisher}.${manifest.name}`;
const mainPath = normalizeMain(manifest.main);
const packagedMainPath = `extension/${mainPath}`;
assert(files.has(packagedMainPath), `VSIX entry point ${packagedMainPath} is missing.`);
assert(manifest.dependencies === undefined, 'VSIX must not contain runtime npm dependencies.');
assert(manifest.capabilities?.untrustedWorkspaces?.supported === false, 'VSIX must remain disabled in untrusted workspaces.');
assert(Array.isArray(manifest.activationEvents) && manifest.activationEvents.length > 0, 'VSIX activation events are missing.');

const javascriptEntries = [...files.keys()]
  .filter(path => path.startsWith('extension/dist/') && path.endsWith('.js'))
  .sort();
assert(javascriptEntries.length > 0, 'VSIX contains no compiled JavaScript entry points.');

const installRoot = await mkdtemp(join(tmpdir(), 'm365-copilot-vsix-'));
try {
  for (const [path, contents] of files) {
    if (!path.startsWith('extension/')) continue;
    const destination = join(installRoot, ...path.split('/').slice(1));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }

  for (const path of javascriptEntries) {
    const installedPath = join(installRoot, ...path.split('/').slice(1));
    const result = spawnSync(process.execPath, ['--check', installedPath], {
      cwd: installRoot,
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      throw new Error(`Installed JavaScript failed syntax validation for ${path}: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  const installedMain = join(installRoot, ...mainPath.split('/'));
  const installedMainStat = await stat(installedMain);
  assert(installedMainStat.isFile(), 'Installed extension entry point is not a regular file.');

  const digest = createHash('sha256').update(archive).digest('hex');
  const report = {
    schemaVersion: 1,
    extensionId,
    version: manifest.version,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    vsix: relative(root, vsixPath).replaceAll('\\', '/'),
    vsixBytes: archive.length,
    sha256: digest,
    archiveEntries: files.size,
    javascriptEntries: javascriptEntries.length,
    installedMain: mainPath,
    generatedAt: new Date().toISOString()
  };
  await mkdir(reportDirectory, { recursive: true });
  const stem = `vsix-smoke-${process.platform}-${process.arch}`;
  await writeFile(join(reportDirectory, `${stem}.json`), `${JSON.stringify(report, null, 2)}\n`);

  const summary = [
    '## VSIX compatibility smoke test',
    '',
    `- Extension: **${extensionId}@${manifest.version}**`,
    `- Platform: **${process.platform}/${process.arch}** on **${process.version}**`,
    `- Archive: **${files.size}** entries, **${archive.length.toLocaleString()}** bytes`,
    `- JavaScript entry points checked: **${javascriptEntries.length}**`,
    `- Installed entry point: \`${mainPath}\``,
    `- SHA-256: \`${digest}\``
  ].join('\n');
  await writeFile(join(reportDirectory, `${stem}.md`), `${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
  }
  console.log(summary);
} finally {
  await rm(installRoot, { recursive: true, force: true });
}

async function findVsix(directory) {
  const matches = await collectVsix(directory);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one VSIX under ${relative(root, directory)}, found ${matches.length}.`);
  }
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

function normalizeMain(value) {
  if (typeof value !== 'string' || !value.startsWith('./')) {
    throw new Error('VSIX package.json main must be a relative ./ path.');
  }
  const normalized = value.slice(2).replaceAll('\\', '/');
  assert(normalized && !normalized.startsWith('/') && !normalized.split('/').includes('..'), 'VSIX main path is unsafe.');
  return normalized;
}

function parseJson(buffer, path) {
  assert(Buffer.isBuffer(buffer), `VSIX is missing ${path}.`);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
