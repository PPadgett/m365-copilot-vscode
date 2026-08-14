export function evaluateScorecardPolicy({
  exactDocument,
  policy,
  profileName = 'repository',
  evaluatedAt = new Date(),
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

  const exact = collectExactScorecardResults(exactDocument);
  const selected = new Set(selectedRuleIds);
  const configured = new Set(Object.keys(policy.checks));
  const entries = [];
  const failures = [];

  for (const ruleId of selectedRuleIds) {
    const configuration = policy.checks[ruleId];
    const minimumScore = configuration.minimumScore ?? policy.defaultMinimumScore;
    const result = exact.results.get(ruleId);
    const waiver = configuration.waiver ?? null;

    if (!result) {
      entries.push({
        ruleId,
        name: configuration.name,
        configured: true,
        selected: true,
        score: null,
        minimumScore,
        status: 'fail',
        message: 'The selected check was absent from the exact Scorecard JSON evidence.',
        documentationUrl: null,
        waiver
      });
      failures.push(`${configuration.name}: selected check was absent from the exact Scorecard JSON evidence.`);
      continue;
    }

    let status = 'pass';
    if (result.score === -1 || result.score < minimumScore) {
      if (isActiveWaiver(waiver, evaluatedAt)) {
        status = 'waived';
      } else {
        status = 'fail';
        if (result.score === -1) {
          failures.push(`${configuration.name} was inconclusive; a numeric score is required.`);
        } else {
          failures.push(`${configuration.name} scored ${result.score}; required minimum is ${minimumScore}.`);
        }
      }
    }

    entries.push(entryFromResult({
      ruleId,
      result,
      configured: true,
      selected: true,
      minimumScore,
      status,
      waiver
    }));
  }

  for (const [ruleId, result] of exact.results) {
    if (selected.has(ruleId)) {
      continue;
    }

    if (configured.has(ruleId)) {
      const configuration = policy.checks[ruleId];
      entries.push(entryFromResult({
        ruleId,
        result,
        configured: true,
        selected: false,
        minimumScore: configuration.minimumScore ?? policy.defaultMinimumScore,
        status: 'profile-excluded',
        waiver: configuration.waiver ?? null
      }));
      continue;
    }

    const minimumScore = policy.defaultMinimumScore;
    const status = result.score !== -1 && result.score >= minimumScore ? 'pass' : 'fail';
    entries.push(entryFromResult({
      ruleId,
      result,
      configured: false,
      selected: false,
      minimumScore,
      status,
      waiver: null
    }));

    if (policy.failOnUnconfiguredResults && status === 'fail') {
      if (result.score === -1) {
        failures.push(`Unconfigured Scorecard check ${result.name} was inconclusive; review and configure it explicitly.`);
      } else {
        failures.push(`Unconfigured Scorecard check ${result.name} scored ${result.score}; default minimum is ${minimumScore}.`);
      }
    }
  }

  entries.sort((left, right) => left.name.localeCompare(right.name) || left.ruleId.localeCompare(right.ruleId));
  return {
    schemaVersion: 4,
    evaluatedAt: evaluatedAt.toISOString(),
    profile: profileName,
    exactScorecardFile,
    policyFile,
    scorecardVersion: exact.version,
    scorecardCommit: exact.scorecardCommit,
    repository: exact.repository,
    repositoryCommit: exact.repositoryCommit,
    passed: failures.length === 0,
    failures,
    checks: entries
  };
}

export function collectExactScorecardResults(document) {
  const version = document?.scorecard?.version;
  const scorecardCommit = document?.scorecard?.commit;
  if (typeof version !== 'string' || !version.trim()) {
    throw new TypeError('The exact Scorecard JSON document has no scorecard.version.');
  }
  if (typeof scorecardCommit !== 'string' || !scorecardCommit.trim()) {
    throw new TypeError('The exact Scorecard JSON document has no scorecard.commit.');
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
    if (check.documentation?.url !== undefined && typeof check.documentation.url !== 'string') {
      throw new TypeError(`The exact Scorecard JSON contained an invalid documentation URL for ${check.name}.`);
    }

    const ruleId = scorecardRuleId(check.name);
    if (results.has(ruleId)) {
      throw new Error(`The exact Scorecard JSON contained duplicate check ${check.name}.`);
    }
    results.set(ruleId, {
      name: check.name,
      score: check.score,
      reason: check.reason.trim(),
      documentationUrl: check.documentation?.url || null
    });
  }

  return {
    results,
    version: version.trim(),
    scorecardCommit: scorecardCommit.trim(),
    repository: typeof document.repo?.name === 'string' ? document.repo.name : null,
    repositoryCommit: typeof document.repo?.commit === 'string' ? document.repo.commit : null
  };
}

export function validatePolicy(value) {
  if (!value || value.version !== 3 || !value.checks || typeof value.checks !== 'object') {
    throw new TypeError('Scorecard policy must use version 3 and define checks.');
  }
  if (!value.profiles || typeof value.profiles !== 'object') {
    throw new TypeError('Scorecard policy must define profiles.');
  }
  if (value.failOnUnconfiguredResults !== true) {
    throw new TypeError('Scorecard policy must fail on unconfigured results.');
  }
  if (!Number.isInteger(value.defaultMinimumScore) || value.defaultMinimumScore < 0 || value.defaultMinimumScore > 10) {
    throw new TypeError('defaultMinimumScore must be an integer from 0 through 10.');
  }

  for (const [ruleId, configuration] of Object.entries(value.checks)) {
    if (!configuration || typeof configuration.name !== 'string' || !configuration.name) {
      throw new TypeError(`${ruleId} must define a non-empty name.`);
    }
    if (scorecardRuleId(configuration.name) !== ruleId) {
      throw new TypeError(`${ruleId} does not match configured check name ${configuration.name}.`);
    }
    const minimumScore = configuration.minimumScore ?? value.defaultMinimumScore;
    if (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 10) {
      throw new TypeError(`${ruleId} minimumScore must be an integer from 0 through 10.`);
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

export function isActiveWaiver(waiver, now) {
  return Boolean(waiver && now <= parseWaiverEnd(waiver));
}

export function parseEvaluationDate(value) {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('SCORECARD_POLICY_DATE must be a valid ISO-8601 date or timestamp.');
  }
  return parsed;
}

export function renderSummary(report) {
  const lines = [
    `## OpenSSF Scorecard policy (${report.profile})`,
    '',
    `Scorecard version: \`${report.scorecardVersion}\``,
    '',
    '| Check | Score | Minimum | Scope | Status |',
    '| --- | ---: | ---: | --- | --- |'
  ];
  for (const entry of report.checks) {
    const suffix = entry.status === 'waived' ? ` until ${entry.waiver.expires}` : '';
    const score = entry.score === null ? 'missing' : entry.score;
    const scope = entry.selected ? 'selected' : entry.configured ? 'profile-excluded' : 'unconfigured';
    lines.push(`| ${escapeTable(entry.name)} | ${score} | ${entry.minimumScore} | ${scope} | ${entry.status}${suffix} |`);
  }
  lines.push('');
  lines.push(report.passed ? 'Scorecard policy passed.' : `Scorecard policy failed with ${report.failures.length} finding(s).`);
  for (const failure of report.failures) {
    lines.push(`- ${failure}`);
  }
  return lines.join('\n');
}

export function scorecardRuleId(name) {
  return `${name.replaceAll('-', '')}ID`;
}

function entryFromResult({ ruleId, result, configured, selected, minimumScore, status, waiver }) {
  return {
    ruleId,
    name: result.name,
    configured,
    selected,
    score: result.score,
    minimumScore,
    status,
    message: result.reason,
    documentationUrl: result.documentationUrl,
    waiver
  };
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

function escapeTable(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}
