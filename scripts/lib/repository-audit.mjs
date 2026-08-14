const DEFAULT_API_URL = 'https://api.github.com';
const DEFAULT_API_VERSION = '2022-11-28';
const MAX_RESPONSE_CHARS = 5 * 1024 * 1024;

export async function runRepositoryAudit({
  repository,
  policy,
  branch = policy.defaultBranch,
  apiUrl = process.env.GITHUB_API_URL ?? DEFAULT_API_URL,
  token = process.env.GITHUB_TOKEN,
  apiVersion = process.env.GITHUB_API_VERSION ?? DEFAULT_API_VERSION,
  fetchImpl = globalThis.fetch
}) {
  validateRepository(repository);
  validatePolicy(policy);
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A Fetch-compatible implementation is required.');
  }

  const client = createGitHubApiClient({ apiUrl, token, apiVersion, fetchImpl });
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const [metadata, rules, vulnerabilityReporting, rulesets] = await Promise.all([
    client.requestJson(`repos/${encodedRepository}`),
    client.requestJson(`repos/${encodedRepository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`),
    client.requestJson(`repos/${encodedRepository}/private-vulnerability-reporting`),
    client.requestJson(`repos/${encodedRepository}/rulesets?includes_parents=false&targets=branch&per_page=100`)
  ]);

  let rulesetDetail;
  if (Array.isArray(rulesets)) {
    const summary = rulesets.find(candidate => candidate?.name === policy.rulesetName && candidate?.source_type === 'Repository');
    if (summary?.id) {
      rulesetDetail = await client.requestJson(`repos/${encodedRepository}/rulesets/${summary.id}`);
    }
  }

  return auditRepositorySnapshot({
    repository,
    branch,
    metadata,
    rules,
    vulnerabilityReporting,
    rulesets,
    rulesetDetail
  }, policy);
}

export function auditRepositorySnapshot(snapshot, policy) {
  validatePolicy(policy);
  const failures = [];
  const warnings = [];
  const requestedRepository = snapshot.repository;
  const actualRepository = snapshot.metadata?.full_name;

  if (typeof actualRepository !== 'string' || actualRepository.toLowerCase() !== requestedRepository.toLowerCase()) {
    failures.push(`GitHub returned repository identity ${JSON.stringify(actualRepository)}; expected ${JSON.stringify(requestedRepository)}.`);
  }

  for (const [key, expected] of Object.entries(policy.repository)) {
    if (!(key in (snapshot.metadata ?? {})) || snapshot.metadata[key] === undefined) {
      warnings.push(
        `Repository setting ${key} is not visible to the current token; use a fine-grained token with Administration: read for full verification.`
      );
    } else if (snapshot.metadata[key] !== expected) {
      failures.push(`Repository setting ${key} is ${JSON.stringify(snapshot.metadata[key])}; expected ${JSON.stringify(expected)}.`);
    }
  }

  if (snapshot.metadata?.default_branch !== policy.defaultBranch) {
    failures.push(`Default branch is ${JSON.stringify(snapshot.metadata?.default_branch)}; expected ${JSON.stringify(policy.defaultBranch)}.`);
  }
  if (snapshot.vulnerabilityReporting?.enabled !== policy.privateVulnerabilityReporting) {
    failures.push(
      `Private vulnerability reporting is ${Boolean(snapshot.vulnerabilityReporting?.enabled)}; expected ${policy.privateVulnerabilityReporting}.`
    );
  }

  if (!Array.isArray(snapshot.rules)) {
    failures.push('GitHub did not return an active branch-rules array.');
  } else {
    auditRuleCollection(snapshot.rules, policy, failures, {
      label: 'Active branch rules',
      allowDuplicateTypes: true,
      allowExtraStatusChecks: true
    });
  }

  if (!Array.isArray(snapshot.rulesets)) {
    failures.push('GitHub did not return a repository-ruleset array.');
  } else {
    const summary = snapshot.rulesets.find(
      candidate => candidate?.name === policy.rulesetName && candidate?.source_type === 'Repository'
    );
    if (!summary?.id) {
      failures.push(`Repository ruleset ${JSON.stringify(policy.rulesetName)} is not configured.`);
    } else if (!snapshot.rulesetDetail) {
      failures.push(`Repository ruleset ${JSON.stringify(policy.rulesetName)} details were not returned.`);
    } else {
      auditRuleset(snapshot.rulesetDetail, policy, failures, warnings);
    }
  }

  return { failures, warnings };
}

