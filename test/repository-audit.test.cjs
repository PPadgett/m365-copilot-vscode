const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const policy = JSON.parse(readFileSync(join(root, '.github/repository-policy.json'), 'utf8'));
const modulePromise = import(pathToFileURL(join(root, 'scripts/lib/repository-audit.mjs')).href);

test('multiple applicable pull-request rules are aggregated instead of rejected as duplicates', async () => {
  const failures = await evaluate([
    ...baseRules().filter(rule => rule.type !== 'pull_request'),
    pullRequestRule({ require_code_owner_review: false }),
    pullRequestRule({ require_code_owner_review: true })
  ]);
  assert.deepEqual(failures, []);
});

test('stricter inherited pull-request rules satisfy the committed minimum', async () => {
  const failures = await evaluate([
    ...baseRules().filter(rule => rule.type !== 'pull_request'),
    pullRequestRule({ required_approving_review_count: 0, allowed_merge_methods: ['merge', 'squash'] }),
    pullRequestRule({ required_approving_review_count: 1, allowed_merge_methods: ['squash'] })
  ]);
  assert.deepEqual(failures, []);
});

test('required status checks are unioned across applicable rules', async () => {
  const rules = baseRules().filter(rule => rule.type !== 'required_status_checks');
  rules.push(statusRule(policy.requiredStatusChecks.slice(0, 3), false));
  rules.push(statusRule(policy.requiredStatusChecks.slice(3), true));
  const failures = await evaluate(rules);
  assert.deepEqual(failures, []);
});

test('missing relevant rule parameters fail closed', async () => {
  const rules = baseRules();
  delete rules.find(rule => rule.type === 'pull_request').parameters;
  const failures = await evaluate(rules);
  assert.ok(failures.some(item => item.includes('parameters are not visible or invalid')));
});

test('malformed effective rules fail closed', async () => {
  const failures = await evaluate([...baseRules(), null]);
  assert.ok(failures.includes('Active branch rules contain an invalid rule entry.'));
});

test('the GitHub client rejects redirects and requests redirect:error', async () => {
  const { createGitHubApiClient } = await modulePromise;
  let observed;
  const client = createGitHubApiClient({
    apiUrl: 'https://api.github.test',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return new Response('', { status: 301, headers: { location: 'https://api.github.test/repos/new/name' } });
    }
  });
  await assert.rejects(client.requestJson('repos/old/name'), /GitHub API 301/);
  assert.equal(observed.options.redirect, 'error');
});

test('custom GITHUB_API_URL paths are preserved', async () => {
  const { createGitHubApiClient } = await modulePromise;
  let observedUrl;
  const client = createGitHubApiClient({
    apiUrl: 'https://ghe.example.test/api/v3/',
    fetchImpl: async url => {
      observedUrl = url;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  await client.requestJson('repos/owner/repo');
  assert.equal(observedUrl, 'https://ghe.example.test/api/v3/repos/owner/repo');
});

test('a repository identity mismatch fails closed', async () => {
  const { auditRepositorySnapshot } = await modulePromise;
  const snapshot = makeSnapshot();
  snapshot.metadata.full_name = 'different/repository';
  const { failures } = auditRepositorySnapshot(snapshot, policy);
  assert.ok(failures.some(item => item.includes('repository identity')));
});

test('the repository-owned ruleset rejects unexpected status checks while effective rules may be stricter', async () => {
  const { auditRuleset } = await modulePromise;
  const failures = [];
  const warnings = [];
  const ruleset = makeSnapshot().rulesetDetail;
  ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks.push({ context: 'unexpected' });
  auditRuleset(ruleset, policy, failures, warnings);
  assert.ok(failures.includes('Repository ruleset contains unexpected required status check unexpected.'));
});

async function evaluate(rules) {
  const { auditEffectiveRules } = await modulePromise;
  const failures = [];
  auditEffectiveRules(rules, policy, failures);
  return failures;
}

function baseRules() {
  return [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
    pullRequestRule(),
    {
      type: 'copilot_code_review',
      parameters: {
        review_draft_pull_requests: false,
        review_on_push: false
      }
    },
    statusRule(policy.requiredStatusChecks, true)
  ];
}

function pullRequestRule(overrides = {}) {
  return {
    type: 'pull_request',
    ruleset_source: 'example/source',
    ruleset_id: 42,
    parameters: {
      allowed_merge_methods: ['squash'],
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: true,
      require_last_push_approval: true,
      required_approving_review_count: 1,
      required_review_thread_resolution: true,
      ...overrides
    }
  };
}

function statusRule(contexts, strict) {
  return {
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: strict,
      required_status_checks: contexts.map(context => ({ context }))
    }
  };
}

function makeSnapshot() {
  const rules = baseRules();
  return {
    repository: 'PPadgett/m365-copilot-vscode',
    branch: 'main',
    metadata: {
      full_name: 'PPadgett/m365-copilot-vscode',
      default_branch: 'main',
      ...policy.repository
    },
    rules,
    vulnerabilityReporting: { enabled: policy.privateVulnerabilityReporting },
    rulesets: [{ id: 1, name: policy.rulesetName, source_type: 'Repository' }],
    rulesetDetail: {
      id: 1,
      name: policy.rulesetName,
      target: 'branch',
      enforcement: 'active',
      bypass_actors: [],
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: structuredClone(rules)
    }
  };
}
