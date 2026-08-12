import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  throw new Error('Provide a release tag as an argument or GITHUB_REF_NAME.');
}
const expected = `v${packageJson.version}`;
if (tag !== expected) {
  throw new Error(`Release tag ${tag} does not match package version ${expected}.`);
}
console.log(`Release tag ${tag} matches package version.`);