export function auditEffectiveRules(rules, policy, failures) {
  auditRuleCollection(rules, policy, failures, {
    label: 'Active branch rules',
    allowDuplicateTypes: true,
    allowExtraStatusChecks: true
  });
}

export function auditRuleset(ruleset, policy, failures, warnings) {
  if (!isRecord(ruleset)) {
    failures.push('GitHub returned invalid repository-ruleset details.');
    return;
  }
  if (ruleset.name !== policy.rulesetName) {
    failures.push(`Ruleset name is ${JSON.stringify(ruleset.name)}; expected ${JSON.stringify(policy.rulesetName)}.`);
  }
  if (ruleset.enforcement !== 'active') {
    failures.push(`Ruleset enforcement is ${JSON.stringify(ruleset.enforcement)}; expected "active".`);
  }
  if (ruleset.target !== 'branch') {
    failures.push(`Ruleset target is ${JSON.stringify(ruleset.target)}; expected "branch".`);
  }
  if (!Object.hasOwn(ruleset, 'bypass_actors') || ruleset.bypass_actors === undefined) {
    warnings.push(
      'Ruleset bypass actors are not visible to the current token; use a fine-grained token with Administration: read for full verification.'
    );
  } else if (!Array.isArray(ruleset.bypass_actors)) {
    failures.push('GitHub returned an invalid ruleset bypass-actors value.');
  } else if (ruleset.bypass_actors.length !== 0) {
    failures.push('Ruleset must not define bypass actors.');
  }

  const includes = ruleset.conditions?.ref_name?.include;
  if (!Array.isArray(includes) || !includes.includes('~DEFAULT_BRANCH')) {
    failures.push('Ruleset must target the default branch through ~DEFAULT_BRANCH.');
  }

  if (!Array.isArray(ruleset.rules)) {
    warnings.push(
      'Ruleset rule details are not visible to the current token; effective branch rules remain the enforceable source for drift verification.'
    );
    return;
  }

  auditRuleCollection(ruleset.rules, policy, failures, {
    label: 'Repository ruleset',
    allowDuplicateTypes: false,
    allowExtraStatusChecks: false
  });
}

