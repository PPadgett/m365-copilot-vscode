import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const roots = ['src', 'scripts', 'test'];
const files = [];
for (const directory of roots) files.push(...await walk(join(root, directory)));
files.sort();

const failures = [];
for (const path of files) {
  const relativePath = relative(root, path).replaceAll('\\', '/');
  const extension = extname(path);
  if (!['.ts', '.js', '.mjs', '.cjs', '.json'].includes(extension)) continue;
  const source = await readFile(path, 'utf8');

  if (!source.endsWith('\n')) failures.push(`${relativePath}: file must end with a newline.`);
  for (const [index, line] of source.split(/\n/).entries()) {
    if (/[ \t]+$/.test(line)) failures.push(`${relativePath}:${index + 1}: trailing whitespace.`);
  }

  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    const result = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(`${relativePath}: JavaScript syntax check failed: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  if (relativePath.startsWith('src/') && extension === '.ts') {
    lintRuntimeSource(relativePath, source, failures);
  }
}

if (failures.length > 0) {
  console.error(`Source lint failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Source lint passed for ${files.length} files.`);

function lintRuntimeSource(path, source, failures) {
  const prohibited = [
    [/\bconsole\s*\./, 'runtime code must not write to the console because prompts or tokens could be exposed'],
    [/\beval\s*\(/, 'eval is prohibited'],
    [/\bnew\s+Function\s*\(/, 'dynamic Function construction is prohibited'],
    [/from\s+['"]node:child_process['"]|require\s*\(\s*['"]node:child_process['"]\s*\)/, 'child_process is prohibited in the extension runtime'],
    [/@ts-(?:ignore|nocheck)/, 'TypeScript suppression comments are prohibited'],
    [/\bas\s+any\b|:\s*any\b|<any>/, 'explicit any is prohibited in runtime source']
  ];
  for (const [pattern, message] of prohibited) {
    if (pattern.test(source)) failures.push(`${path}: ${message}.`);
  }

  for (const match of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || specifier === 'vscode' || specifier.startsWith('./') || specifier.startsWith('../')) continue;
    failures.push(`${path}: unreviewed runtime package import ${JSON.stringify(specifier)}.`);
  }

  for (const match of source.matchAll(/https?:\/\/[^'"`\s)]+/g)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (url !== 'https://graph.microsoft.com' && !url.startsWith('https://graph.microsoft.com/')) {
      failures.push(`${path}: unexpected runtime network destination ${url}.`);
    }
  }
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'artifacts' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
