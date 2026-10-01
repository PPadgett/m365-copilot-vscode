export const REPOSITORY = 'PPadgett/m365-copilot-vscode';
export const WORKFLOW = '.github/workflows/historical-ci.yml';
export const CONTEXT = 'historical-tests/retrospective';
export const TARGETS = Object.freeze([
  Object.freeze({ pr: 1, sha: 'c2e711bbbd3f4fd51ce62ecce1ce1ffe35f82272' }),
  Object.freeze({ pr: 2, sha: '99ceaf674dd9ca7e5dd58d8d8e54aa78f49c41b7' }),
  Object.freeze({ pr: 5, sha: 'f70b9856cd4227e1eb08c926224f3ace58a5b126' })
]);

const CI_PATTERNS = ['appveyor', 'buildkite', 'circleci', 'e2e', 'github-actions',
  'jenkins', 'mergeable', 'packit-as-a-service', 'semaphoreci', 'test', 'travis-ci',
  'flutter-dashboard', 'cirrus-ci', 'azure-pipelines', 'ci/woodpecker', 'vstfs:///build/build'];

export function requireTarget(pr, sha) {
  const target = TARGETS.find(item => item.pr === Number(pr) && item.sha === sha);
  if (!target) throw new Error('Historical target is not allowlisted.');
  return target;
}

export function qualifies({ checks = [], statuses = [] }) {
  const ci = value => typeof value === 'string'
    && CI_PATTERNS.some(pattern => value.toLowerCase().includes(pattern));
  return checks.some(check => check.status === 'completed' && check.conclusion === 'success'
    && ci(check.app?.slug)) || statuses.some(status => status.state === 'success'
    && (ci(status.context) || ci(status.target_url)));
}

export async function getEvidence(api, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid commit SHA.');
  const [checks, statuses] = await Promise.all([
    api.pages(`/repos/${REPOSITORY}/commits/${sha}/check-runs`, 'check_runs'),
    api.pages(`/repos/${REPOSITORY}/commits/${sha}/statuses`)
  ]);
  return { checks, statuses };
}

export async function planTargets(api, retest = false) {
  const selected = [];
  for (const target of TARGETS) {
    const pr = await api.request(`/repos/${REPOSITORY}/pulls/${target.pr}`);
    if (!pr.merged_at || pr.head?.sha !== target.sha || pr.base?.repo?.full_name !== REPOSITORY
      || pr.head?.repo?.full_name !== REPOSITORY) throw new Error(`PR ${target.pr} identity changed.`);
    if (retest || !qualifies(await getEvidence(api, target.sha))) selected.push(target);
  }
  return selected;
}

export function approvedStatuses({ run, jobs, selected, expectedRunId, expectedHeadSha }) {
  if (!Array.isArray(selected) || !selected.length || new Set(selected.map(x => x.sha)).size !== selected.length)
    throw new Error('No unique selected targets.');
  if (run.id !== Number(expectedRunId) || run.run_attempt !== 1 || run.event !== 'workflow_dispatch'
    || run.head_branch !== 'main' || run.head_sha !== expectedHeadSha
    || run.repository?.full_name !== REPOSITORY || run.path !== WORKFLOW)
    throw new Error('Reporter run identity is not the trusted main workflow first attempt.');
  const targetUrl = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`;
  if (run.html_url !== targetUrl) throw new Error('Reporter run URL mismatch.');
  // Validate the complete batch before returning any writes. Never trust artifacts or historical outputs.
  return selected.map(item => {
    const target = requireTarget(item.pr, item.sha);
    const matches = jobs.filter(job => job.name === `Historical tests PR ${target.pr} (${target.sha})`);
    if (matches.length !== 1) throw new Error(`Missing or duplicate historical job for PR ${target.pr}.`);
    const job = matches[0];
    if (job.run_id !== run.id || job.run_attempt !== 1 || job.head_sha !== expectedHeadSha
      || job.status !== 'completed' || job.conclusion !== 'success'
      || !Number.isFinite(Date.parse(job.started_at)) || Date.parse(job.completed_at) < Date.parse(job.started_at)
      || !Number.isFinite(Date.parse(job.completed_at))) throw new Error('Historical job did not complete successfully.');
    for (const name of ['Verify exact historical checkout', 'Install locked dependencies without scripts',
      'Run genuine historical build and tests']) {
      const steps = (job.steps ?? []).filter(step => step.name === name);
      if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success')
        throw new Error(`Required historical step did not succeed: ${name}`);
    }
    return { sha: target.sha, body: { state: 'success', context: CONTEXT, target_url: targetUrl,
      description: 'Real retrospective build/tests completed now; not original PR-time evidence.' } };
  });
}

export async function health(api) {
  const commits = await api.request(`/repos/${REPOSITORY}/commits?sha=main&per_page=30`);
  if (!Array.isArray(commits) || !commits.length) throw new Error('No recent commit evidence.');
  const heads = new Map();
  for (const commit of commits) {
    if (!/^[0-9a-f]{40}$/.test(commit.sha)) throw new Error('Invalid recent commit SHA.');
    const prs = await api.pages(`/repos/${REPOSITORY}/commits/${commit.sha}/pulls`);
    for (const pr of prs) if (pr.merged_at && pr.base?.repo?.full_name === REPOSITORY) {
      if (!/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '')) throw new Error('Malformed merged PR head.');
      heads.set(pr.head.sha, { pr: pr.number, sha: pr.head.sha, mergedAt: pr.merged_at });
    }
  }
  if (!heads.size) throw new Error('No merged PR heads in the recent sample.');
  const sample = [];
  for (const head of heads.values()) sample.push({ ...head, qualified: qualifies(await getEvidence(api, head.sha)) });
  let retention;
  try { retention = await api.request(`/repos/${REPOSITORY}/actions/permissions/artifact-and-log-retention`); }
  catch (error) {
    if (![403, 404].includes(error.status)) throw error;
    retention = { days: null, visibility: 'Unavailable to this read-only workflow token.' };
  }
  if (retention.days != null && (!Number.isInteger(retention.days) || retention.days < 1 || retention.days > 90))
    throw new Error('Invalid public-repository retention evidence.');
  const missing = sample.filter(item => !item.qualified);
  return { evaluatedAt: new Date().toISOString(), sample, missing, retention,
    passed: missing.length === 0, note: 'Recent 30-commit approximation; authoritative Scorecard may select a different sample.' };
}

export function githubApi(token, transport = fetch) {
  if (typeof token !== 'string' || !token) throw new Error('Read-only or scoped workflow token is required.');
  const request = async (path, body) => {
    if (!path.startsWith(`/repos/${REPOSITORY}/`) || path.includes('..')) throw new Error('API path outside repository.');
    const response = await transport(`https://api.github.com${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) {
      const error = new Error(`GitHub API ${response.status}: ${path}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  const pages = async (path, property) => {
    const rows = [];
    for (let page = 1; page <= 10; page += 1) {
      const document = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const items = property ? document[property] : document;
      if (!Array.isArray(items)) throw new Error('Malformed paginated GitHub evidence.');
      rows.push(...items);
      if (items.length < 100) return rows;
    }
    throw new Error('GitHub evidence exceeded bounded pagination.');
  };
  return { request, pages };
}
