import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertScorecardJsonToSarif } from './lib/scorecard-sarif.mjs';

const root = resolve(import.meta.dirname, '..');
const input = resolve(root, process.argv[2] ?? 'results.json');
const output = resolve(root, process.argv[3] ?? 'results.sarif');

try {
  const document = JSON.parse(await readFile(input, 'utf8'));
  const sarif = convertScorecardJsonToSarif(document);
  await writeFile(output, `${JSON.stringify(sarif, null, 2)}\n`);
} catch (error) {
  console.error(`Scorecard SARIF generation failed: ${error.message}`);
  process.exitCode = 1;
}
