# CI evidence maintenance and historical validation

The CII deadline is resolved by merged PR #22 (`8088b9da985e755f5b661f8db9119d7bbd69096d`). The current CI-Tests finding is separate: the [read-only October 1 snapshot](evidence/ci-evidence-health-2026-10-01.json) reproduces qualifying results on five of eight merged PR heads. PRs 1, 2 and 5 have no currently qualifying result; their remaining CodeQL checks use the `github-advanced-security` app, which the pinned Scorecard CI probe does not count. Missing history does not prove that tests never ran, or why data disappeared.

## Verified retention and proposed owner decision

On October 1, 2026, the read-only endpoint `GET /repos/PPadgett/m365-copilot-vscode/actions/permissions/artifact-and-log-retention` returned **days: 3, maximum_allowed_days: 90**. No live setting was changed. The inspected source does not contain an automated run-deletion script.

GitHub's [retention announcement](https://github.blog/changelog/2026-08-27-actions-retention-will-cover-checks-workflow-runs-and-statuses/) says that from October 1 the repository setting also governs checks, workflow runs and commit statuses. Previously evicted evidence is not restored by increasing retention. This verified three-day setting creates a durability risk; it does not establish the cause of the older missing evidence.

Recommend a separately approved **90-day repository retention** with the existing **three-day artifact overrides**. The public-repository cap is 90 days. Check/run/status metadata is not billed for storage, while artifacts and logs are; raising the repository setting also extends log retention and may increase storage cost. Artifact overrides keep uploaded test bundles short-lived but do not independently extend commit metadata. No live configuration API mutation is included in this change.

Even 90 days is bounded. A slow-moving Scorecard sample can still include merged PR heads older than retained evidence. The health check detects such gaps; it cannot promise a permanent score of 10. Previously lost checks cannot be restored or backdated. If a new old head outside this allowlist needs testing, it requires a new reviewed allowlist change.

## Routine automation

`evidence-health.yml` performs read-only inspection once a week, after relevant CI-control changes on main, or on a manual request. It gathers merged heads associated with the latest 30 main commits and applies the [pinned Scorecard CI app/context rules](https://github.com/ossf/scorecard/blob/c395761df6afe1a69e476bc60a013a94bcbc153f/probes/testsRunInCI/impl.go). This is a diagnostic approximation; the Scorecard run remains authoritative and may use a different sample.

Healthy runs succeed quietly. Missing qualifying evidence fails the job with actionable PR numbers/SHAs in its summary and a compact three-day report. There are no issue, email, Slack, or comment writes. Existing GitHub workflow-notification preferences govern delivery. API failures fail rather than invent evidence. Retention may be invisible to a read-only workflow token; the summary says so rather than adding administrator access.

The health workflow never runs historical code or posts statuses. It does not repeatedly retest unchanged old commits on every normal push. Once historical evidence is published, the planner skips those heads while qualifying evidence remains available. The weekly check supplies the low-frequency reminder if it later disappears.

## Genuine historical execution

`historical-ci.yml` is manual-only, restricted to main and these reviewed heads:

| PR | Exact original head SHA |
| --- | --- |
| 1 | `c2e711bbbd3f4fd51ce62ecce1ce1ffe35f82272` |
| 2 | `99ceaf674dd9ca7e5dd58d8d8e54aa78f49c41b7` |
| 5 | `f70b9856cd4227e1eb08c926224f3ace58a5b126` |

The planner revalidates merged PR/repository identity. It skips existing qualifying evidence by default; `retest` explicitly requests another run. Each selected head gets a fresh Ubuntu runner, verified exact checkout, Node 22, its committed lockfile installed using `npm ci --ignore-scripts`, and its original `npm test` (which performs its real build and tests). Historic code is not rewritten, cherry-picked onto current main, or given credit for current main's tests. Historical tests may fail today because of old code, API/type versions, or dependency availability. Failure remains failure.

Historical jobs have contents-read only, no secrets, no OIDC, no persisted checkout credentials and no shared writable cache. Their npm cache is confined to that disposable runner. They execute no status-writing code. They do not run current date-sensitive repository waiver validation as a substitute for their historical unit tests.

## Optional trusted reporter and approval boundary

The `publish_statuses` input defaults to **false**. The reporter runs only after explicit manual opt-in on main, on the first run attempt, after the entire selected historical matrix succeeds. It uses a separate fresh runner and only the trusted current workflow revision; it never checks out historical source, consumes historical artifacts, installs historical dependencies, or executes historical code.

Before any status POST, the reporter checks GitHub's run identity, repository, workflow path, SHA, run URL, job identities and conclusions, plus successful exact-checkout, locked-install and actual-test steps for every selected target. Failure, cancellation, skip, incomplete/duplicate/mismatched evidence or rerun produces no success batch. GitHub assigns the real creation date; no date field is submitted. Each status links the actual current run and explicitly describes retrospective tests, not original PR-time validation.

Only the reporter has `statuses: write`, alongside contents/actions read. GitHub's token permission itself is repository-wide; the trusted code limits writes to three immutable allowlisted SHAs and one `historical-tests/retrospective` context. No persistent token is created. Partial API failure can leave a subset of truthful successes posted, but never credits an untested or failing head. A new first-attempt dispatch skips already qualifying heads and can complete the remainder.

**This PR prepares the capability; it does not approve or execute status publication.** After review/merge, the minimum owner steps are:

1. Separately approve the repository retention setting, if accepting the 90-day recommendation; authorized maintenance can then apply it.
2. Specifically approve one genuine retrospective run with `publish_statuses=true` on the reviewed main revision. Routine test selection, SHA verification and truthful reporting then need no per-commit chores. A false-input run can test without posting statuses.

No workflow was dispatched, no status was posted, no setting was changed and no historical test success is claimed while preparing this PR. PR #21's exact-JSON policy work and PR #9's conflicted repository-audit/Administration-read credential prerequisite remain separate. No threshold is lowered, waiver added, dummy PR created, license obligation changed, tenant operation performed, or Marketplace release published.
