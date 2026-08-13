# DevSecOps Pipeline

## Objectives

The pipeline is designed to make every change reviewable, every build repeatable, every quality claim evidenced, and every release traceable to protected source. Controls are split between committed automation and repository settings that must be enabled after the GitHub repository exists.

## Control map

| Stage | Controls | Enforcement |
| --- | --- | --- |
| Source | Exact dependency versions, committed lockfile, no runtime npm dependencies, security-focused contribution rules | `package.json`, `package-lock.json`, `CONTRIBUTING.md` |
| Local validation | Repository and QA policy checks, source/security lint, strict TypeScript build, unit and mocked integration tests, coverage thresholds, property-based fuzz tests, SARIF policy regression tests | `npm run verify`, `npm run fuzz`, `npm run sast:check` |
| Workflow validation | GitHub Actions syntax, expression, dependency, runner, cron, and embedded shell checks | `Workflow Lint` with pinned actionlint and shellcheck |
| Pull request | Node.js 22 and 24 test evidence, repository-owned CodeQL, deterministic package construction, performance budgets, compatibility smoke matrix, dependency audit, stable aggregate check, and advisory Copilot review when the author is eligible | `.github/workflows/ci.yml`, `.github/rulesets/main.json`, `.github/copilot-instructions.md` |
| Static analysis | A repository-owned CodeQL run retains SARIF and fails on every unsuppressed finding; GitHub CodeQL default setup independently uploads and tracks alerts | `.github/workflows/ci.yml`, GitHub code-scanning settings |
| Dependency governance | Moderate-or-higher vulnerability gate, license review for dependency changes, and weekly grouped updates | `.github/workflows/ci.yml`, `.github/workflows/dependency-review.yml`, `.github/dependabot.yml` |
| Secret prevention | Full-history Gitleaks scanning plus GitHub secret-scanning push protection | `.github/workflows/secret-scan.yml`, repository settings |
| Supply-chain posture | OpenSSF Scorecard with SARIF upload, event-specific policy profiles, explicit score thresholds, fail-closed evaluation, and expiring waivers | `.github/workflows/scorecard.yml`, `.github/scorecard-policy.json` |
| Extended QA | Scheduled curated mutation testing verifies that critical test assertions detect weakened security controls | `.github/workflows/extended-qa.yml` |
| Release | Protected tag, version match, clean rebuild, full QA, deterministic VSIX, SBOM, checksums, provenance and SBOM attestations | `.github/workflows/release.yml` |
| Governance | CODEOWNERS, protected branch, required human reviews, cost-conscious automatic Copilot review, private vulnerability reporting, release environment, and live settings drift audit | `.github/CODEOWNERS`, `.github/copilot-instructions.md`, `.github/rulesets/main.json`, `.github/workflows/repository-policy.yml` |

## Workflow security baseline

All committed workflows:

- Define least-privilege `GITHUB_TOKEN` permissions.
- Pin every external action to a full commit SHA.
- Disable persisted checkout credentials.
- Set job timeouts.
- Avoid `pull_request_target` and pipe-to-shell installers.
- Cancel superseded non-release runs through concurrency groups.
- Disable npm lifecycle scripts during dependency installation.
- Cache only package-manager downloads, never generated build output or credentials.
- Publish bounded, non-secret QA evidence with explicit retention periods.

The release job is the only workflow job with `contents: write`. The Scorecard publisher has narrowly scoped `security-events: write` and `id-token: write` permissions for SARIF publication and authenticated Scorecard results. Repository-owned CodeQL uses `upload: never`, so it does not conflict with GitHub CodeQL default setup. Release attestation uses GitHub OIDC and a protected `release` environment rather than a long-lived publishing credential.

## Quality and security gates

A pull request is ready to merge only after these checks pass:

