export const REQUIRED_GRAPH_SCOPES = [
  'Sites.Read.All',
  'Mail.Read',
  'People.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'ExternalItem.Read.All'
] as const;

const GRAPH_AUDIENCES = new Set([
  '00000003-0000-0000-c000-000000000000',
  'https://graph.microsoft.com'
]);

const TOOL_CALL_RE = /^\s*<vscode_tool_call>\s*([\s\S]*?)\s*<\/vscode_tool_call>\s*$/i;
const MAX_ERROR_DETAIL_CHARS = 2000;
const MAX_JWT_CHARS = 65536;
const MAX_TOOL_INPUT_DEPTH = 32;
const MAX_TOOL_INPUT_NODES = 10000;
const PROHIBITED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ParsedToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface TokenInspection {
  errors: string[];
  warnings: string[];
  expiresAt?: Date;
  tenantId?: string;
}

interface JwtClaims {
  aud?: string | string[];
  exp?: number;
  scp?: string;
  tid?: string;
}

export function cleanCompletion(raw: string): string {
  const fenced = raw.match(/^\s*```(?:[\w.+-]+)?\s*\n([\s\S]*?)```\s*$/);
  let value = fenced?.[1] ?? raw;

  value = value
    .replace(/^\s*(?:Here(?:'s| is)|Sure[:,]?|Continuation:)\s*/i, '')
    .replace(/^\s*<completion>\s*/i, '')
    .replace(/\s*<\/completion>\s*$/i, '')
    .trimEnd();

  return value;
}

export function parseToolCall(
  answer: string,
  allowedToolNames: ReadonlySet<string>
): ParsedToolCall | undefined {
  const match = answer.match(TOOL_CALL_RE);
  if (!match?.[1] || match[1].length > 100000) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]) as Partial<ParsedToolCall>;
    if (typeof parsed.name !== 'string' || !allowedToolNames.has(parsed.name)) {
      return undefined;
    }
    if (!isSafeToolInput(parsed.input)) {
      return undefined;
    }
    return {
      name: parsed.name,
      input: parsed.input
    };
  } catch {
    return undefined;
  }
}

export function extractCopilotText(payload: unknown): string | undefined {
  if (!isPlainRecord(payload) || !Array.isArray(payload.messages)) {
    return undefined;
  }

  for (let index = payload.messages.length - 1; index >= 0; index -= 1) {
    const message = payload.messages[index];
    if (!isPlainRecord(message) || typeof message.text !== 'string') {
      continue;
    }
    const text = message.text.trim();
    if (text) {
      return text;
    }
  }

  return undefined;
}


export async function readBoundedResponseText(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('The response byte limit must be a positive safe integer.');
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const length = Number.parseInt(declaredLength, 10);
    if (length > maxBytes) {
      throw new Error(`Microsoft Graph response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
    }
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return result + decoder.decode();
      }
      received += value.byteLength;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size-limit error below is the actionable failure for the caller.
        }
        throw new Error(`Microsoft Graph response exceeded the ${maxBytes.toLocaleString()} byte limit.`);
      }
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export function formatGraphError(status: number, raw: string): string {
  let detail = sanitizeErrorDetail(raw);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isPlainRecord(parsed) && isPlainRecord(parsed.error)) {
      const code = typeof parsed.error.code === 'string' ? parsed.error.code : '';
      const message = typeof parsed.error.message === 'string' ? parsed.error.message : '';
      if (message) {
        detail = sanitizeErrorDetail(`${code ? `${code}: ` : ''}${message}`);
      }
    }
  } catch {
    // A non-JSON Graph response is reported as bounded plain text.
  }

  if (status === 401) {
    detail += ' The token may be expired or have the wrong Microsoft Graph audience or delegated scopes.';
  } else if (status === 403) {
    detail += ' Verify the Microsoft 365 Copilot entitlement and tenant consent for all required delegated Graph permissions.';
  } else if (status === 429) {
    detail += ' Microsoft Graph throttled the request. Retry after the service-provided delay.';
  }

  return `Microsoft Graph ${status}: ${detail || 'request failed without an error body'}`;
}

export function inspectDelegatedGraphToken(
  token: string,
  nowMilliseconds = Date.now()
): TokenInspection {
  const inspection: TokenInspection = { errors: [], warnings: [] };
  if (token.length > MAX_JWT_CHARS) {
    inspection.errors.push(`The JWT exceeds the ${MAX_JWT_CHARS.toLocaleString()} character limit.`);
    return inspection;
  }

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    inspection.errors.push('The value is not a JWT access token.');
    return inspection;
  }

  if (parts.some(part => !part || !/^[A-Za-z0-9_-]+$/.test(part))) {
    inspection.errors.push('The value is not a well-formed JWT access token.');
    return inspection;
  }

  let claims: JwtClaims;
  try {
    const decoded = JSON.parse(decodeBase64Url(parts[1])) as unknown;
    if (!isPlainRecord(decoded)) {
      throw new TypeError('JWT claims must be a JSON object.');
    }
    claims = decoded;
  } catch {
    inspection.errors.push('The JWT payload could not be decoded.');
    return inspection;
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some(audience => typeof audience === 'string' && GRAPH_AUDIENCES.has(audience))) {
    inspection.errors.push('The token audience is not Microsoft Graph.');
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const expiration = claims.exp;
  if (typeof expiration !== 'number' || !Number.isSafeInteger(expiration) || expiration <= 0) {
    inspection.errors.push('The token has no valid numeric expiration claim.');
  } else {
    inspection.expiresAt = new Date(expiration * 1000);
    if (expiration <= nowSeconds) {
      inspection.errors.push('The token is expired.');
    } else if (expiration - nowSeconds < 300) {
      inspection.warnings.push('The token expires in less than five minutes.');
    }
  }

  const grantedScopes = new Set(
    typeof claims.scp === 'string' ? claims.scp.split(/\s+/).filter(Boolean) : []
  );
  const missingScopes = REQUIRED_GRAPH_SCOPES.filter(scope => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    inspection.errors.push(`The token is missing delegated scopes: ${missingScopes.join(', ')}.`);
  }

  if (typeof claims.tid === 'string' && claims.tid) {
    inspection.tenantId = claims.tid;
  }

  return inspection;
}

export function validateTimeZone(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format();
    return candidate;
  } catch {
    return undefined;
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isSafeToolInput(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }

  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > MAX_TOOL_INPUT_DEPTH || ++nodes > MAX_TOOL_INPUT_NODES) {
      return false;
    }

    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') {
      continue;
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        return false;
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isPlainRecord(current.value)) {
      return false;
    }

    for (const [key, nested] of Object.entries(current.value)) {
      if (PROHIBITED_OBJECT_KEYS.has(key)) {
        return false;
      }
      pending.push({ value: nested, depth: current.depth + 1 });
    }
  }

  return true;
}

function sanitizeErrorDetail(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_DETAIL_CHARS);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
