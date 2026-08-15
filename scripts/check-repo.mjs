import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { containsExactHttpUrl } from './security-policy-links.mjs';
import { validatePolicy as validateRepositoryPolicySchema } from './lib/repository-audit.mjs';
import {
  parseWaiverEnd,
  validatePolicy as validateScorecardPolicySchema
} from './lib/scorecard-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

const requiredFiles = [
  '.editorconfig',
  '.gitattributes',
  '.github/CODEOWNERS',
  '.github/copilot-instructions.md',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/repository-policy.json',
  '.github/rulesets/main.json',
  '.github/scorecard-policy.json',
  '.github/workflows/ci.yml',
  '.github/workflows/dependency-review.yml',
  '.github/workflows/fuzz.yml',
  '.github/workflows/release.yml',
  '.github/workflows/repository-policy.yml',
  '.github/workflows/scorecard.yml',
  '.github/workflows/secret-scan.yml',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'LICENSE',
  'MAINTAINERS.md',
  'README.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/architecture.md',
  'docs/devsecops.md',
  'docs/releasing.md',
  'docs/repository-settings.md',
  'docs/scorecard-remediation.md',
  'docs/threat-model.md',
  'package-lock.json',
  'package.json',
  'scripts/apply-github-ruleset.mjs',
  'scripts/audit-github-rules.mjs',
  'scripts/check-codeql-sarif.mjs',
  'scripts/check-scorecard-results.mjs',
  'scripts/lib/repository-audit-cli.mjs',
  'scripts/lib/repository-audit.mjs',
  'scripts/lib/scorecard-policy-cli.mjs',
  'scripts/lib/scorecard-policy.mjs',
  'scripts/lib/scorecard-sarif.mjs',
  'scripts/scorecard-json-to-sarif.mjs',
  'scripts/security-policy-links.mjs',
  'test/codeql-sarif.test.cjs',
  'test/core.fuzz.test.js',
  'test/gate-cli.test.cjs',
  'test/repository-audit-timeout.test.cjs',
  'test/repository-audit.test.cjs',
  'test/scorecard-policy-cli.test.cjs',
  'test/scorecard-policy.test.cjs',
  'test/scorecard-sarif.test.cjs',
  'test/scorecard-workflow-evidence.test.cjs',
  'test/security-policy-links.test.cjs'
];

for (const path of requiredFiles) {
  if (!(await exists(path))) fail(`Missing required repository file: ${path}`);
}

const pkg = await json('package.json');
const lock = await json('package-lock.json');
const repositoryPolicy = await json('.github/repository-policy.json');
const ruleset = await json('.github/rulesets/main.json');
const scorecardPolicy = await json('.github/scorecard-policy.json');

if (pkg.publisher !== 'ppadgett') fail('package.json publisher must be ppadgett.');
if (pkg.preview !== true) fail('The extension must remain marked preview while it uses a beta Graph API.');
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) fail('Runtime npm dependencies require a separate security review.');
if (pkg.devDependencies?.['fast-check'] !== '4.9.0') fail('fast-check must be pinned to reviewed version 4.9.0.');
if (pkg.capabilities?.untrustedWorkspaces?.supported !== false) fail('The extension must be disabled in untrusted workspaces.');
for (const name of ['verify', 'fuzz', 'sast:check', 'scorecard:check', 'repository:audit', 'ruleset:apply']) {
  if (typeof pkg.scripts?.[name] !== 'string') fail(`package.json is missing required script ${name}.`);
}
if (pkg.scripts?.['scorecard:check'] !== 'node scripts/check-scorecard-results.mjs') {
  fail('package.json scorecard:check must use the exact-JSON Scorecard policy CLI.');
}

if (lock.lockfileVersion !== 3) fail('package-lock.json must use lockfileVersion 3.');
if (lock.packages?.['']?.devDependencies?.['fast-check'] !== '4.9.0') fail('Lockfile root must pin fast-check 4.9.0.');
if (lock.packages?.['node_modules/fast-check']?.version !== '4.9.0') fail('Lockfile must resolve fast-check 4.9.0.');
if (!lock.packages?.['node_modules/fast-check']?.integrity?.startsWith('sha512-')) fail('fast-check lock entry must include SHA-512 integrity.');

