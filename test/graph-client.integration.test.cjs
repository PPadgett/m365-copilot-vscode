const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const configuration = new Map([
  ['maxPromptChars', 200000],
  ['webGrounding', false],
  ['timeZone', 'America/Chicago'],
  ['requestTimeoutSeconds', 10]
]);
class CancellationError extends Error {}
const vscode = {
  workspace: {
    getConfiguration() {
      return {
        get(key, fallback) {
          return configuration.has(key) ? configuration.get(key) : fallback;
        }
      };
    }
  },
  CancellationError
};

function cancellationToken() {
  return {
    isCancellationRequested: false,
    onCancellationRequested() {
      return { dispose() {} };
    }
  };
}

test('GraphCopilotClient executes the two-step Copilot Graph contract with mocked transport', async () => {
  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ id: 'conversation/with spaces' }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ messages: [{ text: '  answer from Copilot  ' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    delete require.cache[require.resolve('../dist/graphClient.js')];
    const { GraphCopilotClient } = require('../dist/graphClient.js');
    const auth = {
      async getAccessToken(interactive) {
        assert.equal(interactive, true);
        return 'delegated-token';
      }
    };
    const client = new GraphCopilotClient(auth);
    assert.equal(await client.ask('Explain this function', cancellationToken()), 'answer from Copilot');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://graph.microsoft.com/beta/copilot/conversations');
    assert.equal(calls[1].url, 'https://graph.microsoft.com/beta/copilot/conversations/conversation%2Fwith%20spaces/chat');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer delegated-token');
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      message: { text: 'Explain this function' },
      locationHint: { timeZone: 'America/Chicago' },
      contextualResources: { webContext: { isWebEnabled: false } }
    });
  } finally {
    global.fetch = originalFetch;
    Module._load = originalLoad;
  }
});

test('GraphCopilotClient fails closed when Graph returns an invalid conversation contract', async () => {
  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: '' }), { status: 201 });

  try {
    delete require.cache[require.resolve('../dist/graphClient.js')];
    const { GraphCopilotClient } = require('../dist/graphClient.js');
    const client = new GraphCopilotClient({ async getAccessToken() { return 'delegated-token'; } });
    await assert.rejects(client.ask('hello', cancellationToken()), /invalid Copilot conversation ID/);
  } finally {
    global.fetch = originalFetch;
    Module._load = originalLoad;
  }
});