export function createGitHubApiClient({
  apiUrl = DEFAULT_API_URL,
  token,
  apiVersion = DEFAULT_API_VERSION,
  fetchImpl = globalThis.fetch
} = {}) {
  const baseUrl = normalizeApiUrl(apiUrl);
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'm365-copilot-vscode-repository-audit',
    'X-GitHub-Api-Version': apiVersion,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  return {
    async requestJson(endpoint) {
      const normalizedEndpoint = String(endpoint).replace(/^\/+/, '');
      const url = `${baseUrl}/${normalizedEndpoint}`;
      const response = await fetchImpl(url, { headers, redirect: 'error' });
      const text = await readBoundedText(response, url);
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status} for ${url}: ${sanitize(text)}`);
      }
      if (!text) {
        return {};
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`GitHub API returned invalid JSON for ${url}.`);
      }
    }
  };
}

export function renderRepositoryAuditSummary(repository, branch, failures, warnings) {
  const lines = [
    '## GitHub repository policy',
    '',
    `Repository: \`${repository}\``,
    '',
    `Branch: \`${branch}\``,
    ''
  ];
  if (failures.length === 0) {
    lines.push('Observable repository settings and active branch rules match the committed policy.');
  } else {
    lines.push(`Repository policy failed with ${failures.length} drift item(s):`);
    for (const failure of failures) {
      lines.push(`- ${failure}`);
    }
  }
  if (warnings.length > 0) {
    lines.push('', `Repository policy emitted ${warnings.length} visibility warning(s):`);
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return lines.join('\n');
}

export function validatePolicy(value) {
  if (!value || value.version !== 1 || typeof value.defaultBranch !== 'string') {
    throw new TypeError('Repository policy must use version 1 and define defaultBranch.');
  }
  if (typeof value.rulesetName !== 'string' || !value.rulesetName) {
    throw new TypeError('Repository policy must define rulesetName.');
  }
  if (!value.repository || typeof value.repository !== 'object') {
    throw new TypeError('Repository policy must define repository settings.');
  }
  if (!Array.isArray(value.requiredStatusChecks) || value.requiredStatusChecks.length === 0) {
    throw new TypeError('Repository policy must define requiredStatusChecks.');
  }
  if (
    value.copilotCodeReview?.enabled !== true ||
    typeof value.copilotCodeReview.reviewDraftPullRequests !== 'boolean' ||
    typeof value.copilotCodeReview.reviewOnPush !== 'boolean'
  ) {
    throw new TypeError('Repository policy must define enabled automatic Copilot code review settings.');
  }
}

function auditRuleCollection(rules, policy, failures, options) {
  const groups = groupRules(rules, failures, options);
  for (const type of [
    'deletion',
    'non_fast_forward',
    'pull_request',
    'copilot_code_review',
    'required_status_checks',
    'required_linear_history'
  ]) {
    if (!groups.has(type)) {
      failures.push(`${options.label} are missing ${type}.`);
    }
  }

  const pullRequests = collectParameters(groups.get('pull_request'), 'pull_request', failures, options.label);
  if (pullRequests.length > 0) {
    const aggregate = aggregatePullRequestRules(pullRequests, failures, options.label);
    requireAtLeast(aggregate.requiredApprovals, 1, 'required approving reviews', failures);
    requireTrue(aggregate.dismissStaleReviews, 'dismiss stale reviews', failures);
    requireTrue(aggregate.requireCodeOwnerReview, 'CODEOWNERS review', failures);
    requireTrue(aggregate.requireLastPushApproval, 'last-push approval', failures);
    requireTrue(aggregate.requireReviewThreadResolution, 'review-thread resolution', failures);
    if (aggregate.allowedMergeMethods.length !== 1 || aggregate.allowedMergeMethods[0] !== 'squash') {
      failures.push(
        `${options.label} effective merge methods are ${JSON.stringify(aggregate.allowedMergeMethods)}; expected only squash.`
      );
    }
  }

  const copilotRules = collectParameters(groups.get('copilot_code_review'), 'copilot_code_review', failures, options.label);
  if (copilotRules.length > 0) {
    const reviewDrafts = copilotRules.some(parameters => parameters.review_draft_pull_requests === true);
    const reviewOnPush = copilotRules.some(parameters => parameters.review_on_push === true);
    if (copilotRules.some(parameters => typeof parameters.review_draft_pull_requests !== 'boolean')) {
      failures.push(`${options.label} contain a Copilot rule without a boolean review_draft_pull_requests value.`);
    }
    if (copilotRules.some(parameters => typeof parameters.review_on_push !== 'boolean')) {
      failures.push(`${options.label} contain a Copilot rule without a boolean review_on_push value.`);
    }
    if (reviewDrafts !== policy.copilotCodeReview.reviewDraftPullRequests) {
      failures.push(
        `${options.label} effective Copilot draft-review setting is ${reviewDrafts}; expected ${policy.copilotCodeReview.reviewDraftPullRequests}.`
      );
    }
    if (reviewOnPush !== policy.copilotCodeReview.reviewOnPush) {
      failures.push(
        `${options.label} effective Copilot review-on-push setting is ${reviewOnPush}; expected ${policy.copilotCodeReview.reviewOnPush}.`
      );
    }
  }

  const statusRules = collectParameters(groups.get('required_status_checks'), 'required_status_checks', failures, options.label);
  if (statusRules.length > 0) {
    const strict = statusRules.some(parameters => parameters.strict_required_status_checks_policy === true);
    if (statusRules.some(parameters => typeof parameters.strict_required_status_checks_policy !== 'boolean')) {
      failures.push(`${options.label} contain a status-check rule without a boolean strict policy value.`);
    }
    requireTrue(strict, 'strict required status checks', failures);

    const contexts = new Set();
    for (const parameters of statusRules) {
      if (!Array.isArray(parameters.required_status_checks)) {
        failures.push(`${options.label} required-status-check parameters must include an array of checks.`);
        continue;
      }
      for (const check of parameters.required_status_checks) {
        if (!isRecord(check) || typeof check.context !== 'string' || !check.context.trim()) {
          failures.push(`${options.label} contain a malformed required status-check entry.`);
          continue;
        }
        contexts.add(check.context);
      }
    }

    const expected = new Set(policy.requiredStatusChecks);
    for (const required of expected) {
      if (!contexts.has(required)) {
        failures.push(`Required status checks do not include ${required}.`);
      }
    }
    if (!options.allowExtraStatusChecks) {
      for (const context of contexts) {
        if (!expected.has(context)) {
          failures.push(`Repository ruleset contains unexpected required status check ${context}.`);
        }
      }
    }
  }
}

function groupRules(rules, failures, options) {
  const groups = new Map();
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.type !== 'string' || !rule.type) {
      failures.push(`${options.label} contain an invalid rule entry.`);
      continue;
    }
    const group = groups.get(rule.type) ?? [];
    group.push(rule);
    groups.set(rule.type, group);
  }
  if (!options.allowDuplicateTypes) {
    for (const [type, group] of groups) {
      if (group.length > 1) {
        failures.push(`${options.label} contain duplicate ${type} rules.`);
      }
    }
  }
  return groups;
}

