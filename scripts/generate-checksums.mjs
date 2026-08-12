import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = join(root, 'artifacts');
const files = (await readdir(artifacts))
  .filter(name => name !== 'SHA256SUMS' && !name.endsWith('.sig'))
  .sort();
const lines = [];
for (const name of files) {
  const digest = createHash('sha256').update(await readFile(join(artifacts, name))).digest('hex');
  lines.push(`${digest}  ${name}`);
}
await writeFile(join(artifacts, 'SHA256SUMS'), `${lines.join('\n')}\n`);
console.log(`Created checksums for ${files.length} artifact(s).`);
