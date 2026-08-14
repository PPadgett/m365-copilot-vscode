# OpenSSF Scorecard Remediation

This project treats OpenSSF Scorecard as an enforceable control, not only as a dashboard. The required policy gate uses the exact JSON result from one Scorecard execution. SARIF is retained only for GitHub code-scanning visibility and is not a policy input.

## Finding map

| Scorecard check | Remediation | Enforcement |
| --- | --- | --- |
| Branch-Protection | The desired active ruleset is committed in `.github/rulesets/main.json`. It blocks deletion and force pushes, requires pull requests, approval, CODEOWNERS review, last-push approval, resolved conversations, strict status checks, squash merges, and linear history. | `.github/workflows/repository-policy.yml` audits the effective live rules and the repository-owned ruleset. The accepted policy floor is 8 while the project has two maintainers. |
| Security-Policy | `SECURITY.md` links directly to GitHub Private Vulnerability Reporting and documents disclosure handling and response targets. | `scripts/check-repo.mjs` requires an exact parsed URL. Scorecard must score at least 7. |
| Fuzzing | Security-sensitive parsers and validators have property-based tests using `fast-check`. | `.github/workflows/fuzz.yml` runs on pull requests, `main`, and a schedule. Scorecard must score 10. |
| SAST | A repository-owned CodeQL job retains SARIF and rejects every unsuppressed result. GitHub CodeQL default setup remains enabled independently. | The `SAST` job is included in the stable `Required` CI gate. Scorecard must score 10. |
| Dangerous-Workflow | Workflows prohibit `pull_request_target`, pipe-to-shell installers, unpinned actions, and excessive token permissions. | The pull-request Scorecard profile explicitly requires a score of 10. |
| Code-Review | Changes require a human approval, CODEOWNERS review, latest-push approval, and resolved conversations. | Tracked in issue #3. A time-limited waiver expires October 15, 2026 while approved history accumulates. |
| Maintained | Scorecard intentionally assigns zero to a repository younger than 90 days. | A time-limited waiver expires November 10, 2026. |
| CII-Best-Practices | The project is registered with the OpenSSF Best Practices program and must complete the questionnaire accurately. | Tracked in issue #4. A time-limited waiver expires September 30, 2026 while the badge and evidence PR is completed. |

## One execution, two uses

The workflow performs exactly one Scorecard analysis per event:

- Pull requests request JSON directly and evaluate it against the pull-request profile.
- Repository runs request SARIF for GitHub code scanning and enable Scorecard publication. The pinned action also formats the same in-memory result as `results.json`; the policy gate evaluates that JSON.

This avoids comparing two live scans that can observe different repository state. It also prevents the policy from depending on Scorecard's SARIF thresholds, annotations, or emission rules.

## Context-specific profiles

The policy defines two explicit profiles:

- `pull-request` enforces the local checks available during a same-repository pull request: binary artifacts, dependency updates, license, pinned dependencies, security policy, token permissions, dangerous workflows, vulnerabilities, SAST, and fuzzing.
- `repository` adds branch protection, CI tests, code-review history, maintenance history, and OpenSSF Best Practices status.

Known checks that are not appropriate for a profile remain explicitly configured and are reported as `profile-excluded`. A genuinely new check that is not configured fails when its exact score is below the default minimum or is inconclusive.

## Fail-closed policy

The evaluator:

- Requires valid exact JSON with Scorecard version, Scorecard commit, and a non-empty checks array.
- Requires every selected check to be present; a waiver cannot hide missing or malformed evidence.
- Uses exact numeric scores only.
- Applies documented, expiring waivers to below-threshold or inconclusive selected checks.
- Fails expired waivers.
- Fails new unconfigured low-scoring or inconclusive checks.
- Reports configured but profile-excluded checks without silently enforcing them in the wrong context.
- Publishes `scorecard-policy-report.json` with deterministic ordering and source metadata.

SARIF is advisory. Its presence, absence, threshold, or annotation behavior cannot make the required policy gate pass or fail.

## Repository policy audit

`scripts/audit-github-rules.mjs` uses Node's built-in Fetch API and `GITHUB_API_URL`. It rejects redirects, verifies the returned repository identity, and aggregates effective rules from all applicable organization and repository rulesets.

Effective rules are combined conservatively:

- Approval counts use the maximum requirement.
- Boolean pull-request protections use logical OR.
- Allowed merge methods use intersection.
- Required status checks use union.
- The repository-owned `Protect main` ruleset is also checked separately so inherited rules cannot conceal local drift.

No GitHub CLI installation is required for the read-only audit.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
FUZZ_RUNS=5000 npm run fuzz
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
npm run scorecard:check -- \
  results.json \
  .github/scorecard-policy.json \
  scorecard-policy-report.json \
  pull-request
GITHUB_TOKEN="<read-token>" \
GITHUB_API_URL="https://api.github.com" \
  npm run repository:audit -- PPadgett/m365-copilot-vscode
node scripts/check-codeql-sarif.mjs codeql-results
```

Never commit or log a token. A fine-grained administration token is required only for applying repository settings, not for the ordinary read-only audit.
