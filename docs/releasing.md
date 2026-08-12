# Releasing

## Release policy

Releases are created from protected `main` by pushing a version tag. The release workflow builds from source, runs all checks, creates a deterministic VSIX, generates a CycloneDX SBOM and checksums, creates GitHub provenance and SBOM attestations, and publishes a GitHub release.

No Visual Studio Marketplace credential is used in the initial release design.

## Prepare a release

1. Update `package.json` using Semantic Versioning.
2. Update `CHANGELOG.md` and move relevant entries out of **Unreleased**.
3. Run locally:

```bash
npm ci --ignore-scripts
npm run verify
npm run package
npm run validate:vsix
npm run reproducible
npm run sbom
npm run validate:sbom
npm run checksums
unzip -t artifacts/*.vsix
```

4. Open and merge a release pull request through the protected branch.
5. From the resulting `main` commit, create a signed tag matching the package version:

```bash
git switch main
git pull --ff-only
git tag -s v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

The workflow fails when the tag and `package.json` version do not match.

## Release workflow security

- Uses a protected `release` environment.
- Uses no long-lived release credential.
- Grants write permissions only to the release job.
- Pins every action to a full commit SHA.
- Rebuilds from a clean checkout with npm lifecycle scripts disabled.
- Semantically validates the VSIX and proves a second build has the same SHA-256 digest.
- Attests the VSIX with GitHub OIDC and Sigstore-backed artifact attestations.
- Attaches the CycloneDX SBOM to the VSIX as an SBOM attestation.

## Verify a release

### Check SHA-256

On Linux:

```bash
sha256sum --check SHA256SUMS
```

On macOS:

```bash
shasum -a 256 --check SHA256SUMS
```

On PowerShell:

```powershell
Get-FileHash .\m365-copilot-graph-provider-0.1.0.vsix -Algorithm SHA256
Get-Content .\SHA256SUMS
```

### Verify GitHub provenance

With GitHub CLI:

```bash
gh attestation verify m365-copilot-graph-provider-0.1.0.vsix \
  --repo PPadgett/m365-copilot-vscode
```

For the SBOM attestation, use the predicate type shown by `gh attestation verify --help` for the current CycloneDX predicate implementation.

### Inspect the VSIX

A VSIX is a ZIP archive:

```bash
unzip -t m365-copilot-graph-provider-0.1.0.vsix
unzip -l m365-copilot-graph-provider-0.1.0.vsix
```

Expected runtime content is limited to the extension manifest, package metadata, compiled JavaScript, README, changelog, and license.

## Emergency response

For a compromised release:

1. Revoke affected credentials and sessions.
2. Disable the release workflow if needed.
3. Publish a GitHub security advisory.
4. Remove or mark the release as compromised while preserving forensic evidence.
5. Rotate maintainer credentials and review repository audit logs.
6. Fix the root cause through the protected branch.
7. Publish a new version; never silently replace an existing tagged artifact.
