# Threat Model

## Scope

This threat model covers the VS Code extension, its GitHub repository, build workflows, and distributed VSIX artifacts. It does not cover vulnerabilities inside Microsoft 365 Copilot, Microsoft Graph, Microsoft Entra, VS Code, or the user's operating system except where this project can reduce exposure.

## Assets

- Delegated Microsoft Graph access tokens.
- Proprietary source code and workspace context.
- User prompts, tool output, and Microsoft 365 response content.
- Repository source, branch protections, and release integrity.
- Maintainer and GitHub Actions credentials.
- User trust in distributed VSIX files.

## Trust boundaries

1. User and VS Code UI to extension host.
2. Workspace files and tool output to prompt serialization.
3. Extension host to Microsoft Graph over HTTPS.
4. Microsoft Graph response to parser and VS Code renderer.
5. Model-generated tool request to VS Code tool execution.
6. Contributor pull request to protected default branch.
7. GitHub Actions runner to release artifact and attestation stores.

## Primary threats and controls

### Token disclosure

**Threat:** A token is logged, written to workspace settings, included in an exception, or committed to the repository.

**Controls:**

- Manual tokens use VS Code `SecretStorage`.
- Password-mode input hides pasted content.
- Tokens are never logged or interpolated into user-visible errors.
- Manual JWT structure, size, audience, expiration, and scopes are validated before storage; Microsoft Graph performs authoritative signature validation.
- Gitleaks and GitHub secret scanning inspect repository changes.
- Documentation prohibits real secrets in issues and tests.

**Residual risk:** A compromised extension host, operating system, or malicious installed extension can access data available to the current user.

### Excessive data disclosure

**Threat:** Chat or completion requests send more source code, file-path information, or binary data than expected.

**Controls:**

- The extension is disabled in untrusted workspaces.
- Inline completion is opt-in and bounded.
- Absolute file paths are omitted from inline prompts.
- Binary chat parts are represented only by MIME type.
- A configurable maximum prompt size fails closed.
- Web grounding is disabled by default.
- The README requires organizational approval before use on proprietary repositories.

**Residual risk:** VS Code chat participants and tools may intentionally add broad workspace context to a request. Users must review the UI and organizational policy.

### Prompt injection and unsafe tools

**Threat:** Repository content or a model response persuades the agent to invoke a destructive or unrelated tool.

**Controls:**

- Tool calling is disabled by default.
- Tool markup must occupy the complete response.
- JSON input must be a plain object under a size limit.
- Tool names must be present in the VS Code-provided allowlist.
- The system prompt labels file and tool content as untrusted data.
- VS Code remains the execution and confirmation boundary.

**Residual risk:** A valid allowed tool can still be used unsafely. The bridge cannot guarantee model intent or prevent every semantic prompt-injection attack.

### Network redirection or endpoint substitution

**Threat:** Tokens or prompts are sent to an attacker-controlled origin.

**Controls:**

- The Graph origin is a source-code constant.
- User configuration cannot override the endpoint.
- Fetch redirects are rejected.
- HTTPS is required.
- Manual tokens must target the Microsoft Graph audience.

**Residual risk:** Host compromise, malicious certificate authorities, or Microsoft service compromise are outside the extension boundary.

### Unbounded or malicious service responses

**Threat:** Large, malformed, or control-character-heavy responses cause resource exhaustion or unsafe error display.

**Controls:**

- Request timeout and cancellation.
- A fixed 5 MiB limit is enforced while reading response streams.
- Structured JSON validation.
- Bounded and sanitized error details.
- Completion length limits.
- Tool-call payload size limits.

**Residual risk:** The current `/chat` response is still buffered after enforcing the byte limit. Future streaming support should preserve the same bounded-reader control.

### Dependency and build compromise

**Threat:** A compromised npm package or mutable GitHub Action alters the extension or release.

**Controls:**

- No runtime npm dependencies.
- Exact development dependency versions and committed lockfile.
- npm lifecycle scripts disabled.
- Every workflow action is pinned to a full commit SHA.
- Dependabot monitors npm and Actions references.
- Dependency review blocks vulnerable additions.
- CodeQL, Gitleaks, and OpenSSF Scorecard run continuously.
- Release artifacts have checksums, SBOMs, and GitHub attestations.

**Residual risk:** Compromise of GitHub-hosted runners, GitHub's control plane, the TypeScript package, or the VS Code packaging specification remains possible.

### Malicious contribution or maintainer account takeover

**Threat:** An attacker merges code, changes workflows, bypasses checks, or publishes a malicious release.

**Controls:**

- Protected `main` ruleset with pull requests, reviews, CODEOWNERS, current-branch checks, and no force pushes.
- Least-privilege `GITHUB_TOKEN` permissions.
- Release environment and tag-version verification.
- No long-lived release secret is required for GitHub releases.
- Recommended two-factor authentication and signed maintainer commits.

**Residual risk:** Repository settings must be applied after repository creation; files alone cannot enforce them.

## Security assumptions

- The user intentionally installs the extension and trusts the repository release.
- The user has authorization to use the Microsoft tenant and workspace data.
- VS Code's authentication provider and SecretStorage operate as documented.
- Microsoft Graph validates delegated permissions and license entitlement.
- GitHub repository security settings are configured according to `docs/repository-settings.md`.

## Review triggers

Update this threat model when changing authentication, scopes, endpoint hosts, prompt serialization, tool calling, inline completion, dependencies, release workflows, or artifact formats.
