# Required GitHub Repository Settings

Repository files define the expected controls, while GitHub enforces them. The read-only `Repository Policy` workflow fails whenever the live repository drifts from `.github/repository-policy.json` or `.github/rulesets/main.json`.

## Apply the committed settings

A repository administrator can apply the merge settings, private vulnerability reporting, automatic Copilot code review, and the `Protect main` ruleset with a fine-grained token scoped only to this repository and granted **Administration: write**:

```bash
export GITHUB_REPOSITORY="PPadgett/m365-copilot-vscode"
export GH_ADMIN_TOKEN="<fine-grained administration token>"
npm run ruleset:apply
unset GH_ADMIN_TOKEN
```

Review the exact payload first without making changes:

```bash
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
```

Never commit, paste, or log the token. The ordinary `GITHUB_TOKEN` intentionally cannot administer repository rules.

## General repository settings

The committed policy requires:

- Default branch: `main`.
- Squash merging enabled.
- Merge commits disabled.
- Rebase merging disabled.
- Automatic deletion of merged head branches enabled.
- The **Update branch** option enabled.
- Private vulnerability reporting enabled.

Recommended presentation settings:

- Visibility: public for the intended open-source project and free artifact attestations.
- Enable Issues and Discussions.
- Description: `VS Code language-model bridge for Microsoft 365 Copilot through Microsoft Graph.`
- Topics: `vscode-extension`, `microsoft-365`, `copilot`, `microsoft-graph`, `typescript`, `devsecops`.

## `Protect main` ruleset

The active ruleset targets the default branch and has no bypass actors. It:

- Restricts deletion.
- Blocks force pushes.
- Requires linear history.
- Requires a pull request before merging.
- Allows only squash merging.
- Requires at least one approval.
- Dismisses stale approvals after new commits.
- Requires review from Code Owners.
- Requires approval of the most recent reviewable push.
- Requires all review conversations to be resolved.
- Automatically requests one GitHub Copilot review when an eligible pull request becomes open.
- Does not spend additional review credits on draft pull requests or every new push by default.
- Requires the branch to be up to date.
- Requires these stable checks:
  - `Required`
  - `Fuzz`
  - `Repository Policy`
  - `Scorecard Policy`
  - `CodeQL`
  - `Gitleaks`
  - `Review dependency changes`

The aggregate `Required` check represents both Node.js quality jobs, repository-owned SAST, and deterministic package construction. Individual matrix labels can change as the matrix evolves without requiring a ruleset edit.

A tag ruleset for `v*` that blocks updates and deletion remains recommended before the first public release.

## GitHub Copilot code review

Automatic review is configured by the `copilot_code_review` rule in `.github/rulesets/main.json`. Repository-specific review guidance is committed in `.github/copilot-instructions.md`.

Copilot code review requires the pull-request author to have access to a Copilot plan that includes code review and available usage. A public repository by itself does not grant that entitlement. Verified maintainers of popular open-source repositories may qualify for Copilot Pro at no charge through GitHub's open-source maintainer benefit.

The default configuration is cost-conscious:

- Review when a pull request is first opened or first marked ready for review.
- Do not review draft pull requests.
- Do not automatically re-review every push.

A maintainer can request a manual re-review after significant updates. Each review can consume Copilot AI credits and GitHub Actions runner usage. Public repositories generally receive free GitHub Actions usage, but that does not remove the Copilot plan or AI-credit requirement.

Copilot always submits advisory comments. It does not approve a pull request, does not satisfy the required human approval, and must not be treated as a security sign-off.

## Actions

Under **Settings → Actions → General**:

- Set workflow permissions to **Read repository contents permission** by default.
- Disable creating and approving pull requests by `GITHUB_TOKEN` unless a future reviewed workflow requires it.
- Allow GitHub-authored actions and only the reviewed third-party actions used here:
  - `gitleaks/gitleaks-action`
  - `ossf/scorecard-action`
- Require actions to be pinned to a full-length commit SHA.
- Do not permit unreviewed reusable workflows from external repositories.

Create a protected environment named `release`:

- Restrict deployment branches and tags to protected tags matching `v*`.
- Require maintainer approval when the repository has more than one trusted maintainer.
- Do not store a Marketplace token until a separate publishing design is reviewed.

## Security and analysis

Enable:

- Dependency graph.
- Dependabot alerts.
- Dependabot security updates.
- Grouped Dependabot version updates from `.github/dependabot.yml`.
- Code scanning with GitHub CodeQL default setup. Keep default setup enabled unless a reviewed pull request replaces it with an advanced configuration; GitHub does not process both configurations simultaneously.
- Secret scanning.
- Secret scanning push protection.
- Validity checks for detected secrets when available.
- Private vulnerability reporting.
- Security advisories.

Review and close false positives rather than disabling scanners globally.

## Community

Confirm that the repository community profile recognizes:

- README
- LICENSE
- CODE_OF_CONDUCT
- CONTRIBUTING
- SECURITY
- SUPPORT
- Issue forms
- Pull-request template

Enable Discussions with categories such as **Q&A**, **Ideas**, and **Announcements**.

## Access control and review

- Add at least one trusted human reviewer so approvals are independent of the author.
- Require two-factor authentication for collaborators.
- Grant the minimum repository role needed.
- Review collaborators, deploy keys, GitHub Apps, OAuth Apps, and Actions secrets quarterly.
- Avoid classic personal access tokens. Prefer short-lived GitHub tokens and OIDC.
- Keep at least two recovery methods for the owner account.

Human review is tracked in issue #3. CI, Copilot, and other automated reviewers do not count as an independent approval for the OpenSSF Code-Review check.

## Verify live settings

For a complete audit, use a fine-grained token scoped only to this repository with **Administration: read**:

```bash
GITHUB_TOKEN="<fine-grained administration-read token>" npm run repository:audit -- PPadgett/m365-copilot-vscode
```

Never commit or log the token. The automatic workflow uses the ordinary read-only `GITHUB_TOKEN`. That token can verify the default branch, private vulnerability reporting, effective branch rules, automatic Copilot review, and repository ruleset, but GitHub may omit administrator-only merge-setting fields. Omitted fields are reported as visibility warnings rather than false drift failures; a real rule or ruleset mismatch still fails the job.

The audit runs automatically on pull requests, pushes to `main`, branch-protection changes, and a weekly schedule.

## Release initialization

Before the first release:

1. Apply and verify the branch ruleset.
2. Confirm the intended Copilot entitlement before relying on automatic advisory reviews.
3. Add a trusted human reviewer and obtain approval on release changes.
4. Run all workflows on `main`.
5. Confirm private vulnerability reporting and secret push protection.
6. Create the `release` environment.
7. Create the protected `v*` tag ruleset.
8. Create and push a signed `v0.1.0` tag from the protected `main` commit.
9. Verify the generated GitHub release, checksum, SBOM, and attestations.
