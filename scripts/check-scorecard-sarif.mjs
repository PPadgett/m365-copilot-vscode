import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sarifArgument = process.argv[2] ?? 'results.sarif';
const policyArgument = process.argv[3] ?? '.github/scorecard-policy.json';
const reportArgument = process.argv[4] ?? 'scorecard-policy-report.json';
const sarifPath = resolve(root, sarifArgument);
const policyPath = resolve(root, policyArgument);
const reportPath = resolve(root, reportArgument);
const evaluatedAt = parseEvaluationDate(process.env.SCORECARD_POLICY_DATE);

const sarif = JSON.parse(await readFile(sarifPath, 'utf8'));
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
validatePolicy(policy);

const scorecard = collectScorecardResults(sarif);
const entries = [];
const failures = [];
const configuredRuleIds = new Set(Object.keys(policy.checks));

for (const [ruleId, configuration] of Object.entries(policy.checks)) {
  const minimumScore = configuration.minimumScore ?? policy.defaultMinimumScore;
  const result = scorecard.results.get(ruleId);

  if (!scorecard.knownRuleIds.has(ruleId)) {
    entries.push({
      ruleId,
      name: configuration.name,
      score: null,
      minimumScore,
      status: 'fail',
      message: 'The expected check was absent from the Scorecard SARIF rule catalog.',
      waiver: configuration.waiver ?? null
    });
    failures.push(`${configuration.name} (${ruleId}) was absent from the Scorecard SARIF rule catalog.`);
    continue;
  }

  const score = result?.score ?? 10;
  const entry = {
    ruleId,
    name: configuration.name,
    score,
    minimumScore,
    status: 'pass',
    message: result?.message ?? 'No suboptimal Scorecard result was emitted.',
    waiver: configuration.waiver ?? null
  };

  if (score < minimumScore) {
    if (isActiveWaiver(configuration.waiver, evaluatedAt)) {
      entry.status = 'waived';
    } else {
      entry.status = 'fail';
      failures.push(`${configuration.name} scored ${score}; required minimum is ${minimumScore}.`);
    }
  }
  entries.push(entry);
}

if (policy.failOnUnconfiguredResults) {
  for (const [ruleId, result] of scorecard.results) {
    if (configuredRuleIds.has(ruleId)) {
      continue;
    }
    const minimumScore = policy.defaultMinimumScore;
    const status = result.score >= minimumScore ? 'pass' : 'fail';
    entries.push({
      ruleId,
      name: ruleId,
      score: result.score,
      minimumScore,
      status,
      message: result.message,
      waiver: null
    });
    if (status === 'fail') {
      failures.push(`Unconfigured Scorecard result ${ruleId} scored ${result.score}; required minimum is ${minimumScore}.`);
    }
  }
}

entries.sort((left, right) => left.name.localeCompare(right.name));
const report = {
  schemaVersion: 1,
  evaluatedAt: evaluatedAt.toISOString(),
  sarifFile: sarifArgument,
  policyFile: policyArgument,
  scorecardRuns: scorecard.runCount,
  passed: failures.length === 0,
  failures,
  checks: entries
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const summary = renderSummary(report);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}

function collectScorecardResults(document) {
  if (!document || !Array.isArray(document.runs)) {
    throw new TypeError('The Scorecard SARIF document has no runs array.');
  }

  const results = new Map();
  const knownRuleIds = new Set();
  let runCount = 0;

  for (const run of document.runs) {
    const driver = run?.tool?.driver;
    if (driver?.name !== 'Scorecard') {
      continue;
    }
    runCount += 1;

    for (const rule of driver.rules ?? []) {
      if (typeof rule?.id === 'string' && rule.id) {
        knownRuleIds.add(rule.id);
      }
    }

    for (const result of run.results ?? []) {
      const ruleId = result?.ruleId ?? result?.rule?.id;
      const message = result?.message?.text;
      if (typeof ruleId !== 'string' || typeof message !== 'string') {
        continue;
      }
      knownRuleIds.add(ruleId);
      const match = message.match(/\bscore is\s+(-?\d+(?:\.\d+)?)/i);
      if (!match) {
        throw new Error(`Could not extract a numeric score from ${ruleId}.`);
      }
      const score = Number.parseFloat(match[1]);
      if (!Number.isFinite(score)) {
        throw new Error(`Scorecard emitted a non-finite score for ${ruleId}.`);
      }
      results.set(ruleId, { score, message });
    }
  }

  if (runCount === 0) {
    throw new Error('The SARIF document contained no OpenSSF Scorecard runs.');
  }
  return { results, knownRuleIds, runCount };
}

function validatePolicy(value) {
  if (!value || value.version !== 1 || !value.checks || typeof value.checks !== 'object') {
    throw new TypeError('Scorecard policy must use version 1 and define checks.');
  }
  if (value.failOnUnconfiguredResults !== true) {
    throw new TypeError('Scorecard policy must fail on unconfigured results.');
  }
  if (!Number.isFinite(value.defaultMinimumScore) || value.defaultMinimumScore < 0 || value.defaultMinimumScore > 10) {
    throw new TypeError('defaultMinimumScore must be between 0 and 10.');
  }
  for (const [ruleId, configuration] of Object.entries(value.checks)) {
    if (!configuration || typeof configuration.name !== 'string' || !configuration.name) {
      throw new TypeError(`${ruleId} must define a non-empty name.`);
    }
    const minimumScore = configuration.minimumScore ?? value.defaultMinimumScore;
    if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 10) {
      throw new TypeError(`${ruleId} minimumScore must be between 0 and 10.`);
    }
    if (configuration.waiver) {
      parseWaiverEnd(configuration.waiver);
      if (typeof configuration.waiver.reason !== 'string' || configuration.waiver.reason.length < 20) {
        throw new TypeError(`${ruleId} waiver must include a substantive reason.`);
      }
    }
  }
}

function isActiveWaiver(waiver, now) {
  return Boolean(waiver && now <= parseWaiverEnd(waiver));
}

function parseWaiverEnd(waiver) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(waiver?.expires ?? '')) {
    throw new TypeError('Waiver expiry must use YYYY-MM-DD.');
  }
  const end = new Date(`${waiver.expires}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) {
    throw new TypeError(`Invalid waiver expiry: ${waiver.expires}.`);
  }
  return end;
}

function parseEvaluationDate(value) {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('SCORECARD_POLICY_DATE must be a valid ISO-8601 date or timestamp.');
  }
  return parsed;
}

function renderSummary(report) {
  const lines = [
    '## OpenSSF Scorecard policy',
    '',
    '| Check | Score | Minimum | Status |',
    '| --- | ---: | ---: | --- |'
  ];
  for (const entry of report.checks) {
    const suffix = entry.status === 'waived' ? ` until ${entry.waiver.expires}` : '';
    const score = entry.score === null ? 'missing' : entry.score;
    lines.push(`| ${escapeTable(entry.name)} | ${score} | ${entry.minimumScore} | ${entry.status}${suffix} |`);
  }
  lines.push('');
  lines.push(report.passed ? 'Scorecard policy passed.' : `Scorecard policy failed with ${report.failures.length} finding(s).`);
  if (!report.passed) {
    for (const failure of report.failures) {
      lines.push(`- ${failure}`);
    }
  }
  return lines.join('\n');
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
