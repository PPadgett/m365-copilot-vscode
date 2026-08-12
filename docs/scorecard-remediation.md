# OpenSSF Scorecard Remediation

This project treats OpenSSF Scorecard as an enforceable control, not only as a dashboard. The Scorecard workflow runs against same-repository pull requests and `main`, then evaluates its SARIF output against the committed policy in `.github/scorecard-policy.json`.

## Finding map

| Scorecard check | Remediation | Enforcement |
| --- | --- | --- |
| Branch-Protection | The desired active ruleset is committed in `.github/rulesets/main.json`. It blocks deletion and force pushes, requires pull requests, approval, CODEOWNERS review, last-push approval, resolved conversations, strict status checks, squash merges, and linear history. | `.github/workflows/repository-policy.yml` audits the live GitHub settings. `scripts/apply-github-ruleset.mjs` applies the specification with a fine-grained administration token. |
| Security-Policy | `SECURITY.md` links directly to GitHub Private Vulnerability Reporting and documents disclosure handling and response targets. | `scripts/check-repo.mjs` requires the private reporting URL and disclosure content. Scorecard must score at least 7. |
| Fuzzing | Security-sensitive parsers and validators have property-based tests using `fast-check`. | `.github/workflows/fuzz.yml` runs generated cases on every pull request, on `main`, and weekly. Scorecard must score 10. |
| Code-Review | Future changes require a human approval, CODEOWNERS review, and approval of the latest push. | Tracked in issue #3. A time-limited waiver expires October 15, 2026; automation cannot substitute for an actual human review history. |
| Maintained | Scorecard intentionally assigns zero to a repository younger than 90 days. | A time-limited waiver expires November 10, 2026, after the repository reaches 90 days on November 9, 2026. |
| CII-Best-Practices | The maintainer must register the project with the OpenSSF Best Practices program and complete its questionnaire accurately. | Tracked in issue #4. A time-limited waiver expires September 30, 2026. |

## Fail-closed policy

The policy evaluator:

- Requires every configured check to remain present in the Scorecard SARIF rule catalog.
- Treats an omitted suboptimal result as score 10 only when that check is still present in the catalog.
- Fails any new low-scoring Scorecard result that has not been reviewed and configured.
- Allows only explicit, documented, expiring waivers.
- Fails repository validation after a waiver expires, even if someone forgets to remove it.
- Publishes a machine-readable `scorecard-policy-report.json` artifact and a job summary.

Fork pull requests cannot run the Scorecard action itself because upstream support is experimental and fork execution is unsupported. They still run the local repository policy, fuzz tests, CodeQL, dependency review, and secret scanning. A same-repository branch or post-merge run performs the complete Scorecard evaluation.

## Apply the GitHub ruleset

The connected automation token used for ordinary repository work does not have GitHub `Administration: write`. A repository administrator must apply the committed settings once with a fine-grained personal access token scoped only to this repository:

```bash
export GITHUB_REPOSITORY="PPadgett/m365-copilot-vscode"
export GH_ADMIN_TOKEN="<fine-grained token with Administration: write>"
npm run ruleset:apply
```

PowerShell:

```powershell
$env:GITHUB_REPOSITORY = "PPadgett/m365-copilot-vscode"
$env:GH_ADMIN_TOKEN = "<fine-grained token with Administration: write>"
npm run ruleset:apply
```

Do not paste the token into an issue, pull request, terminal transcript, source file, or chat. Remove it from the environment after use. The script updates merge settings, enables private vulnerability reporting, and creates or updates the named ruleset. Verify the result with:

```bash
GITHUB_TOKEN="<read token>" npm run repository:audit -- PPadgett/m365-copilot-vscode
```

The `Repository Policy` workflow performs the same read-only drift check on pull requests, pushes to `main`, rules changes, and a weekly schedule.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
FUZZ_RUNS=5000 npm run fuzz
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
node scripts/check-scorecard-sarif.mjs results.sarif
```
