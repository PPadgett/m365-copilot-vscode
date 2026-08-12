const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_GRAPH_SCOPES,
  cleanCompletion,
  extractCopilotText,
  formatGraphError,
  inspectDelegatedGraphToken,
  isPlainRecord,
  parseToolCall,
  readBoundedResponseText,
  validateTimeZone
} = require('../dist/core.js');

test('cleanCompletion removes a single Markdown fence and wrapper prose', () => {
  assert.equal(cleanCompletion('```ts\nreturn value;\n```'), 'return value;');
  assert.equal(cleanCompletion("Here's <completion>answer</completion>"), 'answer');
});

test('cleanCompletion preserves TypeScript generic syntax', () => {
  assert.equal(cleanCompletion('const value = map<T>(input);'), 'const value = map<T>(input);');
});

test('parseToolCall accepts one exact allowed tool call', () => {
  const parsed = parseToolCall(
    '<vscode_tool_call>{"name":"read_file","input":{"path":"README.md","ranges":[1,2]}}</vscode_tool_call>',
    new Set(['read_file'])
  );
  assert.deepEqual(parsed, { name: 'read_file', input: { path: 'README.md', ranges: [1, 2] } });
});

test('parseToolCall rejects mixed prose, malformed JSON, and oversized payloads', () => {
  assert.equal(
    parseToolCall(
      'I will read it. <vscode_tool_call>{"name":"read_file","input":{}}</vscode_tool_call>',
      new Set(['read_file'])
    ),
    undefined
  );
  assert.equal(
    parseToolCall('<vscode_tool_call>{not json}</vscode_tool_call>', new Set(['read_file'])),
    undefined
  );
  assert.equal(
    parseToolCall(`<vscode_tool_call>${'x'.repeat(100001)}</vscode_tool_call>`, new Set(['read_file'])),
    undefined
  );
});

test('parseToolCall rejects unknown tools and non-object input', () => {
  assert.equal(
    parseToolCall(
      '<vscode_tool_call>{"name":"delete_everything","input":{}}</vscode_tool_call>',
      new Set(['read_file'])
    ),
    undefined
  );
  assert.equal(
    parseToolCall(
      '<vscode_tool_call>{"name":"read_file","input":[]}</vscode_tool_call>',
      new Set(['read_file'])
    ),
    undefined
  );
});

test('parseToolCall rejects prototype-pollution keys at any depth', () => {
  for (const input of [
    '{"__proto__":{"polluted":true}}',
    '{"nested":{"constructor":{"prototype":{"polluted":true}}}}',
    '{"items":[{"prototype":{}}]}'
  ]) {
    assert.equal(
      parseToolCall(
        `<vscode_tool_call>{"name":"read_file","input":${input}}</vscode_tool_call>`,
        new Set(['read_file'])
      ),
      undefined
    );
  }
  assert.equal({}.polluted, undefined);
});

test('parseToolCall rejects excessive nesting', () => {
  let nested = '"value"';
  for (let index = 0; index < 34; index += 1) {
    nested = `{"next":${nested}}`;
  }
  assert.equal(
    parseToolCall(
      `<vscode_tool_call>{"name":"read_file","input":${nested}}</vscode_tool_call>`,
      new Set(['read_file'])
    ),
    undefined
  );
});

test('extractCopilotText returns the latest non-empty message', () => {
  assert.equal(
    extractCopilotText({ messages: [{ text: 'first' }, { text: '  ' }, { text: 'latest' }] }),
    'latest'
  );
});

test('extractCopilotText rejects invalid or empty payloads', () => {
  assert.equal(extractCopilotText(null), undefined);
  assert.equal(extractCopilotText({ messages: [{ nope: true }, { text: '  ' }] }), undefined);
});

test('readBoundedResponseText returns bounded UTF-8 content', async () => {
  const response = new Response('hello \u{1F30E}');
  assert.equal(await readBoundedResponseText(response, 64), 'hello \u{1F30E}');
  assert.equal(await readBoundedResponseText(new Response('12345'), 5), '12345');
  assert.equal(await readBoundedResponseText(new Response(null), 64), '');
});

