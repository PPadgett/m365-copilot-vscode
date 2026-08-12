const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { join, resolve } = require('node:path');
const test = require('node:test');

const moduleUrl = pathToFileURL(join(resolve(__dirname, '..'), 'scripts/security-policy-links.mjs')).href;
const expected = 'https://github.com/PPadgett/m365-copilot-vscode/security/advisories/new';

let containsExactHttpUrl;

test.before(async () => {
  ({ containsExactHttpUrl } = await import(moduleUrl));
});

test('accepts the exact private vulnerability reporting URL', () => {
  assert.equal(containsExactHttpUrl(`**${expected}**`, expected), true);
  assert.equal(containsExactHttpUrl(`[Private report](${expected})`, expected), true);
  assert.equal(containsExactHttpUrl(`Report here: ${expected}.`, expected), true);
});

test('rejects trusted URL text embedded in an attacker-controlled URL', () => {
  const candidates = [
    `https://evil.example/${expected}`,
    `${expected}.evil.example`,
    'https://github.com.evil.example/PPadgett/m365-copilot-vscode/security/advisories/new',
    'https://github.com@evil.example/PPadgett/m365-copilot-vscode/security/advisories/new'
  ];

  for (const candidate of candidates) {
    assert.equal(containsExactHttpUrl(candidate, expected), false, candidate);
  }
});

test('rejects query strings, fragments, alternate paths, and alternate schemes', () => {
  for (const candidate of [
    `${expected}?redirect=https://evil.example`,
    `${expected}#unexpected`,
    `${expected}/child`,
    expected.replace('https:', 'http:')
  ]) {
    assert.equal(containsExactHttpUrl(candidate, expected), false, candidate);
  }
});

test('rejects invalid input and invalid expected URLs', () => {
  assert.equal(containsExactHttpUrl('No URL here.', expected), false);
  assert.throws(() => containsExactHttpUrl(null, expected), /must be a string/);
  assert.throws(() => containsExactHttpUrl(expected, 'not a URL'), /absolute HTTP or HTTPS/);
});
