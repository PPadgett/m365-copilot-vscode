# Required GitHub Repository Settings

Repository files define the expected controls, while GitHub enforces them. The `Repository Policy` workflow fails whenever the live repository drifts from `.github/repository-policy.json` or `.github/rulesets/main.json`, or when required administrator-visible evidence cannot be read.

## Apply the committed settings

A repository administrator can apply merge settings, private vulnerability reporting, automatic Copilot review, and the `Protect main` ruleset with a fine-grained token scoped to this repository and granted **Administration: write**:

```bash
export GITHUB_REPOSITORY="PPadgett/m365-copilot-vscode"
export GH_ADMIN_TOKEN="<fine-grained administration token>"
npm run ruleset:apply
unset GH_ADMIN_TOKEN
```

Review the exact payload first:

```bash
npm run ruleset:apply -- --dry-run PPadgett/m365-copilot-vscode
```

Never commit, paste, or log the token. The ordinary `GITHUB_TOKEN` intentionally cannot administer repository rules.

## General repository settings

The committed policy requires:

- Default branch `main`.
- Squash merging enabled; merge commits and rebase merging disabled.
- Automatic deletion of merged branches.
- The **Update branch** option enabled.
- Private vulnerability reporting enabled.

Recommended presentation settings:

- Public visibility.
- Issues and Discussions enabled.
- Description: `VS Code language-model bridge for Microsoft 365 Copilot through Microsoft Graph.`
- Topics: `vscode-extension`, `microsoft-365`, `copilot`, `microsoft-graph`, `typescript`, `devsecops`.

## `Protect main` ruleset

The active ruleset targets the default branch and has no bypass actors. It:

- Blocks deletion and force pushes.
- Requires linear history and a pull request.
- Allows only squash merging.
- Requires one independent approval, CODEOWNERS review, latest-push approval, stale-review dismissal, and resolved conversations.
- Automatically requests one advisory Copilot review for eligible new pull requests.
- Requires the branch to be current and requires these stable checks:
  - `Required`
  - `Fuzz`
  - `Repository Policy`
  - `Scorecard Policy`
  - `CodeQL`
  - `Gitleaks`
  - `Review dependency changes`

The one-approval rule is intentional for the current two-maintainer project. The accepted Branch-Protection Scorecard floor is 8; the project will not create a merge deadlock merely to optimize the external score.

## Audit the live settings

The audit uses Node.js Fetch rather than GitHub CLI. It honors the same API-base contract as the apply script:

```bash
export GITHUB_API_URL="https://api.github.com"
export GITHUB_TOKEN="<fine-grained administration-read token>"
npm run repository:audit -- PPadgett/m365-copilot-vscode
unset GITHUB_TOKEN
```

`GITHUB_API_URL` may point to a GitHub Enterprise API base such as `https://github.example/api/v3`. The audit rejects redirects, bounds every API request, verifies that GitHub returned the requested repository identity, and fails when any required setting or ruleset field is hidden, absent, malformed, or different from policy.

The effective branch-rules endpoint can return more than one rule of the same type because organization and repository rulesets are cumulative. The audit aggregates those rules instead of treating duplicates as malformed. It then checks the repository-owned `Protect main` ruleset separately.

### Actions credential for fail-closed evidence

The ordinary workflow `GITHUB_TOKEN` cannot read all administrator-only repository and ruleset fields. Configure this repository Actions secret:

```text
REPOSITORY_POLICY_TOKEN
```

Use a fine-grained personal access token with:

```text
Resource owner: PPadgett
Repository access: m365-copilot-vscode only
Repository permission: Administration — Read-only
```

Do not grant write permissions or access to other repositories. The workflow places this credential only in the live audit step, masks it in logs, and rejects a missing credential before contacting GitHub. Rotate it before expiration and immediately after suspected disclosure.

A same-repository pull request receives the full fail-closed audit. GitHub withholds repository secrets from fork pull requests, so the privileged audit job is skipped for forks; local policy checks, the remaining required CI checks, CODEOWNERS review, and the trusted `main`/scheduled audits still apply.

The audit no longer treats inaccessible administrator evidence as a warning. Missing merge settings, private-vulnerability-reporting state, ruleset rules, or bypass actors are policy failures.

## GitHub Copilot code review

Automatic review is configured by `.github/rulesets/main.json`, with guidance in `.github/copilot-instructions.md`.

- Review when a pull request is opened or first marked ready.
- Do not review drafts.
- Do not automatically re-review every push.
- Copilot comments are advisory and never satisfy the human approval requirement.

## Actions and security settings

Under **Settings → Actions → General**:

- Default workflow permissions to read-only.
- Do not allow `GITHUB_TOKEN` to approve pull requests unless a reviewed workflow needs it.
- Permit only reviewed GitHub-authored and third-party actions.
- Require full-length commit SHA pins.

Enable dependency graph, Dependabot alerts and updates, CodeQL default setup, secret scanning, push protection, private vulnerability reporting, and security advisories.

Create a protected `release` environment and a `v*` tag ruleset before the first public release.

## Community and access control

Keep README, license, Code of Conduct, contributing, security, support, issue forms, and pull-request template current. Require two-factor authentication for collaborators, grant the minimum role needed, and review collaborators, GitHub Apps, OAuth Apps, deploy keys, and Actions secrets quarterly.

## Release initialization

Before `v0.1.0`:

1. Merge all security remediations through reviewed pull requests.
2. Confirm all workflows pass on `main`.
3. Create the protected `release` environment and `v*` tag ruleset.
4. Create and push a signed tag from protected `main`.
5. Verify the release VSIX, checksum, SBOM, and provenance attestations.
