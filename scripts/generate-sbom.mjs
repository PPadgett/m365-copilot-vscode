import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
const vsixDigest = createHash('sha256')
  .update(await readFile(join(artifacts, vsixName)))
  .digest('hex')
  .toUpperCase();
const applicationRef = `pkg:generic/${encodeURIComponent(packageJson.name)}@${packageJson.version}`;

const components = [];
for (const [path, metadata] of Object.entries(packageLock.packages ?? {})) {
  if (!path.startsWith('node_modules/') || !metadata.version) {
    continue;
  }
  const name = path.slice('node_modules/'.length);
  const component = {
    type: 'library',
    'bom-ref': `pkg:npm/${encodePurlName(name)}@${metadata.version}`,
    name,
    version: metadata.version,
    scope: 'excluded',
    purl: `pkg:npm/${encodePurlName(name)}@${metadata.version}`,
    properties: [
      {
        name: 'm365-copilot:dependency-scope',
        value: 'development/build only; not shipped as a runtime dependency'
      }
    ]
  };
  const hash = integrityHash(metadata.integrity);
  if (hash) {
    component.hashes = [hash];
  }
  components.push(component);
}

const timestamp = sourceDate();
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  version: 1,
  metadata: {
    timestamp: timestamp.toISOString(),
    component: {
      type: 'application',
      'bom-ref': applicationRef,
      name: packageJson.name,
      version: packageJson.version,
      purl: applicationRef,
      supplier: {
        name: 'PPadgett and contributors'
      },
      hashes: [
        {
          alg: 'SHA-256',
          content: vsixDigest
        }
      ],
      licenses: [
        {
          license: {
            id: packageJson.license
          }
        }
      ],
      externalReferences: [
        {
          type: 'vcs',
          url: packageJson.repository.url
        },
        {
          type: 'distribution',
          url: `https://github.com/PPadgett/m365-copilot-vscode/releases/download/v${packageJson.version}/${vsixName}`
        }
      ],
      properties: [
        {
          name: 'm365-copilot:runtime-npm-dependencies',
          value: '0'
        },
        {
          name: 'm365-copilot:publisher',
          value: packageJson.publisher
        }
      ]
    }
  },
  components: components.sort((left, right) => left.name.localeCompare(right.name)),
  dependencies: [
    {
      ref: applicationRef,
      dependsOn: []
    }
  ]
};

const output = join(artifacts, `${packageJson.name}-${packageJson.version}.cdx.json`);
await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Created ${output}.`);

function integrityHash(integrity) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    return undefined;
  }
  return {
    alg: 'SHA-512',
    content: Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex').toUpperCase()
  };
}

function encodePurlName(name) {
  return name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
}

function sourceDate() {
  const epoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? '', 10);
  return Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date();
}
