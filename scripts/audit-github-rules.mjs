import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const policyPath = resolve(root, process.argv[3] ?? '.github/repository-policy.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
validatePolicy(policy);

const repository = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('Supply owner/repository as the first argument or set GITHUB_REPOSITORY.');
}

const apiUrl = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
const branch = process.env.GITHUB_DEFAULT_BRANCH ?? policy.defaultBranch;
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'm365-copilot-vscode-repository-audit',
  'X-GitHub-Api-Version': process.env.GITHUB_API_VERSION ?? '2022-11-28'
};
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
const [metadata, rules, vulnerabilityReporting, rulesets] = await Promise.all([
  requestJson(`${apiUrl}/repos/${encodedRepository}`, headers),
  requestJson(`${apiUrl}/repos/${encodedRepository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`, headers),
  requestJson(`${apiUrl}/repos/${encodedRepository}/private-vulnerability-reporting`, headers),
  requestJson(`${apiUrl}/repos/${encodedRepository}/rulesets?includes_parents=false&targets=branch&per_page=100`, headers)
]);

const failures = [];
const warnings = [];
for (const [key, expected] of Object.entries(policy.repository)) {
  if (!(key in metadata) || metadata[key] === undefined) {
    warnings.push(
      `Repository setting ${key} is not visible to the current token; use a fine-grained token with Administration: read for full verification.`
    );
  } else if (metadata[key] !== expected) {
    failures.push(`Repository setting ${key} is ${JSON.stringify(metadata[key])}; expected ${JSON.stringify(expected)}.`);
  }
}
if (metadata.default_branch !== policy.defaultBranch) {
  failures.push(`Default branch is ${JSON.stringify(metadata.default_branch)}; expected ${JSON.stringify(policy.defaultBranch)}.`);
}
if (vulnerabilityReporting.enabled !== policy.privateVulnerabilityReporting) {
  failures.push(`Private vulnerability reporting is ${Boolean(vulnerabilityReporting.enabled)}; expected ${policy.privateVulnerabilityReporting}.`);
}

if (!Array.isArray(rules)) {
  failures.push('GitHub did not return an active branch-rules array.');
} else {
  auditRules(rules, policy.requiredStatusChecks, failures);
}

if (!Array.isArray(rulesets)) {
  failures.push('GitHub did not return a repository-ruleset array.');
} else {
  const summary = rulesets.find(candidate => candidate?.name === policy.rulesetName && candidate?.source_type === 'Repository');
  if (!summary?.id) {
    failures.push(`Repository ruleset ${JSON.stringify(policy.rulesetName)} is not configured.`);
  } else {
    const detail = await requestJson(`${apiUrl}/repos/${encodedRepository}/rulesets/${summary.id}`, headers);
    auditRuleset(detail, policy, failures, warnings);
  }
}

const summary = renderSummary(repository, branch, failures, warnings);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
if (failures.length > 0) {
  process.exitCode = 1;
}

function auditRules(rules, requiredContexts, failures) {
  const byType = new Map(rules.map(rule => [rule.type, rule]));
  for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks', 'required_linear_history']) {
    if (!byType.has(type)) {
      failures.push(`Active main-branch rules are missing ${type}.`);
    }
  }

  const pullRequest = byType.get('pull_request')?.parameters;
  if (pullRequest) {
    requireAtLeast(pullRequest.required_approving_review_count, 1, 'required approving reviews', failures);
    requireTrue(pullRequest.dismiss_stale_reviews_on_push, 'dismiss stale reviews', failures);
    requireTrue(pullRequest.require_code_owner_review, 'CODEOWNERS review', failures);
    requireTrue(pullRequest.require_last_push_approval, 'last-push approval', failures);
    requireTrue(pullRequest.required_review_thread_resolution, 'review-thread resolution', failures);
    const methods = Array.isArray(pullRequest.allowed_merge_methods) ? pullRequest.allowed_merge_methods : [];
    if (methods.length !== 1 || methods[0] !== 'squash') {
      failures.push(`Allowed merge methods are ${JSON.stringify(methods)}; expected only squash.`);
    }
  }

  const statusChecks = byType.get('required_status_checks')?.parameters;
  if (statusChecks) {
    requireTrue(statusChecks.strict_required_status_checks_policy, 'strict required status checks', failures);
    const contexts = new Set(
      Array.isArray(statusChecks.required_status_checks)
        ? statusChecks.required_status_checks.map(check => check?.context).filter(value => typeof value === 'string')
        : []
    );
    for (const required of requiredContexts) {
      if (!contexts.has(required)) {
        failures.push(`Required status checks do not include ${required}.`);
      }
    }
  }
}

function auditRuleset(ruleset, policy, failures, warnings) {
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

async function requestJson(url, requestHeaders) {
  const response = await fetch(url, { headers: requestHeaders, redirect: 'error' });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

function validatePolicy(value) {
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
}

function renderSummary(repository, branch, failures, warnings) {
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
