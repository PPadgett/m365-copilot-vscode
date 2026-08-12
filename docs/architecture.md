# Architecture

## Overview

The extension is a thin translation and authentication layer between the VS Code Language Model API and the Microsoft 365 Copilot Chat API exposed through Microsoft Graph.

```text
+------------------------------+
| VS Code                      |
|                              |
| Chat / Agent / Inline UI     |
+---------------+--------------+
                |
                | VS Code language-model request
                v
+---------------+--------------+
| Extension host               |
|                              |
| M365CopilotProvider          |
| M365InlineCompletionProvider |
| AuthManager                  |
| GraphCopilotClient           |
+---------------+--------------+
                |
                | HTTPS + delegated Entra token
                v
+---------------+--------------+
| Microsoft Graph /beta        |
| copilot/conversations        |
+---------------+--------------+
                |
                v
+------------------------------+
| Microsoft 365 Copilot        |
+------------------------------+
```

## Components

### `AuthManager`

- Uses the VS Code `microsoft` authentication provider for interactive work-account sign-in.
- Requests the delegated Microsoft Graph scopes required by the Copilot Chat API.
- Supports a manual bearer-token fallback in VS Code `SecretStorage`.
- Validates manual JWT structure, size, audience, expiration, and delegated scopes before storage and reuse.
- Never logs a token.

### `GraphCopilotClient`

- Uses a fixed `https://graph.microsoft.com/beta` origin.
- Creates a Graph Copilot conversation and sends one chat request.
- Applies cancellation, a bounded timeout, a prompt-size limit, a fixed 5 MiB response-body limit, no-store headers, and redirect rejection.
- Parses bounded Graph errors and returns the latest non-empty response message.
- Creates a new Graph conversation for each model request. The VS Code provider serializes prior chat messages into the prompt.

### `M365CopilotProvider`

- Registers one custom model with VS Code.
- Serializes text, tool-call, and tool-result chat parts into a plain-text transcript.
- Omits binary payload content.
- Reports a buffered text response.
- Optionally translates one strict text tag into a VS Code tool-call response after validating the tool name and JSON input.

### `M365InlineCompletionProvider`

- Runs only when explicitly enabled.
- Sends bounded prefix and suffix context around the cursor.
- Includes only the file's base name, not its absolute path.
- Rejects empty or oversized completions.
- Suppresses repetitive network-error popups; users can run the explicit connection test for diagnostics.

### `core.ts`

Contains pure, unit-tested helpers for:

- Completion cleanup.
- Tool-call parsing.
- Copilot response extraction.
- Graph error formatting.
- Delegated JWT inspection.
- IANA time-zone validation.

## Authentication flow

```text
User invokes model
      |
      v
Auth mode?
  | Microsoft                 | Bearer
  v                           v
VS Code microsoft session     SecretStorage token
  |                           |
  +-------------+-------------+
                |
                v
Authorization: Bearer <access token>
                |
                v
Microsoft Graph
```

The API requires delegated user permissions. The extension does not support client secrets, certificates, managed identities, or application-only tokens.

## Tool-call compatibility protocol

Tool calling is disabled by default because Microsoft Graph returns text rather than native VS Code tool-call objects.

When enabled, the provider supplies available tool metadata and requires this exact response shape:

```text
<vscode_tool_call>{"name":"TOOL_NAME","input":{}}</vscode_tool_call>
```

The parser is anchored to the entire response, limits payload size and nesting, rejects prototype-pollution keys, requires a plain JSON object, and verifies the name against the tools VS Code supplied for the turn. VS Code remains responsible for tool execution and user confirmation.

## Packaging

The repository has no runtime npm dependencies. A deterministic Node.js script creates a VSIX using the standard ZIP container, an extension manifest, and only these runtime files:

- `package.json`
- `dist/**/*.js`
- `README.md`
- `CHANGELOG.md`
- `LICENSE`

Release builds also produce a CycloneDX SBOM, SHA-256 checksums, build provenance, and an SBOM attestation.

## Design principles

- Fixed network destination.
- Delegated identity, never app credentials.
- Explicit opt-in for experimental or high-frequency data flows.
- No project telemetry.
- No runtime dependency supply chain.
- Bounded untrusted input and output.
- Least-privilege CI permissions and immutable action references.
- Transparent beta status and organizational-policy warnings.
