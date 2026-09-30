// Legacy command fails closed: SARIF omission is not exact score evidence.
console.error('SARIF is advisory only. Use scripts/check-scorecard-results.mjs with exact Scorecard JSON.');
process.exitCode = 1;
