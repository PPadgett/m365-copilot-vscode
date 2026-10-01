import { appendFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { approvedStatuses, githubApi, health, planTargets, requireTarget, REPOSITORY } from './lib/historical-evidence.mjs';

const mode = process.argv[2];
if (mode === 'verify-checkout') {
  const target = requireTarget(process.argv[3], process.argv[4]);
  const directory = resolve(process.argv[5] ?? 'historical');
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== target.sha) throw new Error('Checkout SHA differs from allowlist.');
} else {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error('Unexpected workflow repository.');
  const api = githubApi(process.env.GITHUB_TOKEN);
  if (mode === 'plan') {
    const selected = await planTargets(api, process.env.RETEST === 'true');
    await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: selected })}\ncount=${selected.length}\n`);
  } else if (mode === 'report') {
    if (process.env.PUBLISH_STATUSES !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_RUN_ATTEMPT !== '1')
      throw new Error('Status publication requires explicit first-attempt dispatch from main.');
    const selected = JSON.parse(process.env.SELECTED_TARGETS).include;
    const run = await api.request(`/repos/${REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
    const jobs = await api.pages(`/repos/${REPOSITORY}/actions/runs/${run.id}/attempts/1/jobs`, 'jobs');
    const writes = approvedStatuses({ run, jobs, selected,
      expectedRunId: process.env.GITHUB_RUN_ID, expectedHeadSha: process.env.GITHUB_SHA });
    for (const write of writes) await api.request(`/repos/${REPOSITORY}/statuses/${write.sha}`, write.body);
    console.log(`Published ${writes.length} truthful current-dated retrospective test statuses.`);
  } else if (mode === 'health') {
    const report = await health(api);
    await writeFile('evidence-health-report.json', `${JSON.stringify(report, null, 2)}\n`);
    const lines = ['## CI evidence health', '', report.note, '',
      `Qualifying heads: ${report.sample.length - report.missing.length}/${report.sample.length}.`,
      `Repository metadata retention: ${report.retention.days ?? 'not visible'} days.`, '',
      ...report.missing.map(item => `- Missing qualifying evidence: PR #${item.pr}, ${item.sha}`)];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
    if (!report.passed) process.exitCode = 1;
  } else throw new Error('Unknown evidence operation.');
}
