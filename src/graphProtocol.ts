import { extractCopilotText, isPlainRecord, validateTimeZone } from './core';

export const GRAPH_ROOT = 'https://graph.microsoft.com/beta';
const MAX_CONVERSATION_ID_CHARS = 1024;

export interface ChatRequestOptions {
  prompt: string;
  timeZone: string;
  webGrounding: boolean;
}

export function graphUrl(path: string): string {
  if (!path.startsWith('/copilot/')) {
    throw new Error('Microsoft Graph Copilot paths must begin with /copilot/.');
  }

  const url = new URL(`${GRAPH_ROOT}${path}`);
  if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com') {
    throw new Error('Microsoft Graph requests must use the approved HTTPS origin.');
  }
  if (!url.pathname.startsWith('/beta/copilot/')) {
    throw new Error('Microsoft Graph requests must remain under the beta Copilot API path.');
  }
  if (url.search || url.hash) {
    throw new Error('Microsoft Graph Copilot paths must not include a query string or fragment.');
  }
  return url.toString();
}

export function parseConversationId(payload: unknown): string {
  if (!isPlainRecord(payload) || typeof payload.id !== 'string') {
    throw new Error('Microsoft Graph did not return a Copilot conversation ID.');
  }

  const id = payload.id.trim();
  if (!id || id.length > MAX_CONVERSATION_ID_CHARS || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new Error('Microsoft Graph returned an invalid Copilot conversation ID.');
  }
  return id;
}

export function buildChatRequest(options: ChatRequestOptions): Record<string, unknown> {
  const prompt = options.prompt;
  if (!prompt.trim()) {
    throw new Error('The Copilot prompt is empty.');
  }

  const timeZone = validateTimeZone(options.timeZone);
  if (!timeZone) {
    throw new Error('The Microsoft Graph location hint must use a valid IANA time zone.');
  }

  const body: Record<string, unknown> = {
    message: { text: prompt },
    locationHint: { timeZone }
  };

  if (!options.webGrounding) {
    body.contextualResources = {
      webContext: { isWebEnabled: false }
    };
  }

  return body;
}

export function requireCopilotText(payload: unknown): string {
  const answer = extractCopilotText(payload);
  if (!answer) {
    throw new Error('Microsoft 365 Copilot returned no text response.');
  }
  return answer;
}
