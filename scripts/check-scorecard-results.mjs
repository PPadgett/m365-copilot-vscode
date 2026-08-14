import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  evaluateScorecardPolicy,
  parseEvaluationDate,
  renderSummary
} from './lib/scorecard-policy.mjs';

const root = resolve(import.meta.dirname, '..');

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const exactArgument = argv[0] ?? 'results.json';
  const policyArgument = argv[1] ?? '.github/scorecard-policy.json';
  const reportArgument = argv[2] ?? 'scorecard-policy-report.json';
  const profileName = argv[3] ?? environment.SCORECARD_POLICY_PROFILE ?? 'repository';

  const [exactDocument, policy] = await Promise.all([
    readJson(resolve(root, exactArgument), 'Scorecard exact JSON'),
    readJson(resolve(root, policyArgument), 'Scorecard policy')
  ]);

  const report = evaluateScorecardPolicy({
    exactDocument,
    policy,
    profileName,
    evaluatedAt: parseEvaluationDate(environment.SCORECARD_POLICY_DATE),
    exactScorecardFile: exactArgument,
    policyFile: policyArgument
  });
  await writeFile(resolve(root, reportArgument), `${JSON.stringify(report, null, 2)}\n`);

  const summary = renderSummary(report);
  console.log(summary);
  if (environment.GITHUB_STEP_SUMMARY) {
    await appendFile(environment.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  if (!report.passed) {
    process.exitCode = 1;
  }
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} file could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} file is not valid JSON: ${error.message}`);
  }
}

await main();
