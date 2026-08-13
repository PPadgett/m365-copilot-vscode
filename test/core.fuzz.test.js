const assert = require('node:assert/strict');
const test = require('node:test');
const fc = require('fast-check');
const {
  cleanCompletion,
  extractCopilotText,
  formatGraphError,
  inspectDelegatedGraphToken,
  isPlainRecord,
  parseToolCall,
  readBoundedResponseText,
  validateTimeZone
} = require('../dist/core.js');

const numRuns = positiveInteger(process.env.FUZZ_RUNS, 500);
const seed = optionalInteger(process.env.FUZZ_SEED);
const propertyOptions = {
  numRuns,
  endOnFailure: true,
  ...(seed === undefined ? {} : { seed })
};

propertyTest('cleanCompletion remains total and bounded for arbitrary text',
  fc.property(fc.string({ maxLength: 8192 }), raw => {
    const cleaned = cleanCompletion(raw);
    assert.equal(typeof cleaned, 'string');
    assert.ok(cleaned.length <= raw.length);
  })
);

propertyTest('extractCopilotText returns the last non-empty generated message',
  fc.property(
    fc.array(fc.record({ text: fc.string({ maxLength: 512 }) }), { maxLength: 40 }),
    messages => {
      const expected = [...messages]
        .reverse()
        .map(message => message.text.trim())
        .find(Boolean);
      assert.equal(extractCopilotText({ messages }), expected);
    }
  )
);

propertyTest('extractCopilotText and isPlainRecord tolerate arbitrary JSON values',
  fc.property(fc.jsonValue(), value => {
    const extracted = extractCopilotText(value);
    assert.ok(extracted === undefined || (typeof extracted === 'string' && extracted.length > 0));
    assert.equal(typeof isPlainRecord(value), 'boolean');
  })
);

propertyTest('tool-call parsing rejects arbitrary unknown tool names without throwing',
  fc.property(
    fc.string({ maxLength: 128 }).filter(name => name !== 'read_file'),
    fc.jsonValue(),
    (name, input) => {
      const payload = `<vscode_tool_call>${JSON.stringify({ name, input })}</vscode_tool_call>`;
      assert.equal(parseToolCall(payload, new Set(['read_file'])), undefined);
    }
  )
);

propertyTest('tool-call parsing remains total for arbitrary model output',
  fc.property(fc.string({ maxLength: 12000 }), output => {
    const parsed = parseToolCall(output, new Set(['read_file', 'search']));
    assert.ok(parsed === undefined || (parsed.name === 'read_file' || parsed.name === 'search'));
  })
);

propertyTest('delegated-token inspection remains total for arbitrary token-shaped text',
  fc.property(fc.string({ maxLength: 8192 }), token => {
    const inspection = inspectDelegatedGraphToken(token, Date.UTC(2026, 7, 11));
    assert.ok(Array.isArray(inspection.errors));
    assert.ok(Array.isArray(inspection.warnings));
    assert.ok(inspection.errors.every(value => typeof value === 'string'));
    assert.ok(inspection.warnings.every(value => typeof value === 'string'));
  })
);

propertyTest('Graph errors stay bounded and strip unsafe control characters',
  fc.property(
    fc.integer({ min: 100, max: 599 }),
    fc.string({ maxLength: 10000 }),
    (status, raw) => {
      const message = formatGraphError(status, raw);
      assert.equal(typeof message, 'string');
      assert.ok(message.length <= 2400);
      assert.doesNotMatch(message, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    }
  )
);

propertyTest('time-zone validation remains total for arbitrary strings',
  fc.property(fc.string({ maxLength: 512 }), candidate => {
    const value = validateTimeZone(candidate);
    assert.ok(value === undefined || typeof value === 'string');
  })
);

test('bounded response handling is fuzzed across byte sequences and limits', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uint8Array({ maxLength: 2048 }),
      fc.integer({ min: 1, max: 2048 }),
      async (bytes, maxBytes) => {
        const operation = readBoundedResponseText(new Response(bytes), maxBytes);
        if (bytes.byteLength > maxBytes) {
          await assert.rejects(operation, /exceeded/);
        } else {
          assert.equal(typeof await operation, 'string');
        }
      }
    ),
    propertyOptions
  );
});

function propertyTest(name, property) {
  test(name, () => {
    fc.assert(property, propertyOptions);
  });
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('FUZZ_RUNS must be a positive safe integer.');
  }
  return parsed;
}

function optionalInteger(value) {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('FUZZ_SEED must be a safe integer.');
  }
  return parsed;
}
