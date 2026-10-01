const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const modulePromise = import(pathToFileURL(resolve(__dirname, '../scripts/lib/historical-evidence.mjs')).href);
const repository = 'PPadgett/m365-copilot-vscode';
const head = 'a'.repeat(40);
const url = `https://github.com/${repository}/actions/runs/123`;

async function fixture() {
  const module = await modulePromise;
  const run = { id: 123, run_attempt: 1, event: 'workflow_dispatch', head_branch: 'main',
    head_sha: head, path: module.WORKFLOW, repository: { full_name: repository }, html_url: url };
  const selected = structuredClone(module.TARGETS);
  const jobs = selected.map(item => ({ name: `Historical tests PR ${item.pr} (${item.sha})`,
    run_id: 123, run_attempt: 1, head_sha: head, status: 'completed', conclusion: 'success',
    started_at: '2026-10-01T10:00:00Z', completed_at: '2026-10-01T10:03:00Z',
    steps: ['Verify exact historical checkout', 'Install locked dependencies without scripts',
      'Run genuine historical build and tests'].map(name => ({ name, status: 'completed', conclusion: 'success' })) }));
  return { module, input: { run, jobs, selected, expectedRunId: '123', expectedHeadSha: head } };
}

test('trusted complete batch yields exact allowlisted truthful current-run statuses', async () => {
  const { module, input } = await fixture();
  const writes = module.approvedStatuses(input);
  assert.deepEqual(writes.map(write => write.sha), module.TARGETS.map(item => item.sha));
  for (const write of writes) {
    assert.equal(write.body.target_url, url);
    assert.equal(write.body.context, module.CONTEXT);
    assert.equal(write.body.state, 'success');
    assert.match(write.body.description, /completed now/);
    assert.equal(write.body.created_at, undefined);
  }
});

for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', null]) {
  test(`no status batch if historical job or required step is ${conclusion}`, async () => {
    const { module, input } = await fixture();
    input.jobs[1].conclusion = conclusion;
    assert.throws(() => module.approvedStatuses(input), /did not complete/);
    input.jobs[1].conclusion = 'success';
    input.jobs[1].steps[2].conclusion = conclusion;
    assert.throws(() => module.approvedStatuses(input), /did not succeed/);
  });
}

test('missing, duplicate, running and malformed-time jobs cannot authorize statuses', async () => {
  for (const mutate of [x => x.jobs.pop(), x => x.jobs.push(x.jobs[0]),
    x => { x.jobs[0].status = 'in_progress'; }, x => { x.jobs[0].started_at = 'not a date'; },
    x => { x.jobs[0].completed_at = '2026-09-01T00:00:00Z'; },
    x => { x.jobs[0].steps.pop(); }, x => { x.jobs[0].run_id = 456; },
    x => { x.jobs[0].run_attempt = 2; }, x => { x.jobs[0].head_sha = 'b'.repeat(40); }]) {
    const { module, input } = await fixture();
    mutate(input);
    assert.throws(() => module.approvedStatuses(input));
  }
});

test('wrong run, event, branch, repository, SHA, workflow, URL or rerun cannot authorize statuses', async () => {
  for (const patch of [{ id: 456 }, { event: 'pull_request' }, { head_branch: 'feature' },
    { repository: { full_name: 'someone/fork' } }, { head_sha: 'b'.repeat(40) },
    { path: '.github/workflows/other.yml' }, { html_url: 'https://example.com' }, { run_attempt: 2 }]) {
    const { module, input } = await fixture();
    Object.assign(input.run, patch);
    assert.throws(() => module.approvedStatuses(input));
  }
});

test('arbitrary and duplicate selected historical heads are rejected', async () => {
  const { module, input } = await fixture();
  assert.throws(() => module.requireTarget(1, 'b'.repeat(40)), /not allowlisted/);
  input.selected.push(input.selected[0]);
  assert.throws(() => module.approvedStatuses(input), /unique/);
  input.selected = [{ pr: 17, sha: 'b'.repeat(40) }];
  assert.throws(() => module.approvedStatuses(input), /not allowlisted/);
});

