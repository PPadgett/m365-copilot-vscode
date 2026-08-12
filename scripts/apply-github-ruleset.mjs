import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repositoryPolicy = JSON.parse(
  await readFile(resolve(root, '.github/repository-policy.json'), 'utf8')
);
const ruleset = JSON.parse(
  await readFile(resolve(root, '.github/rulesets/main.json'), 'utf8')
);
validateConfiguration(repositoryPolicy, ruleset);

const repository = process.env.GITHUB_REPOSITORY ?? positionalArgument();
const token = process.env.GH_ADMIN_TOKEN;
const dryRun = process.argv.includes('--dry-run');

if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('Set GITHUB_REPOSITORY or pass owner/repository as an argument.');
}
if (!dryRun && !token) {
  throw new Error('Set GH_ADMIN_TOKEN to a fine-grained token with Administration: write for this repository.');
}

const apiUrl = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, '');
const encodedRepository = repository.split('/').map(encodeURIComponent).join('/');
const headers = {
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'm365-copilot-vscode-ruleset-bootstrap',
  'X-GitHub-Api-Version': '2026-03-10',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
};

if (dryRun) {
  console.log(JSON.stringify({
    repository,
    repositorySettings: repositoryPolicy.repository,
    privateVulnerabilityReporting: repositoryPolicy.privateVulnerabilityReporting,
    ruleset
  }, null, 2));
  process.exit(0);
}

await request(`${apiUrl}/repos/${encodedRepository}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(repositoryPolicy.repository)
});

if (repositoryPolicy.privateVulnerabilityReporting) {
  await request(`${apiUrl}/repos/${encodedRepository}/private-vulnerability-reporting`, {
    method: 'PUT',
    headers
  });
}

const currentRulesets = await requestJson(
  `${apiUrl}/repos/${encodedRepository}/rulesets?includes_parents=false&targets=branch&per_page=100`,
  { headers }
);
const existing = Array.isArray(currentRulesets)
  ? currentRulesets.find(candidate => candidate?.name === ruleset.name && candidate?.source_type === 'Repository')
  : undefined;

if (existing?.id) {
  await request(`${apiUrl}/repos/${encodedRepository}/rulesets/${existing.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(ruleset)
  });
  console.log(`Updated repository ruleset ${ruleset.name} (${existing.id}).`);
} else {
  const created = await requestJson(`${apiUrl}/repos/${encodedRepository}/rulesets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(ruleset)
  });
  console.log(`Created repository ruleset ${ruleset.name} (${created.id}).`);
}

console.log('Applied repository merge settings, private vulnerability reporting, and main-branch rules.');
console.log(`Verify with: GITHUB_TOKEN=<read-token> npm run repository:audit -- ${repository}`);

async function requestJson(url, options) {
  const response = await request(url, options);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function request(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status} for ${options.method ?? 'GET'} ${url}: ${text.slice(0, 1000)}`);
  }
  return response;
}

function validateConfiguration(policy, desiredRuleset) {
  if (policy?.version !== 1 || !policy.repository || !Array.isArray(policy.requiredStatusChecks)) {
    throw new TypeError('Invalid repository policy.');
  }
  if (desiredRuleset?.name !== policy.rulesetName || desiredRuleset.enforcement !== 'active') {
    throw new TypeError('Ruleset name and enforcement must match the repository policy.');
  }
  if (!Array.isArray(desiredRuleset.bypass_actors) || desiredRuleset.bypass_actors.length !== 0) {
    throw new TypeError('Ruleset bypass actors must be empty.');
  }
  const statusRule = desiredRuleset.rules?.find(rule => rule.type === 'required_status_checks');
  const contexts = statusRule?.parameters?.required_status_checks?.map(check => check.context) ?? [];
  if (contexts.length !== policy.requiredStatusChecks.length || policy.requiredStatusChecks.some(context => !contexts.includes(context))) {
    throw new TypeError('Ruleset required checks must exactly match repository-policy.json.');
  }
}

function positionalArgument() {
  return process.argv.slice(2).find(argument => !argument.startsWith('-'));
}
