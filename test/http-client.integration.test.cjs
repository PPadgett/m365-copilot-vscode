const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');
const { postJsonRecord } = require('../dist/httpClient.js');

let server;
let baseUrl;
let received;

before(async () => {
  server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = {
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8')
    };

    switch (request.url) {
      case '/ok':
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ messages: [{ text: 'ok' }] }));
        return;
      case '/redirect':
        response.writeHead(302, { location: '/ok' });
        response.end();
        return;
      case '/forbidden':
        response.writeHead(403, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'Forbidden', message: 'No tenant consent\nprovided' } }));
        return;
      case '/large':
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': '4096'
        });
        response.end('{}');
        return;
      case '/empty':
        response.writeHead(204);
        response.end();
        return;
      case '/malformed':
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{not-json}');
        return;
      case '/array':
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('[]');
        return;
      default:
        response.writeHead(404);
        response.end('missing');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

function request(path, overrides = {}) {
  return postJsonRecord(`${baseUrl}${path}`, {
    accessToken: 'test-token',
    body: { message: { text: 'hello' } },
    signal: new AbortController().signal,
    maxResponseBytes: 1024,
    ...overrides
  });
}

test('postJsonRecord sends a bounded no-cache bearer POST and parses a record', async () => {
  const result = await request('/ok');
  assert.deepEqual(result, { messages: [{ text: 'ok' }] });
  assert.equal(received.method, 'POST');
  assert.equal(received.headers.authorization, 'Bearer test-token');
  assert.equal(received.headers.accept, 'application/json');
  assert.equal(received.headers['content-type'], 'application/json');
  assert.equal(received.headers['cache-control'], 'no-store');
  assert.equal(received.headers.pragma, 'no-cache');
  assert.deepEqual(JSON.parse(received.body), { message: { text: 'hello' } });
});

test('postJsonRecord rejects redirects rather than forwarding credentials', async () => {
  await assert.rejects(request('/redirect'), /redirect|fetch failed/i);
});

test('postJsonRecord returns bounded actionable Graph errors', async () => {
  await assert.rejects(
    request('/forbidden'),
    error => /Forbidden: No tenant consent provided/.test(error.message) && /tenant consent/.test(error.message)
  );
});

test('postJsonRecord rejects oversized, empty, malformed, and non-record responses', async () => {
  await assert.rejects(request('/large'), /exceeded/);
  await assert.rejects(request('/empty'), /empty response body/);
  await assert.rejects(request('/malformed'), /malformed JSON/);
  await assert.rejects(request('/array'), /unexpected JSON response/);
});

test('postJsonRecord rejects missing and header-injection bearer tokens', async () => {
  await assert.rejects(request('/ok', { accessToken: '' }), /bearer token/);
  await assert.rejects(request('/ok', { accessToken: 'safe\r\nX-Evil: 1' }), /bearer token/);
  await assert.rejects(request('/ok', { accessToken: 'x'.repeat(65537) }), /bearer token/);
});

test('postJsonRecord honors cancellation before the request starts', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(request('/ok', { signal: controller.signal }), /abort/i);
});
