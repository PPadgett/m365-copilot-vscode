import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = resolve(root, 'dist/core.js');
const original = await readFile(target, 'utf8');
const mutants = [
  {
    name: 'allow unknown tool names',
    search: '!allowedToolNames.has(parsed.name)',
    replacement: 'allowedToolNames.has(parsed.name)'
  },
  {
    name: 'reject valid Microsoft Graph audiences',
    search: 'if (!audiences.some(',
    replacement: 'if (audiences.some('
  },
  {
    name: 'accept tokens expiring exactly now',
    search: 'if (expiration <= nowSeconds)',
    replacement: 'if (expiration < nowSeconds)'
  },
  {
    name: 'invert prototype-pollution key protection',
    search: 'if (PROHIBITED_OBJECT_KEYS.has(key))',
    replacement: 'if (!PROHIBITED_OBJECT_KEYS.has(key))'
  },
  {
    name: 'reject responses exactly at the byte limit',
    search: 'if (received > maxBytes)',
    replacement: 'if (received >= maxBytes)'
  }
];

const results = [];
try {
  for (const mutant of mutants) {
    const occurrences = original.split(mutant.search).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Mutation target ${JSON.stringify(mutant.search)} occurred ${occurrences} times.`);
    }
    await writeFile(target, original.replace(mutant.search, mutant.replacement));
    const run = spawnSync(process.execPath, ['--test', 'test/core.test.cjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' }
    });
    results.push({
      name: mutant.name,
      killed: run.status !== 0,
      exitCode: run.status,
      outputExcerpt: `${run.stdout}\n${run.stderr}`.trim().slice(-2000)
    });
  }
} finally {
  await writeFile(target, original);
}

const survived = results.filter(result => !result.killed);
const reportDirectory = resolve(root, process.env.MUTATION_REPORT_DIR ?? 'artifacts/mutation');
await mkdir(reportDirectory, { recursive: true });
const report = {
  schemaVersion: 1,
  mutants: results.length,
  killed: results.length - survived.length,
  survived: survived.length,
  mutationScore: results.length === 0 ? 0 : ((results.length - survived.length) / results.length) * 100,
  results,
  generatedAt: new Date().toISOString()
};
await writeFile(resolve(reportDirectory, 'mutation-report.json'), `${JSON.stringify(report, null, 2)}\n`);
const summary = [
  '## Curated mutation testing',
  '',
  `- Mutants: **${report.mutants}**`,
  `- Killed: **${report.killed}**`,
  `- Survived: **${report.survived}**`,
  `- Mutation score: **${report.mutationScore.toFixed(2)}%**`,
  ...results.map(result => `  - ${result.killed ? 'Killed' : 'SURVIVED'}: ${result.name}`)
].join('\n');
await writeFile(resolve(reportDirectory, 'mutation-summary.md'), `${summary}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
}
console.log(summary);
if (survived.length > 0) {
  throw new Error(`Mutation policy failed: ${survived.map(result => result.name).join(', ')}.`);
}
