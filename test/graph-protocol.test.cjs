const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GRAPH_ROOT,
  buildChatRequest,
  graphUrl,
  parseConversationId,
  requireCopilotText
} = require('../dist/graphProtocol.js');

test('graphUrl restricts requests to the approved Microsoft Graph Copilot path', () => {
  assert.equal(
    graphUrl('/copilot/conversations'),
    `${GRAPH_ROOT}/copilot/conversations`
  );
  assert.equal(
    graphUrl('/copilot/conversations/a%2Fb/chat'),
    `${GRAPH_ROOT}/copilot/conversations/a%2Fb/chat`
  );
  for (const value of [
    '/users',
    'https://evil.example/copilot/conversations',
    '//evil.example/copilot/conversations',
    '/copilot/../../users',
    '/copilot/conversations?redirect=https://evil.example',
    '/copilot/conversations#fragment'
  ]) {
    assert.throws(() => graphUrl(value), /Copilot paths|approved HTTPS origin|beta Copilot API path/);
  }
});

test('parseConversationId accepts a bounded non-control identifier', () => {
  assert.equal(parseConversationId({ id: '  conversation/123  ' }), 'conversation/123');
});

test('parseConversationId rejects missing, blank, oversized, and control-character identifiers', () => {
  for (const payload of [
    null,
    {},
    { id: 7 },
    { id: '   ' },
    { id: 'a'.repeat(1025) },
    { id: 'conversation\n123' }
  ]) {
    assert.throws(() => parseConversationId(payload), /conversation ID/);
  }
});

test('buildChatRequest emits the documented Graph contract with web grounding disabled', () => {
  assert.deepEqual(
    buildChatRequest({
      prompt: 'Review this function.',
      timeZone: 'America/Chicago',
      webGrounding: false
    }),
    {
      message: { text: 'Review this function.' },
      locationHint: { timeZone: 'America/Chicago' },
      contextualResources: {
        webContext: { isWebEnabled: false }
      }
    }
  );
});

test('buildChatRequest omits web restrictions when grounding is enabled', () => {
  assert.deepEqual(
    buildChatRequest({
      prompt: 'hello',
      timeZone: 'UTC',
      webGrounding: true
    }),
    {
      message: { text: 'hello' },
      locationHint: { timeZone: 'UTC' }
    }
  );
});

test('buildChatRequest rejects blank prompts and invalid time zones', () => {
  assert.throws(
    () => buildChatRequest({ prompt: '   ', timeZone: 'UTC', webGrounding: false }),
    /prompt is empty/
  );
  assert.throws(
    () => buildChatRequest({ prompt: 'hello', timeZone: 'invalid/zone', webGrounding: false }),
    /IANA time zone/
  );
});

test('requireCopilotText returns the latest response and rejects empty payloads', () => {
  assert.equal(
    requireCopilotText({ messages: [{ text: 'first' }, { text: ' latest ' }] }),
    'latest'
  );
  assert.throws(() => requireCopilotText({ messages: [] }), /no text response/);
});
