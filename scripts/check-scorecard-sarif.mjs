import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

if (isMainModule()) {
  await main();
}

export async function main() {
  const sarifArgument = process.argv[2] ?? 'results.sarif';
  const policyArgument = process.argv[3] ?? '.github/scorecard-policy.json';
  const reportArgument = process.argv[4] ?? 'scorecard-policy-report.json';
  const profileName = process.argv[5] ?? process.env.SCORECARD_POLICY_PROFILE ?? 'repository';
  const exactArgument = process.argv[6] ?? 'results.json';
  const sarifPath = resolve(root, sarifArgument);
  const policyPath = resolve(root, policyArgument);
  const reportPath = resolve(root, reportArgument);
  const exactPath = resolve(root, exactArgument);
  const evaluatedAt = parseEvaluationDate(process.env.SCORECARD_POLICY_DATE);

  const [sarif, policy, exactDocument] = await Promise.all([
    readJson(sarifPath, 'Scorecard SARIF'),
    readJson(policyPath, 'Scorecard policy'),
    readJson(exactPath, 'Scorecard exact JSON')
  ]);

  const report = evaluateScorecardPolicy({
    sarif,
    exactDocument,
    policy,
    profileName,
    evaluatedAt,
    sarifFile: sarifArgument,
    exactScorecardFile: exactArgument,
    policyFile: policyArgument
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const summary = renderSummary(report);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  if (!report.passed) {
    process.exitCode = 1;
  }
}

export function evaluateScorecardPolicy({
  sarif,
  exactDocument,
  policy,
  profileName = 'repository',
  evaluatedAt = new Date(),
  sarifFile = 'results.sarif',
  exactScorecardFile = 'results.json',
  policyFile = '.github/scorecard-policy.json'
}) {
  validatePolicy(policy);
  if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
    throw new TypeError('evaluatedAt must be a valid Date.');
  }

  const selectedRuleIds = policy.profiles[profileName];
  if (!selectedRuleIds) {
    throw new Error(`Unknown Scorecard policy profile ${JSON.stringify(profileName)}.`);
  }

  const scorecard = collectScorecardResults(sarif);
  const exactScorecard = collectExactScorecardResults(exactDocument);
  if (normalizeVersion(scorecard.version) !== normalizeVersion(exactScorecard.version)) {
    throw new Error(
      `Scorecard evidence version mismatch: SARIF ${JSON.stringify(scorecard.version)} versus exact JSON ${JSON.stringify(exactScorecard.version)}.`
    );
  }

  const entries = [];
  const failures = [];
  const allConfiguredRuleIds = new Set(Object.keys(policy.checks));

  for (const ruleId of selectedRuleIds) {
    const configuration = policy.checks[ruleId];
    const minimumScore = configuration.minimumScore ?? policy.defaultMinimumScore;
    const sarifMinimumScore = configuration.sarifMinimumScore;
    const exact = exactScorecard.results.get(ruleId);
    const sarifResult = scorecard.results.get(ruleId);
    const waiver = configuration.waiver ?? null;
    const evidenceFailures = [];

    if (!exact) {
      evidenceFailures.push('The expected check was absent from the exact Scorecard JSON evidence.');
    }
    if (!scorecard.knownRuleIds.has(ruleId)) {
      evidenceFailures.push('The expected check was absent from the Scorecard SARIF rule catalog.');
    }

    let sarifEvidence = 'unavailable';
    if (exact && scorecard.knownRuleIds.has(ruleId)) {
      sarifEvidence = validateSarifEvidence(ruleId, exact.score, sarifResult, sarifMinimumScore, evidenceFailures);
    }

    const entry = {
      ruleId,
      name: configuration.name,
      score: exact?.score ?? null,
      minimumScore,
      sarifMinimumScore,
      sarifEvidence,
      status: 'pass',
      message: exact?.reason ?? 'Exact Scorecard evidence was unavailable.',
      waiver,
      evidenceFailures
    };

    if (evidenceFailures.length > 0) {
      entry.status = 'fail';
      for (const failure of evidenceFailures) {
        failures.push(`${configuration.name}: ${failure}`);
      }
    } else if (exact.score === -1) {
      if (isActiveWaiver(waiver, evaluatedAt)) {
        entry.status = 'waived';
      } else {
        entry.status = 'fail';
        failures.push(`${configuration.name} was inconclusive; a numeric score is required.`);
      }
    } else if (exact.score < minimumScore) {
      if (isActiveWaiver(waiver, evaluatedAt)) {
        entry.status = 'waived';
      } else {
        entry.status = 'fail';
        failures.push(`${configuration.name} scored ${exact.score}; required minimum is ${minimumScore}.`);
      }
    }
    entries.push(entry);
  }

  if (policy.failOnUnconfiguredResults) {
    for (const [ruleId, result] of scorecard.results) {
      if (allConfiguredRuleIds.has(ruleId)) {
        continue;
      }
      const exact = exactScorecard.results.get(ruleId);
      const evidenceFailures = [];
      if (!exact) {
        evidenceFailures.push('The SARIF result had no matching exact JSON check.');
      } else if (exact.score !== result.score) {
        evidenceFailures.push(`SARIF score ${result.score} disagrees with exact JSON score ${exact.score}.`);
      }
      const score = exact?.score ?? result.score;
      const minimumScore = policy.defaultMinimumScore;
      const status = evidenceFailures.length === 0 && score >= minimumScore ? 'pass' : 'fail';
      entries.push({
        ruleId,
        name: exact?.name ?? ruleId,
        score,
        minimumScore,
        sarifMinimumScore: null,
        sarifEvidence: 'explicit-unconfigured',
        status,
        message: exact?.reason ?? result.messages.join('\n'),
        waiver: null,
        evidenceFailures
      });
      if (evidenceFailures.length > 0) {
        for (const failure of evidenceFailures) {
          failures.push(`Unconfigured Scorecard result ${ruleId}: ${failure}`);
        }
      } else if (status === 'fail') {
        failures.push(`Unconfigured Scorecard result ${ruleId} scored ${score}; required minimum is ${minimumScore}.`);
      }
    }
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 3,
    evaluatedAt: evaluatedAt.toISOString(),
    profile: profileName,
    sarifFile,
    exactScorecardFile,
    policyFile,
    scorecardRuns: scorecard.runCount,
    scorecardVersion: exactScorecard.version,
    passed: failures.length === 0,
    failures,
    checks: entries
  };
}

function collectScorecardResults(document) {
  if (!document || !Array.isArray(document.runs)) {
    throw new TypeError('The Scorecard SARIF document has no runs array.');
  }

  const results = new Map();
  const knownRuleIds = new Set();
  const versions = new Set();
  let runCount = 0;

  for (const run of document.runs) {
    const driver = run?.tool?.driver;
    if (driver?.name !== 'Scorecard') {
      continue;
    }
    runCount += 1;
    if (typeof driver.semanticVersion !== 'string' || !driver.semanticVersion.trim()) {
      throw new Error('A Scorecard SARIF run did not declare semanticVersion.');
    }
    versions.add(driver.semanticVersion.trim());

    if (!Array.isArray(driver.rules)) {
      throw new Error('A Scorecard SARIF run did not include a rules array.');
    }
    for (const rule of driver.rules) {
      if (typeof rule?.id !== 'string' || !rule.id) {
        throw new Error('Scorecard SARIF contained a rule without a valid ID.');
      }
      knownRuleIds.add(rule.id);
    }

    if (!Array.isArray(run.results)) {
      throw new Error('A Scorecard SARIF run did not include a results array.');
    }
    for (const result of run.results) {
      const ruleId = result?.ruleId ?? result?.rule?.id;
      const message = result?.message?.text;
      if (typeof ruleId !== 'string' || typeof message !== 'string') {
        throw new Error('Scorecard SARIF contained a result without a valid rule ID and message.');
      }
      knownRuleIds.add(ruleId);
      const match = message.match(/\bscore is\s+(-?\d+(?:\.\d+)?)/i);
      if (!match) {
        throw new Error(`Could not extract a numeric score from ${ruleId}.`);
      }
      const score = Number.parseFloat(match[1]);
      if (!Number.isFinite(score) || score < -1 || score > 10) {
        throw new Error(`Scorecard emitted an invalid SARIF score for ${ruleId}.`);
      }
      const existing = results.get(ruleId);
      if (existing && existing.score !== score) {
        throw new Error(`Scorecard emitted inconsistent SARIF scores for ${ruleId}.`);
      }
      if (existing) {
        existing.messages.push(message);
      } else {
        results.set(ruleId, { score, messages: [message] });
      }
    }
  }

  if (runCount === 0) {
    throw new Error('The SARIF document contained no OpenSSF Scorecard runs.');
  }
  if (versions.size !== 1) {
    throw new Error(`Scorecard SARIF runs used inconsistent versions: ${[...versions].join(', ')}.`);
  }
  return { results, knownRuleIds, runCount, version: [...versions][0] };
}

function collectExactScorecardResults(document) {
  const version = document?.scorecard?.version;
  if (typeof version !== 'string' || !version.trim()) {
    throw new TypeError('The exact Scorecard JSON document has no scorecard.version.');
  }
  if (!Array.isArray(document.checks) || document.checks.length === 0) {
    throw new TypeError('The exact Scorecard JSON document has no checks array.');
  }

  const results = new Map();
  for (const check of document.checks) {
    if (typeof check?.name !== 'string' || !/^[A-Za-z0-9-]+$/.test(check.name)) {
      throw new TypeError('The exact Scorecard JSON contained a check with an invalid name.');
    }
    if (!Number.isInteger(check.score) || check.score < -1 || check.score > 10) {
      throw new TypeError(`The exact Scorecard JSON contained an invalid score for ${check.name}.`);
    }
    if (typeof check.reason !== 'string' || !check.reason.trim()) {
      throw new TypeError(`The exact Scorecard JSON contained no reason for ${check.name}.`);
    }
    const ruleId = scorecardRuleId(check.name);
    if (results.has(ruleId)) {
      throw new Error(`The exact Scorecard JSON contained duplicate check ${check.name}.`);
    }
    results.set(ruleId, {
      name: check.name,
      score: check.score,
      reason: check.reason
    });
  }
  return { results, version: version.trim() };
}

function validateSarifEvidence(ruleId, exactScore, sarifResult, sarifMinimumScore, failures) {
  if (exactScore === -1) {
    if (sarifResult) {
      failures.push(`Inconclusive exact score for ${ruleId} unexpectedly produced a SARIF result.`);
      return 'unexpected-explicit';
    }
    return 'omitted-inconclusive';
  }

  if (exactScore < sarifMinimumScore) {
    if (!sarifResult) {
      failures.push(`Exact score ${exactScore} is below the SARIF threshold ${sarifMinimumScore}, but no SARIF result was emitted.`);
      return 'missing-explicit';
    }
    if (sarifResult.score !== exactScore) {
      failures.push(`SARIF score ${sarifResult.score} disagrees with exact JSON score ${exactScore}.`);
      return 'mismatched-explicit';
    }
    return 'explicit';
  }

  if (sarifResult) {
    failures.push(`Exact score ${exactScore} meets the SARIF threshold ${sarifMinimumScore}, but a SARIF result was emitted.`);
    return 'unexpected-explicit';
  }
  return 'omitted-as-expected';
}

function validatePolicy(value) {
  if (!value || value.version !== 2 || !value.checks || typeof value.checks !== 'object') {
    throw new TypeError('Scorecard policy must use version 2 and define checks.');
  }
  if (!value.profiles || typeof value.profiles !== 'object') {
    throw new TypeError('Scorecard policy must define profiles.');
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
    if (!Number.isInteger(configuration.sarifMinimumScore) || configuration.sarifMinimumScore < 0 || configuration.sarifMinimumScore > 10) {
      throw new TypeError(`${ruleId} sarifMinimumScore must be an integer from 0 through 10.`);
    }
    if (configuration.waiver) {
      parseWaiverEnd(configuration.waiver);
      if (typeof configuration.waiver.reason !== 'string' || configuration.waiver.reason.length < 20) {
        throw new TypeError(`${ruleId} waiver must include a substantive reason.`);
      }
    }
  }
  for (const [name, ruleIds] of Object.entries(value.profiles)) {
    if (!Array.isArray(ruleIds) || ruleIds.length === 0 || new Set(ruleIds).size !== ruleIds.length) {
      throw new TypeError(`Scorecard profile ${name} must contain unique check IDs.`);
    }
    for (const ruleId of ruleIds) {
      if (!value.checks[ruleId]) {
        throw new TypeError(`Scorecard profile ${name} references unknown check ${ruleId}.`);
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
    `## OpenSSF Scorecard policy (${report.profile})`,
    '',
    `Scorecard version: \`${report.scorecardVersion}\``,
    '',
    '| Check | Exact score | Policy minimum | SARIF threshold | SARIF evidence | Status |',
    '| --- | ---: | ---: | ---: | --- | --- |'
  ];
  for (const entry of report.checks) {
    const suffix = entry.status === 'waived' ? ` until ${entry.waiver.expires}` : '';
    const score = entry.score === null ? 'missing' : entry.score;
    const sarifMinimum = entry.sarifMinimumScore === null ? 'n/a' : entry.sarifMinimumScore;
    lines.push(
      `| ${escapeTable(entry.name)} | ${score} | ${entry.minimumScore} | ${sarifMinimum} | ${escapeTable(entry.sarifEvidence)} | ${entry.status}${suffix} |`
    );
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

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} file could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} file is not valid JSON: ${error.message}`);
  }
}

function scorecardRuleId(name) {
  return `${name.replaceAll('-', '')}ID`;
}

function normalizeVersion(value) {
  return String(value).trim().replace(/^v/i, '');
}

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function isMainModule() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}