const security = await text('SECURITY.md');
const advisoryUrl = 'https://github.com/PPadgett/m365-copilot-vscode/security/advisories/new';
if (!containsExactHttpUrl(security, advisoryUrl)) fail(`SECURITY.md must link directly to ${advisoryUrl}.`);
if (!/vulnerab|disclos/i.test(security)) fail('SECURITY.md must document vulnerability disclosure.');

const copilotInstructions = await text('.github/copilot-instructions.md');
if (!/security-sensitive/i.test(copilotInstructions)) fail('Copilot instructions must identify the repository as security-sensitive.');
if (!/Copilot review is advisory/i.test(copilotInstructions)) fail('Copilot instructions must state that Copilot review is advisory.');

const fuzzTest = await text('test/core.fuzz.test.js');
if (!/require\(\s*['"]fast-check['"]\s*\)/.test(fuzzTest)) fail('Fuzz test must directly require fast-check for Scorecard detection.');
if (!/fc\.(?:assert|property|asyncProperty)\b/.test(fuzzTest)) fail('Fuzz test must execute fast-check properties.');

validateRepositoryPolicy(repositoryPolicy, ruleset);
validateScorecardPolicy(scorecardPolicy);

const workflowDir = join(root, '.github/workflows');
for (const entry of await readdir(workflowDir)) {
  if (!/\.ya?ml$/.test(entry)) continue;
  validateWorkflow(entry, await readFile(join(workflowDir, entry), 'utf8'));
}

const ci = await text('.github/workflows/ci.yml');
if (!/^  required:\s*$/m.test(ci) || !/^    name: Required\s*$/m.test(ci)) fail('CI must expose a stable Required aggregate check.');
if (!/^  sast:\s*$/m.test(ci) || !/^    name: SAST\s*$/m.test(ci)) fail('CI must expose the repository-owned SAST job.');
if (!/github\/codeql-action\/init@[0-9a-f]{40}/.test(ci) || !/github\/codeql-action\/analyze@[0-9a-f]{40}/.test(ci)) fail('CI SAST must use pinned CodeQL init and analyze actions.');
if (!/upload:\s*never/.test(ci) || !/check-codeql-sarif\.mjs/.test(ci)) fail('CI SAST must retain SARIF locally and enforce the repository-owned CodeQL policy.');
if (!/^      - sast\s*$/m.test(ci) || !/SAST_RESULT:\s*\$\{\{ needs\.sast\.result \}\}/.test(ci) || !/test "\$SAST_RESULT" = "success"/.test(ci)) fail('The stable Required check must fail when SAST fails.');

const fuzz = await text('.github/workflows/fuzz.yml');
if (!/\bpull_request\s*:/.test(fuzz) || !/\bschedule\s*:/.test(fuzz) || !/npm run fuzz/.test(fuzz) || !/^    name: Fuzz\s*$/m.test(fuzz)) fail('Fuzz workflow must run on pull requests and a schedule with a stable Fuzz check.');

const repositoryWorkflow = await text('.github/workflows/repository-policy.yml');
if (!/npm run repository:audit/.test(repositoryWorkflow) || !/^    name: Repository Policy\s*$/m.test(repositoryWorkflow)) fail('Repository policy workflow must audit live settings with a stable check name.');
if (!repositoryWorkflow.includes('GITHUB_TOKEN: ${{ secrets.REPOSITORY_POLICY_TOKEN }}') || !repositoryWorkflow.includes('REPOSITORY_POLICY_TOKEN: ${{ secrets.REPOSITORY_POLICY_TOKEN }}')) {
  fail('Repository policy workflow must use the administration-read REPOSITORY_POLICY_TOKEN secret.');
}
if (repositoryWorkflow.includes('GITHUB_TOKEN: ${{ github.token }}')) {
  fail('Repository policy workflow must not use the ordinary GITHUB_TOKEN for administrator-only evidence.');
}

validateScorecardWorkflow(await text('.github/workflows/scorecard.yml'));

if (failures.length > 0) {
  console.error(`Repository policy failed with ${failures.length} finding(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Repository policy checks passed.');

function validateRepositoryPolicy(policy, desired) {
  try {
    validateRepositoryPolicySchema(policy);
  } catch (error) {
    fail(error.message);
    return;
  }

  if (policy.defaultBranch !== 'main' || policy.rulesetName !== 'Protect main') fail('repository-policy.json must define main and Protect main.');
  const requiredSettings = {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    allow_update_branch: true
  };
  for (const [key, value] of Object.entries(requiredSettings)) {
    if (policy.repository[key] !== value) fail(`repository-policy.json ${key} must be ${value}.`);
  }
  if (policy.privateVulnerabilityReporting !== true) fail('Private vulnerability reporting must be required.');

  const copilotPolicy = policy.copilotCodeReview;
  if (
    copilotPolicy.enabled !== true ||
    typeof copilotPolicy.reviewDraftPullRequests !== 'boolean' ||
    typeof copilotPolicy.reviewOnPush !== 'boolean'
  ) {
    fail('repository-policy.json must define enabled automatic Copilot code review settings.');
  }

  if (desired.name !== policy.rulesetName || desired.target !== 'branch' || desired.enforcement !== 'active') fail('Ruleset name, target, and enforcement must match repository policy.');
  if (!Array.isArray(desired.bypass_actors) || desired.bypass_actors.length !== 0) fail('The main ruleset must have no bypass actors.');
  if (!desired.conditions?.ref_name?.include?.includes('~DEFAULT_BRANCH')) fail('The main ruleset must target the default branch.');
  const byType = new Map((desired.rules ?? []).map(rule => [rule.type, rule]));
  for (const type of ['deletion', 'non_fast_forward', 'required_linear_history', 'pull_request', 'copilot_code_review', 'required_status_checks']) {
    if (!byType.has(type)) fail(`The main ruleset is missing ${type}.`);
  }
  const pr = byType.get('pull_request')?.parameters;
  if ((pr?.required_approving_review_count ?? 0) < 1) fail('The main ruleset must require at least one approval.');
  for (const key of ['dismiss_stale_reviews_on_push', 'require_code_owner_review', 'require_last_push_approval', 'required_review_thread_resolution']) {
    if (pr?.[key] !== true) fail(`The main ruleset must enable ${key}.`);
  }
  if (JSON.stringify(pr?.allowed_merge_methods) !== JSON.stringify(['squash'])) fail('The main ruleset must allow only squash merging.');

  const copilot = byType.get('copilot_code_review')?.parameters;
  if (copilot?.review_draft_pull_requests !== copilotPolicy.reviewDraftPullRequests) {
    fail('Ruleset Copilot draft-review behavior must match repository-policy.json.');
  }
  if (copilot?.review_on_push !== copilotPolicy.reviewOnPush) {
    fail('Ruleset Copilot push-review behavior must match repository-policy.json.');
  }

  const status = byType.get('required_status_checks')?.parameters;
  if (status?.strict_required_status_checks_policy !== true) fail('Required status checks must be strict.');
  const actual = (status?.required_status_checks ?? []).map(check => check.context);
  if (!sameSet(actual, policy.requiredStatusChecks)) fail('Ruleset required checks must exactly match repository-policy.json.');
}

function validateScorecardPolicy(policy) {
  try {
    validateScorecardPolicySchema(policy);
  } catch (error) {
    fail(error.message);
    return;
  }

  if (policy.defaultMinimumScore !== 10 || policy.failOnUnconfiguredResults !== true) {
    fail('Scorecard policy must default to 10 and fail on unconfigured results.');
  }
  const ids = [
    'BranchProtectionID',
    'BinaryArtifactsID',
    'DependencyUpdateToolID',
    'LicenseID',
    'PinnedDependenciesID',
    'SecurityPolicyID',
    'TokenPermissionsID',
    'DangerousWorkflowID',
    'VulnerabilitiesID',
    'SASTID',
    'FuzzingID',
    'MaintainedID',
    'CodeReviewID',
    'CIIBestPracticesID',
    'CITestsID',
    'PackagingID',
    'SignedReleasesID',
    'ContributorsID'
  ];
  for (const id of ids) if (!policy.checks[id]) fail(`Scorecard policy is missing ${id}.`);
  const expectedProfiles = {
    'pull-request': [
      'BinaryArtifactsID',
      'DependencyUpdateToolID',
      'LicenseID',
      'PinnedDependenciesID',
      'SecurityPolicyID',
      'TokenPermissionsID',
      'DangerousWorkflowID',
      'VulnerabilitiesID',
      'SASTID',
      'FuzzingID'
    ],
    repository: [
      'BranchProtectionID',
      'BinaryArtifactsID',
      'DependencyUpdateToolID',
      'LicenseID',
      'PinnedDependenciesID',
      'SecurityPolicyID',
      'TokenPermissionsID',
      'DangerousWorkflowID',
      'VulnerabilitiesID',
      'SASTID',
      'FuzzingID',
      'MaintainedID',
      'CodeReviewID',
      'CIIBestPracticesID',
      'CITestsID',
      'PackagingID',
      'SignedReleasesID',
      'ContributorsID'
    ]
  };
  for (const [name, expected] of Object.entries(expectedProfiles)) {
    if (!sameSet(policy.profiles[name], expected)) fail(`Scorecard profile ${name} must contain the expected checks.`);
  }
  for (const id of ['BranchProtectionID', 'SecurityPolicyID', 'FuzzingID', 'SASTID', 'DangerousWorkflowID']) {
    if (policy.checks[id]?.waiver) fail(`${id} must not be waived.`);
  }
  for (const [id, config] of Object.entries(policy.checks)) {
    const minimum = config.minimumScore ?? policy.defaultMinimumScore;
    if (!Number.isInteger(minimum) || minimum < 0 || minimum > 10) fail(`${id} minimum score must be an integer from 0 through 10.`);
    if ('sarifMinimumScore' in config) fail(`${id} must not encode Scorecard SARIF-emission thresholds.`);
    if (!config.waiver) continue;
    if (typeof config.waiver.reason !== 'string' || config.waiver.reason.length < 20) fail(`${id} waiver needs a substantive reason.`);
    try {
      parseWaiverEnd(config.waiver);
    } catch (error) {
      fail(`${id}: ${error.message}`);
    }
  }
}

function validateScorecardWorkflow(source) {
  const jobs = new Map(extractJobs(source).map(job => [job.name, job]));
  const analysis = jobs.get('analysis');
  const policyJob = jobs.get('policy');
  if (!analysis || !policyJob) {
    fail('Scorecard workflow must define analysis and policy jobs.');
    return;
  }

  const actionUses = source.match(/uses:\s*ossf\/scorecard-action@[0-9a-f]{40}/g) ?? [];
  if (actionUses.length !== 1) fail('Scorecard workflow must execute the pinned Scorecard action exactly once.');

  const analysisSteps = new Map(extractSteps(analysis.source).map(step => [step.name, step]));
  const actionStep = analysisSteps.get('Run OpenSSF Scorecard once');
  if (!actionStep) {
    fail('Scorecard analysis job must contain the single-run Scorecard step.');
  } else {
    if (!/results_file:\s*results\.json/.test(actionStep.source) || !/results_format:\s*json/.test(actionStep.source) || !/publish_results:/.test(actionStep.source)) {
      fail('Scorecard action must explicitly emit exact results.json for every event.');
    }
    if (/results_(?:file|format):.*github\.event_name/.test(actionStep.source)) {
      fail('Scorecard action output format must not depend on event type.');
    }
  }

  const conversion = analysisSteps.get('Generate advisory Scorecard SARIF from exact JSON');
  if (!conversion || !conversion.source.includes("if: github.event_name != 'pull_request'") || !conversion.source.includes('scorecard-json-to-sarif.mjs') || !conversion.source.includes('results.json') || !conversion.source.includes('results.sarif')) {
    fail('Repository Scorecard runs must derive advisory SARIF from the exact JSON result.');
  }

  const evidenceStep = analysisSteps.get('Upload Scorecard evidence');
  if (!evidenceStep || !evidenceStep.source.includes('results.json') || !evidenceStep.source.includes('results.sarif')) {
    fail('Scorecard evidence upload must retain exact JSON and advisory SARIF when available.');
  }
  const sarifStep = analysisSteps.get('Upload advisory Scorecard SARIF to code scanning');
  if (!sarifStep || !sarifStep.source.includes("if: github.event_name != 'pull_request'") || !sarifStep.source.includes('continue-on-error: true') || !sarifStep.source.includes('results.sarif')) {
    fail('Scorecard SARIF upload must be advisory and limited to non-pull-request runs.');
  }

  const policySteps = new Map(extractSteps(policyJob.source).map(step => [step.name, step]));
  const evaluation = policySteps.get('Evaluate exact Scorecard results against policy');
  if (!evaluation || !evaluation.source.includes('check-scorecard-results.mjs') || !evaluation.source.includes('results.json')) {
    fail('Scorecard policy job must evaluate exact results.json with check-scorecard-results.mjs.');
  }
  if (evaluation?.source.includes('results.sarif')) {
    fail('Scorecard policy evaluation must not use SARIF as a gating input.');
  }
  if (!source.includes('SCORECARD_POLICY_PROFILE:') || !source.includes('pull-request') || !source.includes('repository')) {
    fail('Scorecard workflow must select pull-request and repository policy profiles explicitly.');
  }
}

function validateWorkflow(name, source) {
  if (/\bpull_request_target\s*:/.test(source)) fail(`${name}: pull_request_target is prohibited.`);
  if (!/^permissions:\s*$/m.test(source)) fail(`${name}: top-level least-privilege permissions are required.`);
  if (/^permissions:\s*(?:read-all|write-all)\s*$/m.test(source)) fail(`${name}: read-all/write-all permissions are prohibited.`);
  if (/\bcurl\b[^\n|]*\|\s*(?:ba)?sh\b/.test(source)) fail(`${name}: pipe-to-shell installation is prohibited.`);
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const value = match[1];
    if (value.startsWith('./')) continue;
    const ref = value.slice(value.lastIndexOf('@') + 1);
    if (!/^[0-9a-f]{40}$/.test(ref)) fail(`${name}: action must be pinned to a full commit SHA: ${value}`);
  }
  const checkoutCount = [...source.matchAll(/uses:\s*actions\/checkout@/g)].length;
  const hardenedCount = [...source.matchAll(/persist-credentials:\s*false/g)].length;
  if (checkoutCount !== hardenedCount) fail(`${name}: every checkout must set persist-credentials: false.`);
  for (const job of extractJobs(source)) {
    if (!/^    runs-on:\s*\S+/m.test(job.source)) fail(`${name}: job ${job.name} needs an explicit runner.`);
    if (!/^    timeout-minutes:\s*\d+/m.test(job.source)) fail(`${name}: job ${job.name} needs timeout-minutes.`);
  }
  for (const line of source.match(/^\s*run:.*npm\s+(?:ci|install).*$/gm) ?? []) {
    if (!line.includes('--ignore-scripts')) fail(`${name}: npm installs must use --ignore-scripts.`);
  }
}

function extractJobs(source) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line === 'jobs:');
  if (start < 0) return [];
  const jobs = [];
  let current;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line && !line.startsWith(' ')) break;
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) {
      if (current) jobs.push({ name: current.name, source: current.lines.join('\n') });
      current = { name: match[1], lines: [line] };
    } else if (current) current.lines.push(line);
  }
  if (current) jobs.push({ name: current.name, source: current.lines.join('\n') });
  return jobs;
}

function extractSteps(jobSource) {
  const lines = jobSource.split('\n');
  const steps = [];
  let current;
  for (const line of lines) {
    const match = line.match(/^      - name:\s*(.+?)\s*$/);
    if (match) {
      if (current) steps.push({ name: current.name, source: current.lines.join('\n') });
      current = { name: match[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) steps.push({ name: current.name, source: current.lines.join('\n') });
  return steps;
}

async function text(path) { return readFile(join(root, path), 'utf8'); }
async function json(path) { return JSON.parse(await text(path)); }
async function exists(path) { try { await stat(join(root, path)); return true; } catch { return false; } }
function sameSet(a, b) { return a.length === b.length && new Set(a).size === a.length && a.every(value => b.includes(value)); }
function fail(message) { failures.push(message); }