test('readBoundedResponseText rejects declared and streamed oversized responses', async () => {
  await assert.rejects(
    readBoundedResponseText(new Response('small', { headers: { 'content-length': '1000' } }), 10),
    /exceeded/
  );
  await assert.rejects(
    readBoundedResponseText(new Response('this body is too large'), 5),
    /exceeded/
  );
  await assert.rejects(readBoundedResponseText(new Response('x'), 0), /positive safe integer/);
});

test('formatGraphError uses bounded structured Graph details', () => {
  const message = formatGraphError(
    401,
    JSON.stringify({ error: { code: 'InvalidAuthenticationToken', message: 'Expired' } })
  );
  assert.match(message, /InvalidAuthenticationToken: Expired/);
  assert.match(message, /wrong Microsoft Graph audience/);
});

test('formatGraphError provides actionable 403 and 429 messages', () => {
  assert.match(formatGraphError(403, 'forbidden'), /tenant consent/);
  assert.match(formatGraphError(429, 'slow\u0000 down'), /Retry after/);
  assert.match(formatGraphError(500, ''), /without an error body/);
});

test('inspectDelegatedGraphToken accepts a valid delegated Graph JWT', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const token = jwt({
    aud: '00000003-0000-0000-c000-000000000000',
    exp: Math.floor(now / 1000) + 3600,
    scp: REQUIRED_GRAPH_SCOPES.join(' '),
    tid: 'tenant-id'
  });
  const inspection = inspectDelegatedGraphToken(token, now);
  assert.deepEqual(inspection.errors, []);
  assert.deepEqual(inspection.warnings, []);
  assert.equal(inspection.tenantId, 'tenant-id');
  assert.equal(inspection.expiresAt.toISOString(), '2026-08-11T13:00:00.000Z');
});

test('inspectDelegatedGraphToken rejects wrong audience, expiry, and missing scopes', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const token = jwt({ aud: 'other-api', exp: Math.floor(now / 1000) - 1, scp: 'User.Read' });
  const inspection = inspectDelegatedGraphToken(token, now);
  assert.equal(inspection.errors.length, 3);
});

test('inspectDelegatedGraphToken rejects a token expiring exactly now', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const token = jwt({
    aud: 'https://graph.microsoft.com',
    exp: Math.floor(now / 1000),
    scp: REQUIRED_GRAPH_SCOPES.join(' ')
  });
  assert.match(inspectDelegatedGraphToken(token, now).errors.join(' '), /expired/);
});

test('inspectDelegatedGraphToken warns when expiry is near', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const token = jwt({
    aud: 'https://graph.microsoft.com',
    exp: Math.floor(now / 1000) + 299,
    scp: REQUIRED_GRAPH_SCOPES.join(' ')
  });
  assert.deepEqual(inspectDelegatedGraphToken(token, now).warnings, [
    'The token expires in less than five minutes.'
  ]);
});

test('inspectDelegatedGraphToken rejects malformed token formats and claims', () => {
  assert.match(inspectDelegatedGraphToken('x'.repeat(65537)).errors[0], /character limit/);
  assert.match(inspectDelegatedGraphToken('not-a-jwt').errors[0], /not a JWT/);
  assert.match(inspectDelegatedGraphToken('a.@@@.c').errors[0], /well-formed/);
  assert.match(inspectDelegatedGraphToken('a.b.c').errors[0], /could not be decoded/);
  assert.match(inspectDelegatedGraphToken(jwt([])).errors[0], /could not be decoded/);
  assert.match(
    inspectDelegatedGraphToken(jwt({ aud: 'https://graph.microsoft.com', scp: REQUIRED_GRAPH_SCOPES.join(' ') })).errors[0],
    /expiration/
  );
});

test('validateTimeZone accepts IANA values and rejects invalid or blank values', () => {
  assert.equal(validateTimeZone(' America/Chicago '), 'America/Chicago');
  assert.equal(validateTimeZone('not/a-zone'), undefined);
  assert.equal(validateTimeZone('   '), undefined);
});

test('isPlainRecord accepts only plain and null-prototype objects', () => {
  assert.equal(isPlainRecord({}), true);
  assert.equal(isPlainRecord(Object.create(null)), true);
  assert.equal(isPlainRecord([]), false);
  assert.equal(isPlainRecord(new Date()), false);
  assert.equal(isPlainRecord(null), false);
});

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.${encode('signature')}`;
}
