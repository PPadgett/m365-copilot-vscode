# DevSecOps Pipeline

## Objectives

The pipeline is designed to make every change reviewable, every build repeatable, and every release traceable to protected source. Controls are split between committed automation and repository settings that must be enabled after the GitHub repository exists.

## Control map

| Stage | Controls | Enforcement |
| --- | --- | --- |
| Source | Exact dependency versions, committed lockfile, no runtime npm dependencies, security-focused contribution rules | `package.json`, `package-lock.json`, `CONTRIBUTING.md` |
| Local validation | Repository policy checks, strict TypeScript build, unit tests, coverage thresholds | `npm run verify` |
| Pull request | Node.js 22 and 24 builds, package construction, semantic VSIX validation, reproducibility, dependency audit | `.github/workflows/ci.yml` |
| Static analysis | JavaScript/TypeScript CodeQL with security and quality queries | `.github/workflows/codeql.yml` |
| Dependency governance | Vulnerability and license review for dependency changes; weekly grouped updates | `.github/workflows/dependency-review.yml`, `.github/dependabot.yml` |
| Secret prevention | Full-history Gitleaks scanning plus GitHub secret-scanning push protection | `.github/workflows/secret-scan.yml`, repository settings |
| Supply-chain posture | OpenSSF Scorecard with SARIF upload | `.github/workflows/scorecard.yml` |
| Release | Protected tag, version match, clean rebuild, audit, deterministic VSIX, SBOM, checksums, provenance and SBOM attestations | `.github/workflows/release.yml` |
| Governance | CODEOWNERS, protected branch, required reviews, private vulnerability reporting, release environment | `.github/CODEOWNERS`, community files, repository settings |

## Workflow security baseline

All committed workflows:

- Define least-privilege `GITHUB_TOKEN` permissions.
- Pin every external action to a full commit SHA.
- Disable persisted checkout credentials.
- Set job timeouts.
- Avoid `pull_request_target` and pipe-to-shell installers.
- Cancel superseded non-release runs through concurrency groups.
- Disable npm lifecycle scripts during dependency installation.

The release job is the only workflow job that receives write permissions. It uses GitHub OIDC for artifact attestations and a protected `release` environment rather than a long-lived publishing credential.

## Quality and security gates

A pull request is ready to merge only after these checks pass:

1. Repository policy validation.
2. Strict compilation and unit tests on Node.js 22 and 24.
3. At least 95% line, 90% branch, and 100% function coverage for the security-sensitive pure helper module.
4. High-severity npm audit gate.
5. Deterministic VSIX creation and semantic package validation.
6. CodeQL analysis.
7. Dependency vulnerability and license review.
8. Secret scanning.

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

Automation cannot configure every GitHub security control. Apply the rulesets, Actions policy, security features, release environment, collaborator controls, and private vulnerability reporting described in [Required GitHub Repository Settings](repository-settings.md).

## Deliberate limitations

- There is no deployed server, so traditional DAST and container-image scanning are not applicable.
- Automated Microsoft Graph integration tests are not run in pull requests because they would require a licensed tenant, delegated consent, and live user data. Manual tests must use an approved tenant and synthetic content.
- Visual Studio Marketplace publishing is intentionally excluded until a separate credential, signing, and publisher-governance design is reviewed.
- Microsoft Graph's Copilot conversations API is beta; upstream behavioral changes can break the extension independently of this pipeline.
