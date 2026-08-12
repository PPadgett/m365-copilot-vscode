# DevSecOps Pipeline

## Objectives

The pipeline is designed to make every change reviewable, every build repeatable, and every release traceable to protected source. Controls are split between committed automation and repository settings that must be enabled after the GitHub repository exists.

## Control map

| Stage | Controls | Enforcement |
| --- | --- | --- |
| Source | Exact dependency versions, committed lockfile, no runtime npm dependencies, security-focused contribution rules | `package.json`, `package-lock.json`, `CONTRIBUTING.md` |
| Local validation | Repository policy checks, strict TypeScript build, unit tests, coverage thresholds, property-based fuzz tests | `npm run verify`, `npm run fuzz` |
| Pull request | Node.js 22 and 24 builds, package construction, semantic VSIX validation, reproducibility, dependency audit, stable aggregate check | `.github/workflows/ci.yml` |
| Static analysis | JavaScript/TypeScript CodeQL default setup with GitHub-managed query and tool updates | GitHub code-scanning settings |
| Dependency governance | Vulnerability and license review for dependency changes; weekly grouped updates | `.github/workflows/dependency-review.yml`, `.github/dependabot.yml` |
| Secret prevention | Full-history Gitleaks scanning plus GitHub secret-scanning push protection | `.github/workflows/secret-scan.yml`, repository settings |
| Supply-chain posture | OpenSSF Scorecard with SARIF upload, explicit score thresholds, fail-closed policy, and expiring waivers | `.github/workflows/scorecard.yml`, `.github/scorecard-policy.json` |
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

The release job is the only workflow job with `contents: write`. The Scorecard publisher has narrowly scoped `security-events: write` and `id-token: write` permissions for SARIF publication and authenticated Scorecard results. Release attestation uses GitHub OIDC and a protected `release` environment rather than a long-lived publishing credential.

## Quality and security gates

A pull request is ready to merge only after these checks pass:

1. Repository policy validation.
2. Strict compilation and unit tests on Node.js 22 and 24.
3. At least 95% line, 90% branch, and 100% function coverage for the security-sensitive pure helper module.
4. High-severity npm audit gate.
5. Property-based fuzzing for untrusted-input parsers and validators.
6. Deterministic VSIX creation and semantic package validation.
7. CodeQL analysis.
8. Dependency vulnerability and license review.
9. Secret scanning.
10. OpenSSF Scorecard policy evaluation.
11. Live GitHub repository settings and branch-rules drift audit.

The exact required-check labels should be selected in the branch ruleset only after each workflow has completed successfully once.

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
