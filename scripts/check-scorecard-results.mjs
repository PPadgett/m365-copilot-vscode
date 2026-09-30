import { runScorecardPolicyCli } from './lib/scorecard-policy-cli.mjs';

const result = await runScorecardPolicyCli();
process.exitCode = result.exitCode;
