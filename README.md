# Microsoft 365 Copilot Graph Provider for VS Code

[![CI](https://github.com/PPadgett/m365-copilot-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/PPadgett/m365-copilot-vscode/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/PPadgett/m365-copilot-vscode/badge)](https://scorecard.dev/viewer/?uri=github.com/PPadgett/m365-copilot-vscode)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A preview Visual Studio Code extension that exposes the Microsoft 365 Copilot Chat API as a custom language-model provider through Microsoft Graph.

> [!IMPORTANT]
> This community project is not affiliated with, endorsed by, or supported by Microsoft, GitHub, or OpenAI. It is not GitHub Copilot. The Microsoft Graph endpoint used by this project is under `/beta`, can change without notice, and is not intended for production use under Microsoft's beta API terms.

## Why this exists

A company can host source code in Bitbucket while licensing Microsoft 365 Copilot for employees. This extension explores a bridge between those systems:

```text
VS Code Chat or inline completion
            |
            v
This extension
            |
            | Delegated Microsoft Entra access token
            v
Microsoft Graph /beta/copilot/conversations
            |
            v
Microsoft 365 Copilot
```

The repository location does not need to be GitHub. GitHub is used only to develop and distribute this open-source extension.

## Features

- Registers **Microsoft 365 Copilot (Graph)** in the VS Code language-model picker.
- Uses VS Code's Microsoft work-account authentication when tenant policy permits it.
- Supports a delegated Microsoft Graph bearer-token fallback stored in VS Code `SecretStorage`.
- Validates manually supplied JWT structure, audience, expiration, and required delegated scopes before storing it.
- Sends chat requests through the Microsoft Graph Copilot conversations API.
- Disables web grounding by default.
- Disables experimental tool calling and inline completions by default.
- Applies request timeouts, a configurable prompt-size boundary, and a fixed 5 MiB response-body limit.
- Sends no project telemetry and has no runtime npm dependencies.

## Requirements

- Visual Studio Code 1.131 or newer.
- A Microsoft work or school account.
- A Microsoft 365 Copilot entitlement that can use the Copilot Chat API.
- Tenant consent for these delegated Microsoft Graph permissions:
  - `Sites.Read.All`
  - `Mail.Read`
  - `People.Read.All`
  - `OnlineMeetingTranscript.Read.All`
  - `Chat.Read`
  - `ChannelMessage.Read.All`
  - `ExternalItem.Read.All`

A Microsoft Entra administrator may need to approve the permissions. Application-only authentication is not supported by this API path.

## Install a release

1. Download the `.vsix` and `SHA256SUMS` files from the matching GitHub release.
2. Verify the checksum.
3. Install the extension:

```bash
code --install-extension m365-copilot-graph-provider-0.1.0.vsix
```

You can also use **Extensions: Install from VSIX...** in the VS Code Command Palette.

Release builds include a CycloneDX SBOM and GitHub artifact attestations. See [Release verification](docs/releasing.md#verify-a-release).

## Authenticate

### Recommended: Microsoft work account

1. Open the Command Palette.
2. Run **M365 Copilot: Sign in with Microsoft**.
3. Sign in with the licensed work account.
4. Complete tenant consent when allowed.
5. Run **M365 Copilot: Test Connection**.

VS Code manages the access-token lifecycle. The extension never receives or stores your password.

### Fallback: delegated bearer token

1. Run **M365 Copilot: Set Graph Bearer Token**.
2. Paste a delegated Microsoft Graph access token with all required scopes.
3. Run **M365 Copilot: Test Connection**.

The extension decodes the token locally to check its structure, Microsoft Graph audience, expiration, and delegated scopes. This preflight check does **not** cryptographically verify the JWT signature; Microsoft Graph performs authoritative token validation when the request is sent. A token that passes preflight is stored in VS Code `SecretStorage`, not `settings.json`. Bearer tokens expire and must be replaced manually.

Do not paste a refresh token, client secret, personal access token, or application-only token.

## Use the model

1. Open Chat in VS Code.
2. Open the model picker or run **Chat: Manage Language Models**.
3. Select **Microsoft 365 Copilot (Graph)** and then **Microsoft 365 Copilot**.
4. Ask a coding question.

The extension serializes the VS Code chat history into a text prompt and sends it to Microsoft Graph. Binary message parts are not uploaded by this bridge.

## Security defaults

The defaults intentionally favor explicit use and data minimization:

```json
{
  "m365Copilot.authMode": "microsoft",
  "m365Copilot.webGrounding": false,
  "m365Copilot.enableToolCalling": false,
  "m365Copilot.inlineCompletions": false,
  "m365Copilot.maxPromptChars": 200000,
  "m365Copilot.requestTimeoutSeconds": 120
}
```

The extension is disabled in untrusted workspaces. It does not send telemetry to this project's maintainers.

> [!CAUTION]
> Chat prompts can contain proprietary source code, terminal output, and other workspace context. Confirm that your organization's policy permits sending that material to Microsoft 365 Copilot through Microsoft Graph before enabling this extension on company repositories.

## Experimental tool calling

Enable only after reviewing the risks:

```json
{
  "m365Copilot.enableToolCalling": true
}
```

The Graph API returns text, not native VS Code tool calls. The extension therefore asks the model to emit one strict tag:

```text
<vscode_tool_call>{"name":"TOOL_NAME","input":{}}</vscode_tool_call>
```

The bridge rejects mixed prose, malformed JSON, non-object input, unknown tool names, prototype-pollution keys, excessive nesting, and oversized payloads before creating a VS Code tool-call part. This compatibility protocol does not eliminate prompt-injection or unsafe-action risk. Keep VS Code tool confirmation controls enabled and review proposed changes.

## Experimental inline completions

Enable:

```json
{
  "m365Copilot.inlineCompletions": true
}
```

Only nearby text and the file's base name are included in an inline-completion prompt; the absolute file path is not sent. The endpoint is a chat API rather than a low-latency completion API, so suggestions can be slower and less predictable than a dedicated completion service.

## Develop locally

```bash
npm ci --ignore-scripts
npm run verify
npm run package
npm run validate:vsix
npm run reproducible
npm run sbom
npm run validate:sbom
npm run checksums
```

Open the repository in VS Code and press **F5** to start an Extension Development Host.

The project deliberately has no runtime npm dependencies. The repository uses exact development dependency versions and a committed lockfile.

## Project documentation

- [Architecture](docs/architecture.md)
- [DevSecOps pipeline](docs/devsecops.md)
- [Threat model](docs/threat-model.md)
- [Release and verification guide](docs/releasing.md)
- [Required GitHub repository settings](docs/repository-settings.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)
- [Contributing guide](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)

## Current limitations

- Microsoft Graph marks the Copilot conversations API as beta.
- Responses are buffered because the initial implementation uses `/chat`, not `/chatOverStream`.
- The API does not expose a native VS Code tool protocol.
- Token counts and model limits are estimates because the underlying model metadata is not exposed.
- A new Graph conversation is created for each model request; the serialized VS Code transcript provides conversational context.
- Authentication and consent behavior depends on Microsoft Entra tenant policy.
- No Visual Studio Marketplace publisher or automatic Marketplace deployment is configured yet. Releases publish checksummed and attested VSIX artifacts on GitHub.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Report security vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