1. GitHub Actions and embedded shell linting.
2. Repository, documentation, and advanced QA policy validation.
3. Dependency-free source/security lint and strict TypeScript compilation.
4. Unit, functional, regression, and activation smoke tests on Node.js 22 and 24.
5. Mocked Microsoft Graph integration and API contract tests on Node.js 22 and 24.
6. At least 95% line, 90% branch, and 100% function coverage for security-sensitive pure modules.
7. A moderate-or-higher npm vulnerability gate.
8. Property-based fuzzing for untrusted-input parsers and validators.
9. Deterministic VSIX creation, semantic package validation, ZIP integrity, and reproducibility.
10. Performance and artifact-size budgets with machine-readable evidence.
11. Installation-layout and packaged-JavaScript smoke tests against the exact artifact.
12. Compatibility smoke testing of that same artifact on Ubuntu, Windows, and macOS.
13. Repository-owned CodeQL analysis with zero unsuppressed findings; its result is included in the stable `Required` gate.
14. GitHub CodeQL default setup as an independent hosted safety net.
15. Dependency vulnerability and license review.
16. Secret scanning.
17. OpenSSF Scorecard policy evaluation using the pull-request profile.
18. Live GitHub repository settings and branch-rules drift audit.
19. Independent human approval and resolved review conversations.

JUnit, LCOV, SARIF, performance, compatibility, SBOM, and checksum evidence is uploaded even when the producing job fails where practical. The stable `Required` context fails when any required matrix or upstream job fails, is cancelled, or is skipped.

When the pull-request author has a plan that includes Copilot code review and available usage, the ruleset requests one advisory Copilot review when the pull request becomes open. Draft reviews and automatic re-review on every push are disabled to conserve AI credits. A maintainer can request a manual re-review after significant updates.

Copilot review comments are not a required status check and cannot satisfy the independent human approval. This keeps availability, quota, and billing state from becoming a merge dependency.

## Advanced QA architecture

The pull-request pipeline separates workflow linting, static quality, executable tests, SAST, packaging, and artifact compatibility so each control produces independent evidence and a clear failure domain. Unit and integration suites publish JUnit and LCOV files instead of relying only on console output.

The package job builds one VSIX. Compatibility jobs download that immutable artifact rather than rebuilding it separately, safely stage its installation layout, verify its manifest and entry point, and syntax-check every packaged JavaScript file on Linux, Windows, and macOS.

Mocked Graph integration tests validate the two-step conversation/chat contract without placing tenant credentials in pull-request workflows. Live tenant testing remains a controlled manual release activity. Curated mutation testing runs on a schedule because it evaluates test-suite effectiveness rather than product behavior and is intentionally more expensive than the per-commit path.

See [Quality Assurance Strategy](qa-strategy.md) for the complete applicability map and evidence model.

## Release evidence

Each tagged release publishes:

- A VSIX containing only reviewed runtime files.
- JUnit/LCOV-backed release quality results in workflow evidence.
- Performance and packaged-extension smoke reports.
- A CycloneDX 1.6 SBOM.
- A `SHA256SUMS` manifest covering release evidence.
- GitHub build-provenance attestation for the VSIX.
- GitHub SBOM attestation binding the CycloneDX document to the VSIX.
- Generated release notes derived from merged pull requests.

The release workflow refuses tags that do not match `package.json` and never silently replaces an existing tagged artifact.

## Manual repository controls

Automation cannot configure every GitHub security control with the default workflow token. Apply the committed ruleset once with the administration-scoped helper, then let the read-only workflow detect drift. See [Required GitHub Repository Settings](repository-settings.md) and [OpenSSF Scorecard Remediation](scorecard-remediation.md).

## Deliberate limitations

- There is no deployed server, so traditional DAST, infrastructure smoke testing, container scanning, chaos engineering, and load/stress testing are not applicable.
- Automated live Microsoft Graph tests are not run in pull requests because they require a licensed tenant, delegated consent, and live user data. Mocked contract tests run automatically; manual live tests must use an approved tenant and synthetic content.
- The artifact compatibility matrix validates installation layout and packaged runtime syntax; it does not replace manual Extension Development Host behavior testing.
- Copilot code review depends on the author's Copilot entitlement and available AI credits. Public repository status alone does not provide code-review access.
- Automated review cannot replace independent human approval or security ownership.
- Visual Studio Marketplace publishing is intentionally excluded until a separate credential, signing, and publisher-governance design is reviewed.
- Microsoft Graph's Copilot conversations API is beta; upstream behavioral changes can break the extension independently of this pipeline.
