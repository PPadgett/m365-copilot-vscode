import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './vsix-archive.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const vsixPath = process.argv[2]
  ? join(root, process.argv[2])
  : join(root, 'artifacts', `${packageJson.name}-${packageJson.version}.vsix`);
const archive = await readFile(vsixPath);
const files = readZip(archive);

const expectedFiles = new Set([
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  ...(await findJavaScriptFiles(join(root, 'dist'))).map(path => `extension/${path}`)
]);

assert(files.size === expectedFiles.size, `Expected ${expectedFiles.size} VSIX files, found ${files.size}.`);
for (const path of expectedFiles) {
  assert(files.has(path), `VSIX is missing ${path}.`);
}
for (const path of files.keys()) {
  assert(expectedFiles.has(path), `VSIX contains unexpected file ${path}.`);
}

const packagedManifest = parseJson(files.get('extension/package.json'), 'extension/package.json');
for (const property of ['name', 'displayName', 'description', 'version', 'publisher', 'license', 'main']) {
  assert(
    packagedManifest[property] === packageJson[property],
    `Packaged package.json property ${property} does not match the source manifest.`
  );
}
assert(packagedManifest.preview === true, 'Packaged extension must remain marked preview.');
assert(packagedManifest.dependencies === undefined, 'Packaged extension must not contain runtime npm dependencies.');
assert(packagedManifest.main === './dist/extension.js', 'Packaged extension entry point is invalid.');

const contentTypes = text(files.get('[Content_Types].xml'));
for (const [extension, mime] of [
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.txt', 'text/plain'],
  ['.vsixmanifest', 'text/xml']
]) {
  assert(
    contentTypes.includes(`Extension="${extension}" ContentType="${mime}"`),
    `VSIX content types are missing ${extension} -> ${mime}.`
  );
}

const vsixManifest = text(files.get('extension.vsixmanifest'));
const escapedName = xml(packageJson.name);
const escapedVersion = xml(packageJson.version);
const escapedPublisher = xml(packageJson.publisher);
for (const marker of [
  '<PackageManifest Version="2.0.0"',
  'xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"',
  `Id="${escapedName}"`,
  `Version="${escapedVersion}"`,
  `Publisher="${escapedPublisher}"`,
  '<GalleryFlags>Public Preview</GalleryFlags>',
  'Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true"',
  '<License>extension/LICENSE.txt</License>',
  'Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json"',
  'Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md"',
  'Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md"',
  'Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt"'
]) {
  assert(vsixManifest.includes(marker), `VSIX manifest is missing required marker: ${marker}`);
}

for (const path of ['extension/readme.md', 'extension/changelog.md', 'extension/LICENSE.txt']) {
  assert(text(files.get(path)).trim().length > 0, `${path} must not be empty.`);
}

const digest = createHash('sha256').update(archive).digest('hex');
console.log(`Validated ${relative(root, vsixPath)} (${files.size} files, sha256:${digest}).`);

async function findJavaScriptFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await findJavaScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      paths.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  return paths.sort();
}

function parseJson(buffer, path) {
  try {
    return JSON.parse(text(buffer));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function text(buffer) {
  assert(Buffer.isBuffer(buffer), 'Expected a packaged file buffer.');
  return buffer.toString('utf8');
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
