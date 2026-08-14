# Contributing

Thank you for helping improve the Microsoft 365 Copilot Graph Provider for VS Code.

## Before you start

- Search existing issues and pull requests.
- Use a feature request for behavioral or architectural proposals.
- Use private vulnerability reporting for security defects; do not open a public security issue.
- Keep changes focused. Large redesigns should start with an issue.

## Development setup

Requirements:

- Node.js 22 or newer.
- npm 10 or newer.
- Visual Studio Code 1.131 or newer for manual extension testing.

```bash
git clone https://github.com/PPadgett/m365-copilot-vscode.git
cd m365-copilot-vscode
npm ci --ignore-scripts
npm run verify
```

Press **F5** in VS Code to launch the Extension Development Host.

## Quality gates

Before opening a pull request, run:

```bash
npm run verify
FUZZ_RUNS=5000 npm run fuzz
npm run package
npm run validate:vsix
npm run reproducible
npm run sbom
npm run validate:sbom
npm run checksums
unzip -t artifacts/*.vsix
```

To evaluate saved OpenSSF exact JSON evidence locally:

```bash
npm run scorecard:check -- \
  results.json \
  .github/scorecard-policy.json \
  scorecard-policy-report.json \
  pull-request
```

To audit live GitHub settings, provide a read token through the environment. GitHub CLI is not required:

```bash
GITHUB_API_URL="https://api.github.com" \
GITHUB_TOKEN="<read-token>" \
  npm run repository:audit -- PPadgett/m365-copilot-vscode
```

A pull request must pass repository policy, strict TypeScript compilation, unit and integration tests, coverage thresholds, fuzzing, Node.js 22 and 24 jobs, deterministic packaging, CodeQL, dependency review, secret scanning, and OpenSSF Scorecard policy.

## Code guidelines

- Keep TypeScript strict and dependency-light.
- Do not add a runtime dependency without explaining the security and maintenance tradeoff.
- Never log tokens, authorization headers, full JWTs, cookies, or secret values.
- Bound untrusted data before parsing or displaying it.
- Keep experimental capabilities opt-in.
- Preserve cancellation and request timeouts for network operations.
- Add unit, regression, property-based, and contract tests for security-boundary changes.
- Keep user-facing errors actionable without exposing sensitive response data.
- Use two-space indentation, LF line endings, and a final newline.

## Commit and pull-request style

Use an imperative subject such as:

```text
Harden Graph error parsing
Add release provenance attestations
Document tenant consent requirements
```

The pull-request body should explain the problem, intended behavior, security and privacy impact, tests performed, and documentation or migration changes.

AI-assisted contributions are welcome. The contributor remains responsible for understanding, testing, licensing, and securing every submitted change.

## Dependency changes

Dependency additions require special scrutiny because extension code runs with the user's workspace privileges. Explain necessity, runtime versus development use, license compatibility, maintenance posture, and alternatives. Exact versions and the lockfile are required. Install scripts remain disabled unless a reviewed exception is documented.

## Testing with Microsoft Graph

Do not commit real tokens, tenant identifiers, proprietary prompts, or response payloads. Use synthetic fixtures. Manual Graph testing must use an approved tenant and test data.

## Documentation

Update the README, changelog, threat model, architecture, or operating documentation when a change affects users, data flow, permissions, security controls, CI evidence, or release operations.

## Review and merge

Maintainers use squash merging and protected `main`. At least one independent approval, resolved conversations, passing required checks, and a current branch are required before merge. Automated reviewers are advisory and do not replace human approval.
