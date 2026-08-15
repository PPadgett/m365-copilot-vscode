import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  renderRepositoryAuditSummary,
  runRepositoryAudit
} from './repository-audit.mjs';

const root = resolve(import.meta.dirname, '../..');

export async function runRepositoryAuditCli(
  argv = process.argv.slice(2),
  environment = process.env,
  output = console
) {
  const repository = argv[0] ?? environment.GITHUB_REPOSITORY;
  const policyPath = resolve(root, argv[1] ?? '.github/repository-policy.json');

  try {
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    const branch = environment.GITHUB_DEFAULT_BRANCH ?? policy.defaultBranch;
    const { failures, warnings } = await runRepositoryAudit({
      repository,
      policy,
      branch,
      apiUrl: environment.GITHUB_API_URL,
      token: environment.GITHUB_TOKEN,
      apiVersion: environment.GITHUB_API_VERSION
    });

    const summary = renderRepositoryAuditSummary(
      repository,
      branch,
      failures,
      warnings
    );
    output.log(summary);
    if (environment.GITHUB_STEP_SUMMARY) {
      await appendFile(environment.GITHUB_STEP_SUMMARY, `${summary}\n`);
    }
    return {
      exitCode: failures.length > 0 || warnings.length > 0 ? 1 : 0,
      failures,
      warnings,
      summary
    };
  } catch (error) {
    const message = `Repository policy audit failed before completion: ${error.message}`;
    output.error(message);
    if (environment.GITHUB_STEP_SUMMARY) {
      await appendFile(
        environment.GITHUB_STEP_SUMMARY,
        `## GitHub repository policy\n\n${message}\n`
      );
    }
    return {
      exitCode: 1,
      failures: [message],
      warnings: [],
      summary: message,
      error
    };
  }
}
