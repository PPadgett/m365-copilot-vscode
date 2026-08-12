import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const artifacts = join(root, 'artifacts');
const vsixName = `${packageJson.name}-${packageJson.version}.vsix`;
const sbomPath = join(artifacts, `${packageJson.name}-${packageJson.version}.cdx.json`);
const sbom = JSON.parse(await readFile(sbomPath, 'utf8'));
const applicationRef = `pkg:generic/${encodeURIComponent(packageJson.name)}@${packageJson.version}`;

assert(sbom.bomFormat === 'CycloneDX', 'SBOM bomFormat must be CycloneDX.');
assert(sbom.specVersion === '1.6', 'SBOM specVersion must be 1.6.');
assert(sbom.version === 1, 'SBOM document version must be 1.');
assert(!Number.isNaN(Date.parse(sbom.metadata?.timestamp)), 'SBOM metadata timestamp is invalid.');
assert(sbom.metadata?.component?.['bom-ref'] === applicationRef, 'SBOM application bom-ref is invalid.');
assert(sbom.metadata?.component?.purl === applicationRef, 'SBOM application purl is invalid.');
assert(sbom.metadata?.component?.version === packageJson.version, 'SBOM application version is invalid.');

const actualDigest = createHash('sha256')
  .update(await readFile(join(artifacts, vsixName)))
  .digest('hex')
  .toUpperCase();
const declaredDigest = sbom.metadata?.component?.hashes?.find(hash => hash.alg === 'SHA-256')?.content;
assert(declaredDigest === actualDigest, 'SBOM SHA-256 does not match the VSIX.');

const components = Array.isArray(sbom.components) ? sbom.components : [];
for (const component of components) {
  assert(component.type === 'library', `SBOM component ${component.name ?? '<unknown>'} has an invalid type.`);
  assert(component.scope === 'excluded', `Build dependency ${component.name ?? '<unknown>'} must be excluded from runtime scope.`);
  assert(typeof component.purl === 'string' && component.purl.startsWith('pkg:npm/'), `SBOM component ${component.name ?? '<unknown>'} has an invalid npm purl.`);
}

const applicationDependency = Array.isArray(sbom.dependencies)
  ? sbom.dependencies.find(dependency => dependency.ref === applicationRef)
  : undefined;
assert(applicationDependency, 'SBOM is missing the application dependency graph entry.');
assert(
  Array.isArray(applicationDependency.dependsOn) && applicationDependency.dependsOn.length === 0,
  'The VSIX must not declare runtime npm dependencies.'
);

console.log(`Validated ${relative(root, sbomPath)} and its VSIX digest binding.`);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