function collectParameters(rules = [], type, failures, label) {
  const parameters = [];
  for (const rule of rules) {
    if (!isRecord(rule.parameters)) {
      failures.push(`${label} ${describeRule(rule, type)} parameters are not visible or invalid.`);
      continue;
    }
    parameters.push(rule.parameters);
  }
  return parameters;
}

function aggregatePullRequestRules(parametersList, failures, label) {
  let allowed;
  let requiredApprovals = 0;
  let dismissStaleReviews = false;
  let requireCodeOwnerReview = false;
  let requireLastPushApproval = false;
  let requireReviewThreadResolution = false;

  for (const parameters of parametersList) {
    if (!Number.isInteger(parameters.required_approving_review_count) || parameters.required_approving_review_count < 0) {
      failures.push(`${label} contain an invalid required_approving_review_count.`);
    } else {
      requiredApprovals = Math.max(requiredApprovals, parameters.required_approving_review_count);
    }

    for (const key of [
      'dismiss_stale_reviews_on_push',
      'require_code_owner_review',
      'require_last_push_approval',
      'required_review_thread_resolution'
    ]) {
      if (typeof parameters[key] !== 'boolean') {
        failures.push(`${label} contain a pull-request rule without a boolean ${key} value.`);
      }
    }

    dismissStaleReviews ||= parameters.dismiss_stale_reviews_on_push === true;
    requireCodeOwnerReview ||= parameters.require_code_owner_review === true;
    requireLastPushApproval ||= parameters.require_last_push_approval === true;
    requireReviewThreadResolution ||= parameters.required_review_thread_resolution === true;

    if (!Array.isArray(parameters.allowed_merge_methods) || parameters.allowed_merge_methods.length === 0) {
      failures.push(`${label} contain a pull-request rule without allowed_merge_methods.`);
      continue;
    }
    const methods = new Set(parameters.allowed_merge_methods.filter(method => typeof method === 'string' && method));
    if (methods.size !== parameters.allowed_merge_methods.length) {
      failures.push(`${label} contain malformed or duplicate allowed merge methods.`);
    }
    allowed = allowed === undefined ? methods : new Set([...allowed].filter(method => methods.has(method)));
  }

  return {
    requiredApprovals,
    dismissStaleReviews,
    requireCodeOwnerReview,
    requireLastPushApproval,
    requireReviewThreadResolution,
    allowedMergeMethods: [...(allowed ?? new Set())].sort()
  };
}

function describeRule(rule, fallbackType) {
  const source = typeof rule?.ruleset_source === 'string' ? ` from ${rule.ruleset_source}` : '';
  const id = Number.isInteger(rule?.ruleset_id) ? ` (ruleset ${rule.ruleset_id})` : '';
  return `${fallbackType}${source}${id}`;
}

function normalizeApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('GITHUB_API_URL must be a valid absolute URL.');
  }
  if (url.protocol !== 'https:') {
    throw new TypeError('GITHUB_API_URL must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('GITHUB_API_URL must not include credentials, a query, or a fragment.');
  }
  return url.href.replace(/\/$/, '');
}

async function readBoundedText(response, url) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) {
    throw new Error(`GitHub API response exceeded ${MAX_RESPONSE_CHARS} bytes for ${url}.`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) {
    throw new Error(`GitHub API response exceeded ${MAX_RESPONSE_CHARS} characters for ${url}.`);
  }
  return text;
}

function sanitize(value) {
  return String(value || 'request failed without response body').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function validateRepository(repository) {
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Supply owner/repository as the first argument or set GITHUB_REPOSITORY.');
  }
}

function requireTrue(value, name, failures) {
  if (value !== true) {
    failures.push(`Branch protection must enable ${name}.`);
  }
}

function requireAtLeast(value, minimum, name, failures) {
  if (!Number.isInteger(value) || value < minimum) {
    failures.push(`Branch protection requires ${value ?? 0} ${name}; expected at least ${minimum}.`);
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
