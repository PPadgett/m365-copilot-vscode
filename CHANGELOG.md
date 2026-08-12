# Changelog

All notable changes to this project are documented in this file. The project follows [Semantic Versioning](https://semver.org/) while the public extension contract stabilizes.

## [Unreleased]

### Planned

- Evaluate Microsoft Graph streaming through `chatOverStream`.
- Add VS Code integration tests when the provider API can be exercised reliably in an Extension Development Host.
- Evaluate an optional backend for newer Microsoft Work IQ APIs without changing the default licensed Graph route.

## [0.1.0] - 2026-08-11

### Added

- Custom VS Code language-model provider for Microsoft 365 Copilot through Microsoft Graph.
- Microsoft work-account and delegated bearer-token authentication modes.
- Manual JWT audience, expiry, and delegated-scope validation.
- Bounded prompt and Graph response sizes, request timeouts, cancellation, and safe error parsing.
- Opt-in text-protocol tool calls and inline completions.
- Deterministic dependency-free VSIX builder with semantic package validation and reproducibility checks.
- Unit tests with enforced coverage thresholds for security-sensitive parsing and validation helpers.
- CycloneDX SBOM and SHA-256 checksum generation.
- CI, GitHub CodeQL default setup, dependency review, Gitleaks, OpenSSF Scorecard, and release attestation automation.
- Open-source governance, security, support, and contribution documentation.

[Unreleased]: https://github.com/PPadgett/m365-copilot-vscode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/PPadgett/m365-copilot-vscode/releases/tag/v0.1.0
