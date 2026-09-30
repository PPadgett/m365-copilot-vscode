# OpenSSF Scorecard Remediation

This project treats OpenSSF Scorecard as an enforceable control, not only as a dashboard. The Scorecard workflow runs against same-repository pull requests and `main`, then evaluates its exact JSON output against the committed policy in `.github/scorecard-policy.json`.

## Finding map

| Scorecard check | Remediation | Enforcement |
| --- | --- | --- |
| Branch-Protection | The desired active ruleset is committed in `.github/rulesets/main.json`. It blocks deletion and force pushes, requires pull requests, approval, CODEOWNERS review, last-push approval, resolved conversations, strict status checks, squash merges, and linear history. | `.github/workflows/repository-policy.yml` audits the live GitHub settings. `scripts/apply-github-ruleset.mjs` applies the specification with a fine-grained administration token or an authenticated GitHub CLI credential. |
| Security-Policy | `SECURITY.md` links directly to GitHub Private Vulnerability Reporting and documents disclosure handling and response targets. | `scripts/check-repo.mjs` parses URL candidates and requires an exact protocol, host, path, query, and fragment match. Malicious prefix and suffix cases are regression-tested. Scorecard must score at least 7. |
| Fuzzing | Security-sensitive parsers and validators have property-based tests using `fast-check`. | `.github/workflows/fuzz.yml` runs generated cases on every pull request and manual request. Scorecard must score 10. |
| SAST | A repository-owned CodeQL job runs without uploading, retains SARIF, and rejects every unsuppressed result. GitHub CodeQL default setup remains enabled independently. | The `SAST` job is included in the stable `Required` CI gate. Scorecard must detect the committed CodeQL workflow and score 10. |
| Code-Review | Future changes require a human approval, CODEOWNERS review, and approval of the latest push. | Tracked in issue #3. A time-limited waiver expires October 15, 2026; automation cannot substitute for an actual human review history. |
| Maintained | Scorecard intentionally assigns zero to a repository younger than 90 days. | A time-limited waiver expires November 10, 2026, after the repository reaches 90 days on November 9, 2026. |
| CII-Best-Practices | The maintainer must register the project with the OpenSSF Best Practices program and complete its questionnaire accurately. | Project [14072](https://www.bestpractices.dev/en/projects/14072/baseline-1) is registered. Public exact Scorecard evidence reports score 2, meeting the unchanged minimum of 2. The obsolete September 30 waiver is removed; this is not a completed assessment attestation. |

The Branch-Protection minimum adopts PR #9’s previously reviewed floor of 8 (up from 6); all other numeric thresholds remain unchanged.

## Context-specific policy profiles

The policy preserves two explicit profiles. Required checks use exact numeric JSON scores; an absent selected check fails unless an active waiver covers it:

- `pull-request`: Security-Policy, Fuzzing, and SAST. These are directly affected by the proposed source and workflow changes.
- `repository`: Branch-Protection, Code-Review, Security-Policy, Fuzzing, SAST, Maintained, and CII-Best-Practices. This profile runs on `main`, manual executions, and repository-rule changes.

Both profiles remain fail closed. A selected check that disappears fails unless it has a documented active waiver, and any newly emitted low-scoring check that is not configured also fails.

## Fail-closed policy

The policy evaluator:

- Requires exact JSON evidence for every selected check. Missing, inconclusive (-1), duplicate, and invalid scores cannot imply a passing score.
- Fails any new low-scoring Scorecard result that has not been reviewed and configured.
- Allows only explicit, documented, expiring waivers.
- Applies an active waiver to an unavailable repository-history check, but never to Security-Policy, Fuzzing, SAST, or Branch-Protection.
- Validates waiver schema locally, including real calendar dates. The exact-evidence gate fails expired waivers only when still needed for a low, absent, or inconclusive score. A passing score remains passing after expiry.
- Publishes a machine-readable `scorecard-policy-report.json` artifact and a job summary.

Fork pull requests cannot run the Scorecard action itself because upstream support is experimental and fork execution is unsupported. They still run the local repository policy, fuzz tests, repository-owned CodeQL, GitHub CodeQL, dependency review, and secret scanning. A same-repository branch or post-merge run performs the complete Scorecard evaluation.

## September 30 review evidence and remaining blockers

The public [Scorecard API](https://api.securityscorecards.dev/projects/github.com/PPadgett/m365-copilot-vscode), retrieved September 30, reports evidence dated September 21, 2026 at 17:00:01 UTC for current main commit `61bc96b192f1ef8b6964481418d3e83d7200bdab` with Scorecard v5.5.0. The committed [snapshot](evidence/scorecard-2026-09-21.json) is historical regression evidence; each workflow must generate its own results.json.

CII-Best-Practices scores **2** (InProgress). The [project API](https://www.bestpractices.dev/en/projects/14072.json) also reports in_progress. This supports removing the obsolete waiver, not claiming that the assessment is complete. Waivers run through 23:59:59.999 UTC on their named date and stop at midnight the next day; no date has been renewed.

The same exact evidence still fails the unchanged fail-on-unconfigured-results control:

| Check | Score | Remaining gap |
| --- | ---: | --- |
| CI-Tests | 5 | Only 4 of 7 merged PRs were detected with CI tests; reviewed history must improve or an owner must separately decide a bounded exception. |
| Contributors | 0 | No contributing companies or organizations were detected; no floor reduction is imported. |
| Packaging | -1 | Scorecard did not detect a supported packaging workflow. This is inconclusive, not proof of no VSIX. |
| Signed-Releases | -1 | The scan reported no releases, despite the release published seconds later. Obtain a new post-release scan before deciding remediation. |

The [v0.1.1 preview release](https://github.com/PPadgett/m365-copilot-vscode/releases/tag/v0.1.1) was published September 21 at 17:00:20 UTC and includes the VSIX, CycloneDX SBOM, checksums, performance report, and Linux smoke report. Existing PR #9's Packaging and Signed-Releases exceptions based on “no official release” are stale and are not imported here. Release provenance/signature sufficiency still needs fresh scanner evidence; release existence alone does not prove it.

The old [run 35629145572](https://github.com/PPadgett/m365-copilot-vscode/actions/runs/35629145572) failed policy enforcement, but its logs return HTTP 410 and artifacts are no longer available. CII is not established as the sole cause. This change reconciles only PR #9's exact-evidence evaluator and load-bearing expiry handling onto current main. Its conflicted repository-audit changes, Administration:read token prerequisite, and fresh independent human review remain separate work. No credentials or repository settings are changed.

The project and existing VSIX do not expire at this waiver deadline. Main's local schema gate previously failed on any retained expired waiver; this fix removes that date-only outage while preserving enforcement against evidence. Until this PR is reviewed and merged by a maintainer, main retains that behavior. No Marketplace publication or live tenant validation is implied.

## Fresh PR scan diagnosis

The [September 30 PR scan](https://github.com/PPadgett/m365-copilot-vscode/actions/runs/36786075585) scans `file://.` with repository commit `unknown`, using the action's local-file mode. The [snapshot](evidence/scorecard-pr21-2026-09-30.json) records License 9 and Packaging -1. Diagnostic `details` are now preserved in policy reports so these warnings remain inspectable without guessing from the short reason.

License 9 is an evidence limitation, not an observed licensing regression. The [pinned License implementation](https://github.com/ossf/scorecard/blob/c395761df6afe1a69e476bc60a013a94bcbc153f/checks/raw/license.go) uses the platform API when available; otherwise it infers an SPDX identifier from the filename and does not inspect license contents. Bare `LICENSE` provides no identifier in that fallback. The [evaluation](https://github.com/ossf/scorecard/blob/c395761df6afe1a69e476bc60a013a94bcbc153f/checks/evaluation/license.go) gives 9 for existence and one additional point for approved-license recognition. GitHub's [repository license API](https://api.github.com/repos/PPadgett/m365-copilot-vscode/license) identifies the unchanged main file as MIT, and main's historical repository scan scores 10. No license bytes, obligations, or filename are changed to manipulate detection.

Packaging -1 is an unsupported workflow-detection case. The [pinned matcher](https://github.com/ossf/scorecard/blob/c395761df6afe1a69e476bc60a013a94bcbc153f/checks/fileparser/github_workflow.go) recognizes specific ecosystem publishing patterns, not this repository's custom VSIX build followed by `gh release create`. The [raw check](https://github.com/ossf/scorecard/blob/c395761df6afe1a69e476bc60a013a94bcbc153f/checks/raw/github/packaging.go) therefore finds no candidate. Main and PR #21 have identical license and release workflow files; main's historical Packaging result is also -1. The actual v0.1.1 GitHub prerelease and successful package/compatibility jobs provide distribution evidence, but are not a numeric Scorecard pass. Marketplace distribution remains a separate product/publication decision.

The policy still fails these results. No floor reduction, waiver, additional publishing action, credential, dummy package publication, or guessed score is introduced. The owner can independently review a CII-only removal on unchanged version-2 policy, then decide whether to pursue upstream local-license/VSIX matcher support or authorize a separately reviewed policy treatment of unsupported evidence. Neither decision is silently implemented in this repair.

PR #21 had no review submissions or inline comments when checked on September 30. Its GitHub security AI job failed before producing findings because its configured model was unavailable; repository-owned SAST and CodeQL passed. Fresh independent human review remains required.

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

The `Repository Policy` workflow performs the same read-only drift check on pull requests, pushes to `main`, rules changes, and manual requests.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
FUZZ_RUNS=5000 npm run fuzz
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
SCORECARD_POLICY_PROFILE=pull-request node scripts/check-scorecard-results.mjs results.json
node scripts/check-codeql-sarif.mjs codeql-results
```
