import { runRepositoryAuditCli } from './lib/repository-audit-cli.mjs';

const result = await runRepositoryAuditCli();
process.exitCode = result.exitCode;
