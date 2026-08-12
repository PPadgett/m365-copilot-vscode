const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
const commands = new Map();
const registrations = [];
const disposable = label => ({ dispose() {}, label });
const vscode = {
  lm: {
    registerLanguageModelChatProvider(id, provider) {
      registrations.push({ kind: 'language-model', id, provider });
      return disposable(`lm:${id}`);
    }
  },
  languages: {
    registerInlineCompletionItemProvider(selector, provider) {
      registrations.push({ kind: 'inline-completion', selector, provider });
      return disposable('inline');
    }
  },
  commands: {
    registerCommand(id, handler) {
      commands.set(id, handler);
      return disposable(`command:${id}`);
    },
    async executeCommand(...args) {
      registrations.push({ kind: 'execute-command', args });
    }
  }
};

test('extension activation registers the expected provider and commands without network access', async () => {
  Module._load = function patched(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const extension = require('../dist/extension.js');
    const context = { subscriptions: [], secrets: {} };
    extension.activate(context);

    assert.equal(context.subscriptions.length, 7);
    assert.equal(registrations[0].kind, 'language-model');
    assert.equal(registrations[0].id, 'm365-copilot-graph');
    assert.equal(registrations[1].kind, 'inline-completion');
    assert.deepEqual(registrations[1].selector, { pattern: '**' });
    assert.deepEqual([...commands.keys()].sort(), [
      'm365Copilot.clearBearerToken',
      'm365Copilot.openSettings',
      'm365Copilot.setBearerToken',
      'm365Copilot.signIn',
      'm365Copilot.testConnection'
    ]);

    await commands.get('m365Copilot.openSettings')();
    assert.deepEqual(registrations.at(-1).args, [
      'workbench.action.openSettings',
      '@ext:ppadgett.m365-copilot-graph-provider'
    ]);
    assert.doesNotThrow(() => extension.deactivate());
  } finally {
    Module._load = originalLoad;
  }
});
