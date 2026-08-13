# Quality Assurance Strategy

This repository applies risk-based QA to a security-sensitive Visual Studio Code extension. The extension has no hosted backend, database, container image, or infrastructure deployment. Its highest-risk boundaries are delegated Microsoft Graph authentication, Graph request construction, untrusted model and workspace data, VS Code tool translation, and the packaged VSIX supply chain.

The strategy therefore maps broad QA categories to controls that are meaningful for this product instead of adding empty pipeline stages that cannot exercise a real target.

## Automated pull-request gates

| QA category | Repository implementation | Evidence and gate |
| --- | --- | --- |
| Syntax and static testing | Strict TypeScript compilation, repository policy validation, dependency-free source/security lint, and actionlint with shellcheck | `Static Quality` and `Workflow Lint` |
| Functional and white-box testing | Unit tests for token validation, Graph response parsing, tool calls, size limits, error sanitization, and configuration behavior | `Tests (Node 22/24)` with JUnit and LCOV artifacts |
| Regression and sanity testing | The complete deterministic test suite runs for every pull request and protected-branch update | Stable `Required` aggregate check |
| Integration testing | Mocked orchestration tests exercise the two-step Microsoft Graph conversation/chat flow without tenant credentials | Integration JUnit and LCOV evidence |
| API and contract testing | Tests assert Graph origin, path, HTTP method, headers, redirect rejection, request schema, response schema, and failure behavior | Integration quality summary |
| Data-driven and fuzz testing | Table-driven boundary cases plus `fast-check` property tests exercise malformed and unexpected input | Required `Fuzz` workflow |
| Security testing | Repository-owned CodeQL, GitHub CodeQL default setup, Gitleaks, dependency review, npm audit, token/URL controls, and Scorecard policy | `SAST`, `CodeQL`, `Gitleaks`, dependency and Scorecard checks |
| Smoke and installation testing | The exact VSIX artifact is safely extracted into a temporary installation layout; its manifest, entry point, and every packaged JavaScript file are validated | `Package` and `Compatibility` |
| Compatibility testing | The same immutable VSIX is tested on Ubuntu, Windows, and macOS rather than rebuilt separately on each platform | Compatibility matrix artifacts |
| Performance and non-functional testing | Generous deterministic budgets guard VSIX size, compiled JavaScript size, and security-sensitive parser performance | Performance JSON and Markdown evidence |
| Supply-chain and deployment testing | Deterministic packaging, ZIP validation, SBOM validation, checksums, provenance, and release attestations validate the distributable | Package and Release workflows |
| Continuous testing / QAOps | Pull-request, protected-branch, scheduled, and manual triggers continuously execute the appropriate risk-based suites | GitHub Actions and protected required checks |
| Shift-left testing and security | The same lint, contract, unit, fuzz, dependency, secret, and SAST controls execute before merge | Branch rules and the `Required` check |

Coverage thresholds are enforced for security-sensitive pure modules: at least 95% lines, 90% branches, and 100% functions. Coverage is not treated as proof of correctness; contract, property, boundary, and mutation tests provide independent evidence that assertions can detect defects.

## Scheduled extended QA

The `Extended QA` workflow performs curated mutation testing against critical security controls. Each mutation intentionally weakens a boundary—such as tool allowlisting, Graph audience validation, token expiry handling, response-size limits, or prototype-pollution protection—and the test suite must fail. The workflow publishes a mutation report and requires a 100% score for the curated mutant set.

Property-based fuzzing also runs on a schedule with a larger generated-case budget than the pull-request path. The ordinary CI workflow runs weekly as an additional regression, compatibility, SAST, packaging, and performance check even when no code is merged.

## Manual and conditional validation

The following checks require a real VS Code Extension Development Host, a licensed Microsoft 365 Copilot tenant, or human judgment and therefore are not executed with repository secrets on untrusted pull requests:

- Exploratory testing of chat, inline completion, cancellation, error messages, and settings behavior.
- User acceptance testing against the intended developer workflows.
- Usability and accessibility review of command titles, settings descriptions, notifications, and keyboard-driven operation.
- Live Microsoft Graph integration testing with synthetic, non-sensitive content in an approved tenant.
- Compatibility testing against VS Code Insiders or a newly released stable VS Code version before a public release.
- Localization and internationalization review if localized user-facing strings are introduced.

Manual release evidence must identify the VSIX digest tested. Production or company source code must not be used as test data unless the organization has explicitly approved that data flow.

## Not currently applicable

The following categories are intentionally not represented as automated gates because this repository does not deploy a network service or infrastructure:

- Dynamic application security testing against a deployed web endpoint.
- Infrastructure smoke tests, Infrastructure as Code validation, container scanning, and configuration drift tests.
- Load, stress, soak, spike, scalability, chaos, disaster-recovery, and blue-green/canary deployment tests.
- Browser matrix, mobile-device, and A/B testing.

These controls become applicable if the project adds a hosted proxy, service, container, infrastructure templates, web user interface, or production deployment. Such a change requires an updated threat model, environment strategy, DAST target, operational monitoring, rollback plan, and protected deployment environments before merge.

## Quality evidence and retention

Every pull request publishes machine-readable JUnit, LCOV, CodeQL SARIF, performance, smoke, SBOM, checksum, and platform-compatibility evidence. Test and build evidence is retained long enough to diagnose a pull request or release without relying solely on transient log text. Tagged releases additionally publish signed GitHub attestations that bind the released VSIX and SBOM to the protected source revision.

A failure in an evidence-generation step fails closed. Missing reports, missing archive contents, malformed results, new unconfigured Scorecard findings, and skipped required jobs cannot produce a green `Required` status.
