const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const modulePromise = import(pathToFileURL(join(resolve(__dirname, '..'), 'scripts/audit-github-rules.mjs')).href);

const policy = {
  requiredStatusChecks: [
    'Required',
    'Fuzz',
    'Repository Policy',
    'Scorecard Policy',
    'CodeQL',
    'Gitleaks',
    'Review dependency changes'
  ],
  copilotCodeReview: {
    reviewDraftPullRequests: false,
    reviewOnPush: false
  }
};

test('active branch rules pass only when all required parameters are visible and valid', async () => {
  const failures = await evaluate(makeRules());
  assert.deepEqual(failures, []);
});

test('active branch rules fail closed when pull-request parameters are absent', async () => {
  const rules = makeRules();
  delete rules.find(rule => rule.type === 'pull_request').parameters;

  const failures = await evaluate(rules);
  assert.ok(failures.includes('Active pull_request rule parameters are not visible or invalid.'));
});

test('active branch rules fail closed when Copilot review parameters are absent', async () => {
  const rules = makeRules();
  delete rules.find(rule => rule.type === 'copilot_code_review').parameters;

  const failures = await evaluate(rules);
  assert.ok(failures.includes('Active copilot_code_review rule parameters are not visible or invalid.'));
});

test('active branch rules fail closed when required-status-check parameters are absent', async () => {
  const rules = makeRules();
  delete rules.find(rule => rule.type === 'required_status_checks').parameters;

  const failures = await evaluate(rules);
  assert.ok(failures.includes('Active required_status_checks rule parameters are not visible or invalid.'));
});

test('active branch rules reject malformed and duplicate status-check evidence', async () => {
  const rules = makeRules();
  const status = rules.find(rule => rule.type === 'required_status_checks').parameters;
  status.required_status_checks = [
    { context: 'Required' },
    { context: 'Required' },
    { context: '' },
    null
  ];

  const failures = await evaluate(rules);
  assert.ok(failures.includes('Required status-check entries must be objects with a non-empty context.'));
  assert.ok(failures.includes('Required status-check contexts must not contain duplicates.'));
  assert.ok(failures.includes('Required status checks do not include Fuzz.'));
});

async function evaluate(rules) {
  const { auditRules } = await modulePromise;
  const failures = [];
  auditRules(rules, policy, failures);
  return failures;
}

function makeRules() {
  return [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'required_linear_history' },
    {
      type: 'pull_request',
      parameters: {
        allowed_merge_methods: ['squash'],
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: true,
        required_approving_review_count: 1,
        required_review_thread_resolution: true
      }
    },
    {
      type: 'copilot_code_review',
      parameters: {
        review_draft_pull_requests: false,
        review_on_push: false
      }
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: policy.requiredStatusChecks.map(context => ({ context }))
      }
    }
  ];
}
