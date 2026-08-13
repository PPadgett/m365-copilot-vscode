import { formatGraphError, isPlainRecord, readBoundedResponseText } from './core';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export interface PostJsonOptions {
  accessToken: string;
  body: unknown;
  signal: AbortSignal;
  maxResponseBytes: number;
  fetchImpl?: FetchLike;
}

export async function postJsonRecord<T extends Record<string, unknown>>(
  url: string,
  options: PostJsonOptions
): Promise<T> {
  if (!options.accessToken || options.accessToken.length > 65536 || /[\r\n]/.test(options.accessToken)) {
    throw new Error('A valid Microsoft Graph bearer token is required.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      Pragma: 'no-cache'
    },
    body: JSON.stringify(options.body),
    redirect: 'error',
    signal: options.signal
  });

  const raw = await readBoundedResponseText(response, options.maxResponseBytes);
  if (!response.ok) {
    throw new Error(formatGraphError(response.status, raw));
  }
  if (!raw.trim()) {
    throw new Error(`Microsoft Graph ${response.status} returned an empty response body.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Microsoft Graph returned malformed JSON.');
  }
  if (!isPlainRecord(parsed)) {
    throw new Error('Microsoft Graph returned an unexpected JSON response.');
  }
  return parsed as T;
}
