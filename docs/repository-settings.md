# Required GitHub Repository Settings

Repository files cannot enforce every security control. Apply this checklist after creating the public repository.

## General

- Default branch: `main`.
- Visibility: public for the intended open-source project and free artifact attestations.
- Enable Issues and Discussions.
- Enable automatically deleting head branches after merge.
- Allow squash merge; disable merge commits and rebase merge unless project policy changes.
- Use the repository description: `VS Code language-model bridge for Microsoft 365 Copilot through Microsoft Graph.`
- Add topics: `vscode-extension`, `microsoft-365`, `copilot`, `microsoft-graph`, `typescript`, `devsecops`.

## Ruleset for `main`

Create an active branch ruleset targeting the default branch:

- Restrict deletions.
- Block force pushes.
- Require a pull request before merging.
- Require at least one approval.
- Dismiss stale approvals when new commits are pushed.
- Require review from Code Owners.
- Require conversation resolution.
- Require the branch to be up to date before merging.
- Require linear history.
- Require these status checks after their first successful run:
  - `Quality (Node 22)`
  - `Quality (Node 24)`
  - `Package`
  - `Analyze`
  - `Review dependency changes`
  - `Gitleaks`

  Select the exact check labels shown by GitHub after the workflows have completed once; GitHub may prefix displayed labels with the workflow name.
- Do not allow bypass except for repository administrators during a documented emergency.
- Require signed commits after the maintainer has configured reliable commit signing.

Create a tag ruleset for `v*` that blocks update and deletion after creation.

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
- Code scanning with the committed CodeQL workflow.
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

## Access control

- Require two-factor authentication for collaborators.
- Grant the minimum repository role needed.
- Review collaborators, deploy keys, GitHub Apps, OAuth Apps, and Actions secrets quarterly.
- Avoid classic personal access tokens. Prefer short-lived GitHub tokens and OIDC.
- Keep at least two recovery methods for the owner account.

## Release initialization

Before the first release:

1. Apply branch and tag rulesets.
2. Run all workflows on `main`.
3. Add the required checks to the branch ruleset.
4. Confirm private vulnerability reporting.
5. Create the `release` environment.
6. Create and push a signed `v0.1.0` tag from the protected `main` commit.
7. Verify the generated GitHub release, checksum, SBOM, and attestations.
