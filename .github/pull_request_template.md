## Summary

Describe the problem and the change.

## Security and privacy impact

Explain changes to authentication, scopes, network destinations, prompt context, tool execution, dependencies, logs, or release behavior. Write `None` only after reviewing those areas.

## Validation

- [ ] `npm run verify`
- [ ] `FUZZ_RUNS=5000 npm run fuzz`
- [ ] `npm run package`
- [ ] `npm run validate:vsix`
- [ ] `npm run reproducible`
- [ ] `npm run sbom`
- [ ] `npm run validate:sbom`
- [ ] `npm run checksums`
- [ ] Scorecard or repository-policy changes were evaluated against the committed policies
- [ ] Manual Extension Development Host testing, when behavior changed

## Documentation

- [ ] README or user documentation updated
- [ ] Changelog updated
- [ ] Threat model or architecture updated when a trust boundary changed
- [ ] No documentation change is needed

## Contributor checklist

- [ ] The change is focused and linked to an issue when appropriate.
- [ ] No credentials, proprietary source, personal data, or tenant-confidential values are included.
- [ ] New dependencies are exact-versioned, justified, licensed, and reviewed.
- [ ] Experimental or high-frequency data flows remain opt-in.
- [ ] I understand and tested the submitted code, including AI-assisted portions.
