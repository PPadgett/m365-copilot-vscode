import { appendFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inputArgument = process.argv[2] ?? 'codeql-results';
const reportArgument = process.argv[3] ?? 'codeql-policy-report.json';
const inputPath = resolve(root, inputArgument);
const reportPath = resolve(root, reportArgument);

const sarifFiles = await findSarifFiles(inputPath);
if (sarifFiles.length === 0) {
  throw new Error(`No SARIF files were found under ${inputArgument}.`);
}

const findings = [];
let codeqlRuns = 0;

for (const file of sarifFiles) {
  let document;
  try {
    document = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse SARIF file ${displayPath(file)}: ${error.message}`);
  }

  if (!document || !Array.isArray(document.runs)) {
    throw new TypeError(`SARIF file ${displayPath(file)} has no runs array.`);
  }

  for (const run of document.runs) {
    const driver = run?.tool?.driver;
    if (typeof driver?.name !== 'string' || !/codeql/i.test(driver.name)) {
      continue;
    }

    codeqlRuns += 1;
    const rules = new Map(
      (driver.rules ?? [])
        .filter(rule => typeof rule?.id === 'string')
        .map(rule => [rule.id, rule])
    );

    for (const result of run.results ?? []) {
      if (isSuppressed(result)) {
        continue;
      }

      const ruleId = result?.ruleId ?? result?.rule?.id ?? 'unknown-rule';
      const rule = rules.get(ruleId);
      const location = firstLocation(result);
      findings.push({
        file: displayPath(file),
        ruleId,
        level: result?.level ?? rule?.defaultConfiguration?.level ?? 'warning',
        message: boundedText(result?.message?.text ?? 'CodeQL emitted a result without a message.'),
        location
      });
    }
  }
}

if (codeqlRuns === 0) {
  throw new Error('The SARIF input contained no CodeQL runs.');
}

const report = {
  schemaVersion: 1,
  input: inputArgument,
  sarifFiles: sarifFiles.map(displayPath),
  codeqlRuns,
  passed: findings.length === 0,
  findingCount: findings.length,
  findings
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const summary = renderSummary(report);
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

if (!report.passed) {
  process.exitCode = 1;
}

async function findSarifFiles(path) {
  const metadata = await stat(path);
  if (metadata.isFile()) {
    return isSarifPath(path) ? [path] : [];
  }
  if (!metadata.isDirectory()) {
    return [];
  }

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findSarifFiles(child));
    } else if (entry.isFile() && isSarifPath(child)) {
      files.push(child);
    }
  }
  return files.sort();
}

function isSarifPath(path) {
  const lower = path.toLowerCase();
  return lower.endsWith('.sarif') || lower.endsWith('.sarif.json');
}

function isSuppressed(result) {
  return Array.isArray(result?.suppressions) && result.suppressions.length > 0;
}

function firstLocation(result) {
  const physical = result?.locations?.[0]?.physicalLocation;
  const uri = physical?.artifactLocation?.uri;
  const line = physical?.region?.startLine;
  if (typeof uri !== 'string') {
    return null;
  }
  return {
    uri: boundedText(uri, 500),
    line: Number.isSafeInteger(line) && line > 0 ? line : null
  };
}

function boundedText(value, maximum = 1000) {
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function displayPath(path) {
  const relativePath = relative(root, path).replaceAll('\\', '/');
  return relativePath && !relativePath.startsWith('../') ? relativePath : basename(path);
}

function renderSummary(report) {
  const lines = [
    '## Repository-owned CodeQL policy',
    '',
    `CodeQL runs: ${report.codeqlRuns}`,
    '',
    `Unsuppressed findings: ${report.findingCount}`
  ];

  if (report.passed) {
    lines.push('', 'CodeQL policy passed.');
    return lines.join('\n');
  }

  lines.push('', 'CodeQL policy failed. Every unsuppressed result must be resolved or explicitly reviewed and suppressed.');
  for (const finding of report.findings.slice(0, 20)) {
    const location = finding.location
      ? ` at ${finding.location.uri}${finding.location.line ? `:${finding.location.line}` : ''}`
      : '';
    lines.push(`- ${finding.ruleId} (${finding.level})${location}: ${finding.message}`);
  }
  if (report.findings.length > 20) {
    lines.push(`- ${report.findings.length - 20} additional finding(s) are recorded in ${reportArgument}.`);
  }
  return lines.join('\n');
}