test('qualifier matches pinned Scorecard app/context rules; CodeQL-only, failed and pending evidence fails', async () => {
  const { qualifies } = await modulePromise;
  assert.equal(qualifies({ checks: [{ status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] }), true);
  assert.equal(qualifies({ checks: [{ status: 'completed', conclusion: 'success', app: { slug: 'github-advanced-security' } }] }), false);
  assert.equal(qualifies({ statuses: [{ state: 'success', context: 'historical-tests/retrospective' }] }), true);
  for (const state of ['failure', 'pending', 'error']) assert.equal(qualifies({ statuses: [{ state, context: 'tests' }] }), false);
  assert.equal(qualifies({ checks: [{ status: 'in_progress', conclusion: 'success', app: { slug: 'github-actions' } }] }), false);
});

test('planner avoids repeated tests once evidence exists and rejects changed PR identity', async () => {
  const module = await modulePromise;
  const api = {
    request: async path => {
      const target = module.TARGETS.find(item => path.endsWith(`/${item.pr}`));
      return { merged_at: '2026-08-12T00:00:00Z', head: { sha: target.sha, repo: { full_name: repository } },
        base: { repo: { full_name: repository } } };
    },
    pages: async (path, property) => property ? [] : [{ state: 'success', context: module.CONTEXT }]
  };
  assert.deepEqual(await module.planTargets(api), []);
  assert.deepEqual(await module.planTargets(api, true), module.TARGETS);
  api.request = async () => ({ merged_at: null });
  await assert.rejects(module.planTargets(api), /identity changed/);
});

test('API transport rejects redirects, repository escape and malformed pages; has a deadline', async () => {
  const { githubApi } = await modulePromise;
  let options;
  const api = githubApi('test-token', async (url, args) => {
    options = args;
    const destination = new URL(url);
    assert.equal(destination.protocol, 'https:');
    assert.equal(destination.hostname, 'api.github.com');
    assert.ok(destination.pathname.startsWith('/repos/PPadgett/m365-copilot-vscode/'));
    return { ok: true, json: async () => ({ wrong: [] }) };
  });
  await assert.rejects(api.request('/repos/other/project/statuses/a'), /outside repository/);
  await assert.rejects(api.pages(`/repos/${repository}/checks`, 'check_runs'), /Malformed/);
  assert.equal(options.redirect, 'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.method, 'GET');
});

test('health lists actionable missing heads and tolerates inaccessible retention without inventing a value', async () => {
  const module = await modulePromise;
  const target = module.TARGETS[0];
  const api = {
    request: async path => {
      if (path.endsWith('per_page=30')) return [{ sha: head }];
      const error = new Error('forbidden'); error.status = 403; throw error;
    },
    pages: async path => path.endsWith('/pulls')
      ? [{ number: 1, merged_at: '2026-08-12T00:00:00Z', head: { sha: target.sha }, base: { repo: { full_name: repository } } }]
      : []
  };
  const report = await module.health(api);
  assert.equal(report.passed, false);
  assert.equal(report.missing[0].sha, target.sha);
  assert.equal(report.retention.days, null);
});

test('workflow privilege boundary: historical code read-only; writes require manual opt-in and trusted reporter', () => {
  const workflow = readFileSync(resolve(__dirname, '../.github/workflows/historical-ci.yml'), 'utf8');
  const historical = workflow.slice(workflow.indexOf('  historical:'), workflow.indexOf('  report:'));
  const reporter = workflow.slice(workflow.indexOf('  report:'));
  assert.doesNotMatch(historical, /statuses: write|secrets\.|id-token:|cache: npm|actions\/cache/);
  assert.doesNotMatch(historical, /actions\/setup-node|ref: \$\{\{ matrix\.sha/);
  assert.match(historical, /sh -c 'npm ci --ignore-scripts --cache \/tmp\/npm'/);
  assert.match(historical, /sh -c 'npm test'/);
  assert.match(historical, /--network=none/);
  assert.match(historical, /--cap-drop=ALL --security-opt=no-new-privileges/);
  assert.match(historical, /node:22-bookworm-slim@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(historical, /--privileged|docker.sock|--pid=host|--network=host|--env-file|--env GITHUB|--env ACTIONS/);
  assert.match(reporter, /inputs.publish_statuses/);
  assert.match(reporter, /needs.historical.result == 'success'/);
  assert.match(reporter, /github.run_attempt == 1/);
  assert.match(reporter, /statuses: write/);
  assert.doesNotMatch(reporter, /working-directory: historical|download-artifact|matrix.sha/);
  const health = readFileSync(resolve(__dirname, '../.github/workflows/evidence-health.yml'), 'utf8');
  assert.doesNotMatch(health, /: write|secrets\.|historical-evidence.mjs report/);
  assert.match(health, /retention-days: 3/);
});

test('checkout verification rejects a valid allowlisted target with different checked-out code', async () => {
  const { spawnSync } = require('node:child_process');
  const module = await modulePromise;
  const target = module.TARGETS[0];
  const result = spawnSync(process.execPath, [resolve(__dirname, '../scripts/historical-evidence.mjs'),
    'verify-checkout', String(target.pr), target.sha, resolve(__dirname, '..')], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Checkout SHA differs/);
});
