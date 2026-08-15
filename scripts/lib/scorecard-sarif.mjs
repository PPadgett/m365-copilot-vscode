import {
  collectExactScorecardResults,
  scorecardRuleId
} from './scorecard-policy.mjs';

export function convertScorecardJsonToSarif(exactDocument) {
  const exact = collectExactScorecardResults(exactDocument);
  const entries = [...exact.results.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      left.name.localeCompare(right.name) || leftId.localeCompare(rightId)
  );

  const rules = entries.map(([ruleId, result]) => ({
    id: ruleId,
    name: result.name,
    shortDescription: {
      text:
        result.documentationShort
        || `OpenSSF Scorecard check ${result.name}`
    },
    fullDescription: {
      text: `OpenSSF Scorecard evaluates the ${result.name} control.`
    },
    helpUri: result.documentationUrl ?? undefined,
    properties: {
      tags: ['security', 'OpenSSF Scorecard']
    }
  }));

  const results = entries
    .filter(([, result]) => result.score === -1 || result.score < 10)
    .map(([ruleId, result]) => ({
      ruleId,
      level: sarifLevel(result.score),
      message: {
        text: `${result.name} score is ${result.score}: ${result.reason}`
      },
      properties: {
        score: result.score,
        reason: result.reason,
        'security-severity': securitySeverity(result.score)
      }
    }));

  const run = {
    tool: {
      driver: {
        name: 'OpenSSF Scorecard',
        informationUri: 'https://github.com/ossf/scorecard',
        semanticVersion: exact.version.replace(/^v/, ''),
        rules
      }
    },
    invocations: [
      {
        executionSuccessful: true
      }
    ],
    results
  };

  const repositoryUri = normalizedRepositoryUri(exact.repository);
  if (repositoryUri && exact.repositoryCommit) {
    run.versionControlProvenance = [
      {
        repositoryUri,
        revisionId: exact.repositoryCommit
      }
    ];
  }

  return {
    $schema:
      'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [run]
  };
}

function sarifLevel(score) {
  if (score === -1) {
    return 'warning';
  }
  if (score <= 3) {
    return 'error';
  }
  return 'warning';
}

function securitySeverity(score) {
  if (score === -1) {
    return '5.0';
  }
  return Math.max(0, Math.min(10, 10 - score)).toFixed(1);
}

function normalizedRepositoryUri(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  if (/^https:\/\//.test(value)) {
    return value;
  }
  if (/^github\.com\//.test(value)) {
    return `https://${value}`;
  }
  return null;
}

export { scorecardRuleId };
