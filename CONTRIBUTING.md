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

A pull request must pass:

- Repository policy and formatting checks.
- TypeScript strict compilation.
- Unit tests with enforced coverage thresholds.
- Property-based fuzz tests for parsers, validators, and untrusted input boundaries.
- Node.js 22 and 24 CI jobs.
- Deterministic package creation, semantic VSIX validation, and archive validation.
- CodeQL analysis.
- Dependency review.
- Secret scanning.
- OpenSSF Scorecard policy and live repository-settings drift checks.

## Code guidelines

- Keep TypeScript strict and dependency-light.
- Do not add a runtime dependency without explaining the security and maintenance tradeoff.
- Never log access tokens, authorization headers, full JWTs, or secret values.
- Bound untrusted data before parsing or displaying it.
- Keep experimental capabilities opt-in.
- Preserve cancellation and request timeouts for network operations.
- Add unit tests and property-based tests for parsing, validation, and security-boundary changes.
- Keep user-facing error messages actionable without exposing sensitive response data.
- Use two-space indentation, LF line endings, and a final newline.

## Commit and pull-request style

Use an imperative subject that describes the change, for example:

```text
Harden Graph error parsing
Add release provenance attestations
Document tenant consent requirements
```

The pull-request body should explain:

- The problem and intended behavior.
- Security and privacy impact.
- Tests performed.
- Documentation or migration changes.

AI-assisted contributions are welcome. The contributor remains responsible for understanding, testing, licensing, and securing every submitted change.

## Dependency changes

Dependency additions require special scrutiny because extension code runs with the user's VS Code workspace privileges.

A dependency pull request must include:

- Why the dependency is necessary.
- Whether it is shipped at runtime or used only for development.
- License compatibility.
- Maintenance and security posture.
- Alternatives considered.

Exact versions and the lockfile are required. Install scripts remain disabled unless a reviewed exception is documented.

## Testing with Microsoft Graph

Do not commit real tokens, tenant identifiers, proprietary prompts, or response payloads. Use synthetic fixtures in tests. Manual Graph testing must use an approved tenant and test data.

## Documentation

Update the README, changelog, threat model, or architecture document when a change affects users, data flow, permissions, security controls, or release operations.

## Review and merge

Maintainers use squash merging and a protected `main` branch. At least one approving review, resolved conversations, passing required checks, and current-branch status are expected before merge.
