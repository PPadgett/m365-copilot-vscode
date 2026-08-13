import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

if (isMainModule()) {
  await main();
}

export async function main() {
  const policyPath = resolve(root, process.argv[3] ?? '.github/repository-policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  validatePolicy(policy);

  const repository = process.argv[2] ?? process.env.GITHUB_REPOSITORY;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Supply owner/repository as the first argument or set GITHUB_REPOSITORY.');
  }

  const branch = process.env.GITHUB_DEFAULT_BRANCH ?? policy.defaultBranch;
  const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
  const [metadata, rules, vulnerabilityReporting, rulesets] = await Promise.all([
    requestJson(`repos/${encodedRepository}`),
    requestJson(`repos/${encodedRepository}/rules/branches/${encodeURIComponent(branch)}?per_page=100`),
    requestJson(`repos/${encodedRepository}/private-vulnerability-reporting`),
    requestJson(`repos/${encodedRepository}/rulesets?includes_parents=false&targets=branch&per_page=100`)
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
    auditRules(rules, policy, failures);
  }

  if (!Array.isArray(rulesets)) {
    failures.push('GitHub did not return a repository-ruleset array.');
  } else {
    const summary = rulesets.find(candidate => candidate?.name === policy.rulesetName && candidate?.source_type === 'Repository');
    if (!summary?.id) {
      failures.push(`Repository ruleset ${JSON.stringify(policy.rulesetName)} is not configured.`);
    } else {
      const detail = await requestJson(`repos/${encodedRepository}/rulesets/${summary.id}`);
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
}

export function auditRules(rules, policy, failures) {
  const byType = new Map();
  for (const rule of rules) {
    if (!isRecord(rule) || typeof rule.type !== 'string' || !rule.type) {
      failures.push('Active branch rules contain an invalid rule entry.');
      continue;
    }
    if (byType.has(rule.type)) {
      failures.push(`Active branch rules contain duplicate ${rule.type} rules.`);
      continue;
    }
    byType.set(rule.type, rule);
  }

  for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'copilot_code_review', 'required_status_checks', 'required_linear_history']) {
    if (!byType.has(type)) {
      failures.push(`Active main-branch rules are missing ${type}.`);
    }
  }

  const pullRequest = requireRuleParameters(byType, 'pull_request', failures);
  if (pullRequest) {
    requireAtLeast(pullRequest.required_approving_review_count, 1, 'required approving reviews', failures);
    requireTrue(pullRequest.dismiss_stale_reviews_on_push, 'dismiss stale reviews', failures);
    requireTrue(pullRequest.require_code_owner_review, 'CODEOWNERS review', failures);
    requireTrue(pullRequest.require_last_push_approval, 'last-push approval', failures);
    requireTrue(pullRequest.required_review_thread_resolution, 'review-thread resolution', failures);
    const methods = pullRequest.allowed_merge_methods;
    if (!Array.isArray(methods) || methods.length !== 1 || methods[0] !== 'squash') {
      failures.push(`Allowed merge methods are ${JSON.stringify(methods)}; expected only squash.`);
    }
  }

  const copilot = requireRuleParameters(byType, 'copilot_code_review', failures);
  if (copilot) {
    if (copilot.review_draft_pull_requests !== policy.copilotCodeReview.reviewDraftPullRequests) {
      failures.push(
        `Copilot draft-review setting is ${JSON.stringify(copilot.review_draft_pull_requests)}; expected ${policy.copilotCodeReview.reviewDraftPullRequests}.`
      );
    }
    if (copilot.review_on_push !== policy.copilotCodeReview.reviewOnPush) {
      failures.push(
        `Copilot review-on-push setting is ${JSON.stringify(copilot.review_on_push)}; expected ${policy.copilotCodeReview.reviewOnPush}.`
      );
    }
  }

  const statusChecks = requireRuleParameters(byType, 'required_status_checks', failures);
  if (statusChecks) {
    requireTrue(statusChecks.strict_required_status_checks_policy, 'strict required status checks', failures);
    const configuredChecks = statusChecks.required_status_checks;
    if (!Array.isArray(configuredChecks)) {
      failures.push('Required status-check parameters must include an array of required_status_checks.');
    } else {
      const contexts = [];
      for (const check of configuredChecks) {
        if (!isRecord(check) || typeof check.context !== 'string' || !check.context.trim()) {
          failures.push('Required status-check entries must be objects with a non-empty context.');
          continue;
        }
        contexts.push(check.context);
      }
      if (new Set(contexts).size !== contexts.length) {
        failures.push('Required status-check contexts must not contain duplicates.');
      }
      const actual = new Set(contexts);
      const expected = new Set(policy.requiredStatusChecks);
      for (const required of expected) {
        if (!actual.has(required)) {
          failures.push(`Required status checks do not include ${required}.`);
        }
      }
      for (const context of actual) {
        if (!expected.has(context)) {
          failures.push(`Required status checks contain unexpected context ${context}.`);
        }
      }
    }
  }
}

export function auditRuleset(ruleset, policy, failures, warnings) {
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
      'Ruleset rule details are not visible to the current token; the active branch-rules endpoint is used for enforceable rule verification.'
    );
    return;
  }
  const copilot = ruleset.rules.find(rule => rule?.type === 'copilot_code_review')?.parameters;
  if (!isRecord(copilot)) {
    failures.push('Repository ruleset must enable automatic Copilot code review with visible parameters.');
  } else {
    if (copilot.review_draft_pull_requests !== policy.copilotCodeReview.reviewDraftPullRequests) {
      failures.push('Repository ruleset Copilot draft-review behavior does not match policy.');
    }
    if (copilot.review_on_push !== policy.copilotCodeReview.reviewOnPush) {
      failures.push('Repository ruleset Copilot push-review behavior does not match policy.');
    }
  }
}

function requireRuleParameters(byType, type, failures) {
  const rule = byType.get(type);
  if (!rule) {
    return undefined;
  }
  if (!isRecord(rule.parameters)) {
    failures.push(`Active ${type} rule parameters are not visible or invalid.`);
    return undefined;
  }
  return rule.parameters;
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

function requestJson(endpoint) {
  const args = [
    'api',
    '--method',
    'GET',
    endpoint,
    '--header',
    'Accept: application/vnd.github+json',
    '--header',
    `X-GitHub-Api-Version: ${process.env.GITHUB_API_VERSION ?? '2022-11-28'}`
  ];
  const hostname = githubHostname();
  if (hostname && hostname !== 'github.com') {
    args.push('--hostname', hostname);
  }
  const result = spawnSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1'
    },
    maxBuffer: 5 * 1024 * 1024
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('GitHub CLI is required for repository policy auditing. Install gh and authenticate before retrying.');
    }
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'gh api failed without output')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    throw new Error(`GitHub API request failed for ${endpoint}: ${detail}`);
  }
  try {
    return result.stdout ? JSON.parse(result.stdout) : {};
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${endpoint}.`);
  }
}

function githubHostname() {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  if (!serverUrl) {
    return undefined;
  }
  try {
    return new URL(serverUrl).hostname;
  } catch {
    throw new TypeError('GITHUB_SERVER_URL must be a valid absolute URL.');
  }
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
  if (
    value.copilotCodeReview?.enabled !== true ||
    typeof value.copilotCodeReview.reviewDraftPullRequests !== 'boolean' ||
    typeof value.copilotCodeReview.reviewOnPush !== 'boolean'
  ) {
    throw new TypeError('Repository policy must define enabled automatic Copilot code review settings.');
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

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}
