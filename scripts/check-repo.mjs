import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const requiredFiles = [
  '.editorconfig',
  '.gitattributes',
  '.github/CODEOWNERS',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/release.yml',
  '.github/workflows/scorecard.yml',
  '.github/workflows/secret-scan.yml',
  '.gitignore',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'LICENSE',
  'MAINTAINERS.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/architecture.md',
  'docs/devsecops.md',
  'docs/releasing.md',
  'docs/repository-settings.md',
  'docs/threat-model.md',
  'package-lock.json',
  'package.json',
  'scripts/check-reproducible.mjs',
  'scripts/validate-vsix.mjs',
  'scripts/validate-sbom.mjs'
];

for (const path of requiredFiles) {
  if (!(await exists(join(root, path)))) {
    failures.push(`Missing required repository file: ${path}`);
  }
}

if (await exists(join(root, 'src/vscode.d.ts'))) {
  failures.push('src/vscode.d.ts must not be vendored; use @types/vscode.');
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));

if (packageJson.publisher !== 'ppadgett') {
  failures.push('package.json publisher must be ppadgett.');
}
if (packageJson.preview !== true) {
  failures.push('The extension must remain marked as preview while it depends on a beta Graph API.');
}
if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) {
  failures.push('The extension must not add runtime npm dependencies without an explicit security review.');
}
if (packageJson.contributes?.configuration?.properties?.['m365Copilot.enableToolCalling']?.default !== false) {
  failures.push('Experimental tool calling must remain disabled by default.');
}
if (packageJson.contributes?.configuration?.properties?.['m365Copilot.inlineCompletions']?.default !== false) {
  failures.push('Experimental inline completions must remain disabled by default.');
}
if (!packageJson.capabilities || packageJson.capabilities.untrustedWorkspaces?.supported !== false) {
  failures.push('The extension must remain disabled in untrusted workspaces.');
}
if (packageJson.activationEvents?.includes('onStartupFinished')) {
  failures.push('The extension must not activate on every VS Code startup.');
}
if (!packageJson.activationEvents?.includes('onLanguageModelChatProvider:m365-copilot-graph')) {
  failures.push('The extension must activate when its language-model provider is requested.');
}
for (const script of ['validate:vsix', 'reproducible', 'validate:sbom', 'checksums']) {
  if (typeof packageJson.scripts?.[script] !== 'string') {
    failures.push(`package.json is missing required script ${script}.`);
  }
}

for (const [name, version] of Object.entries(packageJson.devDependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version))) {
    failures.push(`Dev dependency ${name} must use an exact version, not ${version}.`);
  }
  const locked = packageLock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) {
    failures.push(`Lockfile version for ${name} (${locked ?? 'missing'}) does not match ${version}.`);
  }
}

const workflowDirectory = join(root, '.github/workflows');
if (await exists(workflowDirectory)) {
  for (const entry of await readdir(workflowDirectory)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) {
      continue;
    }
    const path = join(workflowDirectory, entry);
    const text = await readFile(path, 'utf8');
    if (/\bpull_request_target\s*:/.test(text)) {
      failures.push(`${entry}: pull_request_target is prohibited.`);
    }
    if (!/^permissions:/m.test(text)) {
      failures.push(`${entry}: define top-level least-privilege permissions.`);
    }
    if (/^permissions:\s*read-all\s*$/m.test(text)) {
      failures.push(`${entry}: permissions: read-all is broader than necessary.`);
    }
    const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)];
    for (const match of uses) {
      const value = match[1];
      const ref = value?.split('@').at(-1) ?? '';
      if (!/^[0-9a-f]{40}$/.test(ref)) {
        failures.push(`${entry}: action must be pinned to a full commit SHA: ${value}`);
      }
    }
    const checkoutCount = uses.filter(match => match[1]?.startsWith('actions/checkout@')).length;
    const hardenedCheckoutCount = (text.match(/persist-credentials:\s*false/g) ?? []).length;
    if (checkoutCount !== hardenedCheckoutCount) {
      failures.push(`${entry}: every checkout step must set persist-credentials: false.`);
    }
    const jobs = (text.match(/^\s{2}[A-Za-z0-9_-]+:\s*$/gm) ?? []).length;
    const timeouts = (text.match(/^\s{4}timeout-minutes:\s*\d+/gm) ?? []).length;
    if (jobs > 0 && timeouts === 0) {
      failures.push(`${entry}: jobs must define timeout-minutes.`);
    }
    if (/\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/.test(text)) {
      failures.push(`${entry}: pipe-to-shell installation is prohibited.`);
    }
  }
}

const textExtensions = new Set([
  '', '.cjs', '.css', '.editorconfig', '.gitattributes', '.gitignore', '.html', '.js', '.json',
  '.md', '.mjs', '.ps1', '.sh', '.ts', '.txt', '.xml', '.yaml', '.yml'
]);
for (const path of await walk(root)) {
  const rel = relative(root, path).replaceAll('\\', '/');
  if (rel.startsWith('.git/') || rel.startsWith('artifacts/') || rel.startsWith('dist/') || rel.startsWith('node_modules/')) {
    continue;
  }
  if (!textExtensions.has(extname(path)) && !['LICENSE', '.npmrc', '.nvmrc', '.vscodeignore'].includes(rel)) {
    continue;
  }
  const data = await readFile(path);
  if (data.includes(0)) {
    continue;
  }
  const text = data.toString('utf8');
  if (text.includes('\r')) {
    failures.push(`${rel}: use LF line endings.`);
  }
  if (!text.endsWith('\n')) {
    failures.push(`${rel}: add a final newline.`);
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${rel}:${index + 1}: remove trailing whitespace.`);
    }
  });
}

if (failures.length > 0) {
  console.error(`Repository checks failed (${failures.length}):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log('Repository policy checks passed.');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await walk(path));
    } else if (entry.isFile()) {
      paths.push(path);
    }
  }
  return paths;
}
