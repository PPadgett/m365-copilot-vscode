import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const outputDirectory = join(root, 'artifacts');
const outputPath = process.argv[2]
  ? join(root, process.argv[2])
  : join(outputDirectory, `${packageJson.name}-${packageJson.version}.vsix`);

const runtimeFiles = [
  { source: 'package.json', destination: 'extension/package.json' },
  { source: 'README.md', destination: 'extension/readme.md' },
  { source: 'CHANGELOG.md', destination: 'extension/changelog.md' },
  { source: 'LICENSE', destination: 'extension/LICENSE.txt' },
  ...(await findJavaScriptFiles(join(root, 'dist'))).map(file => ({
    source: file,
    destination: `extension/${file}`
  }))
];

const entries = [
  {
    path: '[Content_Types].xml',
    data: Buffer.from(contentTypesXml(), 'utf8')
  },
  {
    path: 'extension.vsixmanifest',
    data: Buffer.from(manifestXml(packageJson), 'utf8')
  }
];

for (const file of runtimeFiles) {
  entries.push({
    path: file.destination.replaceAll('\\', '/'),
    data: await readFile(join(root, file.source))
  });
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(join(outputPath, '..'), { recursive: true });
await writeFile(outputPath, createZip(entries));
console.log(`Created ${relative(root, outputPath)} (${(await stat(outputPath)).size.toLocaleString()} bytes).`);

async function findJavaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJavaScriptFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  return files.sort();
}

function contentTypesXml() {
  const contentTypes = [
    ['.js', 'text/javascript'],
    ['.json', 'application/json'],
    ['.md', 'text/markdown'],
    ['.txt', 'text/plain'],
    ['.vsixmanifest', 'text/xml']
  ]
    .map(([extension, contentType]) =>
      `<Default Extension="${extension}" ContentType="${contentType}"/>`
    )
    .sort()
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypes}</Types>
`;
}

function manifestXml(extension) {
  const repository = extension.repository?.url?.replace(/\.git$/, '') ?? '';
  const homepage = extension.homepage ?? `${repository}#readme`;
  const bugs = extension.bugs?.url ?? '';
  const tags = (extension.keywords ?? []).join(',');
  const categories = (extension.categories ?? []).join(',');
  const kind = (extension.extensionKind ?? []).join(',');
  const galleryFlags = ['Public', ...(extension.preview ? ['Preview'] : [])].join(' ');

  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(extension.name)}" Version="${xml(extension.version)}" Publisher="${xml(extension.publisher)}" />
    <DisplayName>${xml(extension.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(extension.description)}</Description>
    <Tags>${xml(tags)}</Tags>
    <Categories>${xml(categories)}</Categories>
    <GalleryFlags>${xml(galleryFlags)}</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(extension.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml(kind)}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${xml(repository)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="${xml(repository)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="${xml(repository)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="${xml(bugs)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="${xml(homepage)}" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/readme.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/changelog.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function createZip(inputEntries) {
  const date = deterministicDate();
  const { time, day } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of [...inputEntries].sort((left, right) => left.path.localeCompare(right.path))) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const flags = 0x0800;
    const method = 8;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(inputEntries.length, 8);
  end.writeUInt16LE(inputEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function deterministicDate() {
  const epoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? '', 10);
  if (Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch * 1000);
  }
  return new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
