import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

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

function readZip(buffer) {
  const endOffset = findEndRecord(buffer);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert(buffer.readUInt16LE(endOffset + 4) === 0, 'Multi-disk ZIP archives are not supported.');
  assert(buffer.readUInt16LE(endOffset + 6) === 0, 'Multi-disk ZIP archives are not supported.');
  assert(buffer.readUInt16LE(endOffset + 8) === entryCount, 'ZIP entry counts are inconsistent.');
  assert(centralOffset + centralSize <= endOffset, 'ZIP central directory is out of bounds.');

  const result = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert(buffer.readUInt32LE(cursor) === 0x02014b50, 'Invalid ZIP central-directory signature.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    assert(nameEnd + extraLength + commentLength <= buffer.length, 'ZIP central entry is out of bounds.');
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    validateArchivePath(name);
    assert(!result.has(name), `ZIP contains duplicate path ${name}.`);
    assert((flags & ~0x0800) === 0, `ZIP entry ${name} uses unsupported flags.`);
    assert(method === 0 || method === 8, `ZIP entry ${name} uses unsupported compression.`);

    assert(buffer.readUInt32LE(localOffset) === 0x04034b50, `Invalid local ZIP header for ${name}.`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const localName = buffer.subarray(localNameStart, localNameEnd).toString('utf8');
    assert(localName === name, `ZIP local and central names differ for ${name}.`);
    assert(localFlags === flags && localMethod === method, `ZIP headers disagree for ${name}.`);
    assert(
      localCrc === expectedCrc &&
      localCompressedSize === compressedSize &&
      localUncompressedSize === uncompressedSize,
      `ZIP headers disagree on size or CRC for ${name}.`
    );

    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    assert(dataEnd <= centralOffset, `ZIP entry ${name} overlaps the central directory.`);
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    assert(data.length === uncompressedSize, `ZIP entry ${name} has the wrong uncompressed size.`);
    assert(crc32(data) === expectedCrc, `ZIP entry ${name} failed its CRC check.`);
    result.set(name, data);
    cursor = nameEnd + extraLength + commentLength;
  }
  assert(cursor === centralOffset + centralSize, 'ZIP central-directory size is inconsistent.');
  return result;
}

function findEndRecord(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) {
      continue;
    }
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) {
      return offset;
    }
  }
  throw new Error('ZIP end-of-central-directory record was not found.');
}

function validateArchivePath(path) {
  assert(path.length > 0, 'ZIP entry path must not be empty.');
  assert(!path.includes('\\'), `ZIP entry path must use forward slashes: ${path}`);
  assert(!path.startsWith('/') && !/^[A-Za-z]:/.test(path), `ZIP entry path must be relative: ${path}`);
  assert(!path.split('/').some(part => part === '..' || part === ''), `Unsafe ZIP entry path: ${path}`);
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
