# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Security fixes on a best-effort basis |
| Older versions | No |

This project is a preview built on a Microsoft Graph beta API. Security support does not make the API or extension suitable for production use.

## Report a vulnerability

[Submit a private report through GitHub Private Vulnerability Reporting](https://github.com/PPadgett/m365-copilot-vscode/security/advisories/new).

Do not open a public issue for a vulnerability, and do not include a real access token, refresh token, proprietary source code, tenant data, or personal information in a report.

Include, when safe:

- Affected version and platform.
- Impact and realistic attack scenario.
- Minimal reproduction using synthetic data.
- Relevant logs with credentials and personal data removed.
- Suggested mitigation, if known.

If the private reporting form is unavailable, open a minimal public issue asking the maintainer to restore the private channel. Do not disclose vulnerability or exploit details in that issue.

## Response targets

Maintainers aim to acknowledge a report within three business days and provide an initial triage assessment within seven business days. These are targets, not service-level guarantees.

## Security boundaries

Especially relevant findings include:

- Token disclosure or insecure secret storage.
- Authentication or delegated-scope validation bypasses.
- Requests sent to an unexpected origin.
- Unbounded prompt, response, or error handling.
- Tool-call parser bypasses or confused-deputy behavior.
- Unexpected workspace data disclosure.
- Release artifact or workflow supply-chain compromise.

## Out of scope

- Vulnerabilities in Microsoft 365 Copilot, Microsoft Graph, VS Code, or GitHub that are not caused by this extension.
- Social engineering, denial-of-service testing against third-party services, or testing without authorization.
- Reports that require exposing real credentials or proprietary data.

## Disclosure

Please allow maintainers a reasonable opportunity to investigate and release a fix before public disclosure. Coordinated advisories and credit are available when appropriate.
