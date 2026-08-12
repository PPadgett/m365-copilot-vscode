import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const releasePath = join(root, 'artifacts', `${packageJson.name}-${packageJson.version}.vsix`);
const candidates = [
  join(root, 'artifacts', '.reproducibility-1.vsix'),
  join(root, 'artifacts', '.reproducibility-2.vsix')
];

try {
  const releaseDigest = await digest(releasePath);
  for (const candidate of candidates) {
    const relativePath = relative(root, candidate).replaceAll('\\', '/');
    const result = spawnSync(process.execPath, ['scripts/build-vsix.mjs', relativePath], {
      cwd: root,
      env: process.env,
      stdio: 'inherit'
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`Reproducibility build exited with status ${result.status}.`);
    }
    const candidateDigest = await digest(candidate);
    if (candidateDigest !== releaseDigest) {
      throw new Error(
        `VSIX build is not reproducible: release ${releaseDigest}, candidate ${candidateDigest}.`
      );
    }
  }
  console.log(`Reproducible VSIX confirmed (sha256:${releaseDigest}).`);
} finally {
  await Promise.all(candidates.map(path => rm(path, { force: true })));
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
