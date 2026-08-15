const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const root = resolve(__dirname, '..');
const modulePromise = import(pathToFileURL(
  resolve(root, 'scripts/lib/repository-audit.mjs')
).href);

test('GitHub API requests time out, abort, and identify the stalled endpoint', async () => {
  const { createGitHubApiClient } = await modulePromise;
  let observedSignal;

  const client = createGitHubApiClient({
    apiUrl: 'https://api.github.test',
    requestTimeoutMs: 20,
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return new Promise(() => {});
    }
  });

  await assert.rejects(
    client.requestJson('repos/owner/repository'),
    error => {
      assert.match(error.message, /timed out after 20 ms/);
      assert.match(
        error.message,
        /https:\/\/api\.github\.test\/repos\/owner\/repository/
      );
      return true;
    }
  );

  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, true);
});

test('successful GitHub API requests receive a live AbortSignal', async () => {
  const { createGitHubApiClient } = await modulePromise;
  let observedSignal;

  const client = createGitHubApiClient({
    apiUrl: 'https://api.github.test',
    requestTimeoutMs: 1_000,
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.deepEqual(
    await client.requestJson('repos/owner/repository'),
    { ok: true }
  );
  assert.ok(observedSignal instanceof AbortSignal);
  assert.equal(observedSignal.aborted, false);
});

test('invalid GitHub API request timeouts fail before network access', async () => {
  const { createGitHubApiClient } = await modulePromise;

  assert.throws(
    () => createGitHubApiClient({
      apiUrl: 'https://api.github.test',
      requestTimeoutMs: 0
    }),
    /request timeout must be a positive safe integer/
  );
});
