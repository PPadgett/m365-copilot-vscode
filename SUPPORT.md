# Support

This is a community preview with no commercial support or uptime commitment.

## Use the right channel

- **Bug:** open the bug-report form with a minimal synthetic reproduction.
- **Feature or design proposal:** open the feature-request form.
- **Setup question:** open a discussion when Discussions are enabled; otherwise use an issue and choose the closest template.
- **Security vulnerability:** follow [SECURITY.md](SECURITY.md) and report privately.
- **Microsoft tenant, licensing, Graph service, or Entra consent issue:** contact your organization's Microsoft administrator or Microsoft support.

## Information to include

Provide VS Code version, extension version, operating system, authentication mode, expected behavior, actual behavior, and sanitized error text. Never include access tokens, authorization headers, client secrets, tenant-confidential data, or proprietary source code.

## Compatibility

The pipeline tests Node.js 22 and 24 and compiles against the declared VS Code API types. Behavioral changes should also be tested manually in an Extension Development Host. Microsoft Graph beta changes can break the extension independently of a repository release.
