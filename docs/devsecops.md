# DevSecOps Pipeline

## Objectives

The pipeline is designed to make every change reviewable, every build repeatable, and every release traceable to protected source. Controls are split between committed automation and repository settings that must be enabled after the GitHub repository exists.

## Control map

| Stage | Controls | Enforcement |
| --- | --- | --- |
| Source | Exact dependency versions, committed lockfile, no runtime npm dependencies, security-focused contribution rules | `package.json`, `package-lock.json`, `CONTRIBUTING.md` |
| Local validation | Repository policy checks, strict TypeScript build, unit tests, coverage thresholds, property-based fuzz tests, SARIF policy regression tests | `npm run verify`, `npm run fuzz`, `npm run sast:check` |
| Pull request | Node.js 22 and 24 builds, repository-owned CodeQL, package construction, semantic VSIX validation, reproducibility, dependency audit, stable aggregate check | `.github/workflows/ci.yml` |
| Static analysis | A repository-owned CodeQL run retains SARIF and fails on every unsuppressed finding; GitHub CodeQL default setup independently uploads and tracks alerts | `.github/workflows/ci.yml`, GitHub code-scanning settings |
| Dependency governance | Vulnerability and license review for dependency changes; weekly grouped updates | `.github/workflows/dependency-review.yml`, `.github/dependabot.yml` |
| Secret prevention | Full-history Gitleaks scanning plus GitHub secret-scanning push protection | `.github/workflows/secret-scan.yml`, repository settings |
| Supply-chain posture | OpenSSF Scorecard with SARIF upload, event-specific policy profiles, explicit score thresholds, fail-closed evaluation, and expiring waivers | `.github/workflows/scorecard.yml`, `.github/scorecard-policy.json` |
| Release | Protected tag, version match, clean rebuild, audit, deterministic VSIX, SBOM, checksums, provenance and SBOM attestations | `.github/workflows/release.yml` |
| Governance | CODEOWNERS, protected branch, required reviews, private vulnerability reporting, release environment, live settings drift audit | `.github/CODEOWNERS`, `.github/rulesets/main.json`, `.github/workflows/repository-policy.yml` |

## Workflow security baseline

All committed workflows:

- Define least-privilege `GITHUB_TOKEN` permissions.
- Pin every external action to a full commit SHA.
- Disable persisted checkout credentials.
- Set job timeouts.
- Avoid `pull_request_target` and pipe-to-shell installers.
- Cancel superseded non-release runs through concurrency groups.
- Disable npm lifecycle scripts during dependency installation.

The release job is the only workflow job with `contents: write`. The Scorecard publisher has narrowly scoped `security-events: write` and `id-token: write` permissions for SARIF publication and authenticated Scorecard results. Repository-owned CodeQL uses `upload: never`, so it does not conflict with GitHub CodeQL default setup and does not require `security-events: write`. Release attestation uses GitHub OIDC and a protected `release` environment rather than a long-lived publishing credential.

## Quality and security gates

A pull request is ready to merge only after these checks pass:

1. Repository policy validation.
2. Strict compilation and unit tests on Node.js 22 and 24.
3. At least 95% line, 90% branch, and 100% function coverage for the security-sensitive pure helper module.
4. High-severity npm audit gate.
5. Property-based fuzzing for untrusted-input parsers and validators.
6. Deterministic VSIX creation and semantic package validation.
7. Repository-owned CodeQL analysis with zero unsuppressed findings; its result is included in the stable `Required` gate.
8. GitHub CodeQL default setup as an independent hosted safety net.
9. Dependency vulnerability and license review.
10. Secret scanning.
11. OpenSSF Scorecard policy evaluation using the pull-request profile.
12. Live GitHub repository settings and branch-rules drift audit.

The branch ruleset requires stable aggregate checks rather than brittle matrix labels. The `Required` context represents both Node.js quality jobs, package construction, and repository-owned SAST.

## Release evidence

Each tagged release publishes:

- A VSIX containing only reviewed runtime files.
- A CycloneDX 1.6 SBOM.
- A `SHA256SUMS` manifest.
- GitHub build-provenance attestation for the VSIX.
- GitHub SBOM attestation binding the CycloneDX document to the VSIX.
- Generated release notes derived from merged pull requests.

The release workflow refuses tags that do not match `package.json` and never silently replaces an existing tagged artifact.

## Manual repository controls

Automation cannot configure every GitHub security control with the default workflow token. Apply the committed ruleset once with the administration-scoped helper, then let the read-only workflow detect drift. See [Required GitHub Repository Settings](repository-settings.md) and [OpenSSF Scorecard Remediation](scorecard-remediation.md).

## Deliberate limitations

- There is no deployed server, so traditional DAST and container-image scanning are not applicable.
- Automated Microsoft Graph integration tests are not run in pull requests because they would require a licensed tenant, delegated consent, and live user data. Manual tests must use an approved tenant and synthetic content.
- Visual Studio Marketplace publishing is intentionally excluded until a separate credential, signing, and publisher-governance design is reviewed.
- Microsoft Graph's Copilot conversations API is beta; upstream behavioral changes can break the extension independently of this pipeline.
