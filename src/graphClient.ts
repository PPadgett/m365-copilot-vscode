import * as vscode from 'vscode';
import { AuthManager } from './auth';
import {
  extractCopilotText,
  formatGraphError,
  isPlainRecord,
  readBoundedResponseText,
  validateTimeZone
} from './core';

const GRAPH_ROOT = 'https://graph.microsoft.com/beta';
const MAX_GRAPH_RESPONSE_BYTES = 5 * 1024 * 1024;

interface CopilotConversation {
  id: string;
}

export class GraphCopilotClient {
  public constructor(private readonly auth: AuthManager) {}

  public async ask(
    prompt: string,
    token: vscode.CancellationToken,
    interactiveAuth = true
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration('m365Copilot');
    const maxPromptChars = config.get<number>('maxPromptChars', 200000);
    if (!prompt.trim()) {
      throw new Error('The Copilot prompt is empty.');
    }
    if (prompt.length > maxPromptChars) {
      throw new Error(
        `The request contains ${prompt.length.toLocaleString()} characters, exceeding the configured ` +
        `${maxPromptChars.toLocaleString()} character limit. Reduce context or raise m365Copilot.maxPromptChars.`
      );
    }

    const accessToken = await this.auth.getAccessToken(interactiveAuth);
    if (!accessToken) {
      throw new Error(
        'No Microsoft Graph access token is available. Run “M365 Copilot: Sign in with Microsoft” or set a bearer token.'
      );
    }

    const conversation = await this.request<CopilotConversation>(
      '/copilot/conversations',
      accessToken,
      {},
      token
    );

    if (!conversation.id) {
      throw new Error('Microsoft Graph did not return a Copilot conversation ID.');
    }

    const webGrounding = config.get<boolean>('webGrounding', false);
    const body: Record<string, unknown> = {
      message: { text: prompt },
      locationHint: { timeZone: currentTimeZone(config) }
    };

    if (!webGrounding) {
      body.contextualResources = {
        webContext: { isWebEnabled: false }
      };
    }

    const response = await this.request<unknown>(
      `/copilot/conversations/${encodeURIComponent(conversation.id)}/chat`,
      accessToken,
      body,
      token
    );

    const answer = extractCopilotText(response);
    if (answer) {
      return answer;
    }

    throw new Error('Microsoft 365 Copilot returned no text response.');
  }

  private async request<T>(
    path: string,
    accessToken: string,
    body: unknown,
    cancellationToken: vscode.CancellationToken
  ): Promise<T> {
    const config = vscode.workspace.getConfiguration('m365Copilot');
    const timeoutSeconds = config.get<number>('requestTimeoutSeconds', 120);
    const controller = new AbortController();
    let timedOut = false;

    const subscription = cancellationToken.onCancellationRequested(() => controller.abort());
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutSeconds * 1000);

    try {
      const response = await fetch(`${GRAPH_ROOT}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json',
          Pragma: 'no-cache'
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal
      });

      const raw = await readBoundedResponseText(response, MAX_GRAPH_RESPONSE_BYTES);
      if (!response.ok) {
        throw new Error(formatGraphError(response.status, raw));
      }

      if (!raw.trim()) {
        throw new Error(`Microsoft Graph ${response.status} returned an empty response body.`);
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainRecord(parsed)) {
        throw new Error('Microsoft Graph returned an unexpected JSON response.');
      }
      return parsed as T;
    } catch (error) {
      if (cancellationToken.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (timedOut) {
        throw new Error(`Microsoft Graph request timed out after ${timeoutSeconds} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      subscription.dispose();
    }
  }
}

function currentTimeZone(config: vscode.WorkspaceConfiguration): string {
  const configured = config.get<string>('timeZone', '');
  const validated = validateTimeZone(configured);
  if (validated) {
    return validated;
  }

  try {
    return validateTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? 'UTC';
  } catch {
    return 'UTC';
  }
}
