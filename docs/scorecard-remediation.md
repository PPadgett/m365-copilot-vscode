# OpenSSF Scorecard Remediation

This project treats OpenSSF Scorecard as an enforceable control, not only as a dashboard. The Scorecard workflow runs against same-repository pull requests and `main`, then evaluates its SARIF output against the committed policy in `.github/scorecard-policy.json`.

## Finding map

| Scorecard check | Remediation | Enforcement |
| --- | --- | --- |
| Branch-Protection | The desired active ruleset is committed in `.github/rulesets/main.json`. It blocks deletion and force pushes, requires pull requests, approval, CODEOWNERS review, last-push approval, resolved conversations, strict status checks, squash merges, and linear history. | `.github/workflows/repository-policy.yml` audits the live GitHub settings. `scripts/apply-github-ruleset.mjs` applies the specification with a fine-grained administration token or an authenticated GitHub CLI credential. |
| Security-Policy | `SECURITY.md` links directly to GitHub Private Vulnerability Reporting and documents disclosure handling and response targets. | `scripts/check-repo.mjs` parses URL candidates and requires an exact protocol, host, path, query, and fragment match. Malicious prefix and suffix cases are regression-tested. Scorecard must score at least 7. |
| Fuzzing | Security-sensitive parsers and validators have property-based tests using `fast-check`. | `.github/workflows/fuzz.yml` runs generated cases on every pull request, on `main`, and weekly. Scorecard must score 10. |
| SAST | A repository-owned CodeQL job runs without uploading, retains SARIF, and rejects every unsuppressed result. GitHub CodeQL default setup remains enabled independently. | The `SAST` job is included in the stable `Required` CI gate. Scorecard must detect the committed CodeQL workflow and score 10. |
| Code-Review | Future changes require a human approval, CODEOWNERS review, and approval of the latest push. | Tracked in issue #3. A time-limited waiver expires October 15, 2026; automation cannot substitute for an actual human review history. |
| Maintained | Scorecard intentionally assigns zero to a repository younger than 90 days. | A time-limited waiver expires November 10, 2026, after the repository reaches 90 days on November 9, 2026. |
| CII-Best-Practices | The maintainer must register the project with the OpenSSF Best Practices program and complete its questionnaire accurately. | Project [14072](https://www.bestpractices.dev/en/projects/14072/baseline-1) is in progress. Exact public Scorecard evidence scores CII 2, meeting the unchanged minimum of 2. The obsolete September 30 waiver is removed. |

## CII-only deadline repair

Public [Scorecard evidence](https://api.securityscorecards.dev/projects/github.com/PPadgett/m365-copilot-vscode), retrieved September 30, 2026, is dated September 21 at 17:00:01 UTC and identifies current main commit `61bc96b192f1ef8b6964481418d3e83d7200bdab`. It reports CII-Best-Practices 2 (InProgress), which meets the committed minimum of 2. Project registration is not a completed assessment attestation.

This repair removes only that obsolete waiver before October 1 00:00 UTC. Policy version 2, all score thresholds, profiles, validator behavior, other waiver dates, permissions, licensing, and release workflows remain unchanged. Tests cover both sides of midnight and reject CII regression or an absent catalog entry. PR #21's exact-JSON/expiry improvements and PR #9's conflicted repository-audit/Administration:read prerequisite remain separate reviews.

The project and its [v0.1.1 preview VSIX](https://github.com/PPadgett/m365-copilot-vscode/releases/tag/v0.1.1) do not expire at this deadline. This change does not establish Marketplace or live tenant readiness.

## Context-specific policy profiles

Scorecard does not expose every repository-history check in a pull-request SARIF run. Treating an unavailable check as a code regression creates a permanently failing gate, so the policy defines two explicit profiles:

- `pull-request`: Security-Policy, Fuzzing, and SAST. These are directly affected by the proposed source and workflow changes.
- `repository`: Branch-Protection, Code-Review, Security-Policy, Fuzzing, SAST, Maintained, and CII-Best-Practices. This profile runs on `main`, scheduled executions, and repository-rule changes.

Both profiles remain fail closed. A selected check that disappears fails unless it has a documented active waiver, and any newly emitted low-scoring check that is not configured also fails.

## Fail-closed policy

The policy evaluator:

- Requires every check selected by the active profile to remain present in the Scorecard SARIF rule catalog.
- Treats an omitted suboptimal result as score 10 only when that check is still present in the catalog.
- Fails any new low-scoring Scorecard result that has not been reviewed and configured.
- Allows only explicit, documented, expiring waivers.
- Applies an active waiver to an unavailable repository-history check, but never to Security-Policy, Fuzzing, SAST, or Branch-Protection.
- Fails repository validation after a waiver expires, even if someone forgets to remove it.
- Publishes a machine-readable `scorecard-policy-report.json` artifact and a job summary.

Fork pull requests cannot run the Scorecard action itself because upstream support is experimental and fork execution is unsupported. They still run the local repository policy, fuzz tests, repository-owned CodeQL, GitHub CodeQL, dependency review, and secret scanning. A same-repository branch or post-merge run performs the complete Scorecard evaluation.

## Apply the GitHub ruleset

The default workflow token intentionally cannot administer repository settings. A repository administrator can use the GitHub CLI browser login to acquire a local credential and run:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes repo
$env:GH_ADMIN_TOKEN = gh auth token --hostname github.com
node .\scripts\apply-github-ruleset.mjs PPadgett/m365-copilot-vscode
$env:GITHUB_TOKEN = $env:GH_ADMIN_TOKEN
node .\scripts\audit-github-rules.mjs PPadgett/m365-copilot-vscode
Remove-Item Env:GH_ADMIN_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
```

A fine-grained personal access token limited to this repository with `Administration: write` is the fallback when the GitHub CLI OAuth credential is not accepted. Never paste a credential into an issue, pull request, terminal transcript, source file, or chat.

The `Repository Policy` workflow performs the same read-only drift check on pull requests, pushes to `main`, rules changes, and a weekly schedule.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
FUZZ_RUNS=5000 npm run fuzz
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
SCORECARD_POLICY_PROFILE=pull-request node scripts/check-scorecard-sarif.mjs results.sarif
node scripts/check-codeql-sarif.mjs codeql-results
```
