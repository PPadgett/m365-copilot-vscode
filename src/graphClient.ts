import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { validateTimeZone } from './core';
import { postJsonRecord } from './httpClient';
import {
  buildChatRequest,
  graphUrl,
  parseConversationId,
  requireCopilotText
} from './graphProtocol';
const MAX_GRAPH_RESPONSE_BYTES = 5 * 1024 * 1024;

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

    const conversation = await this.request<Record<string, unknown>>(
      '/copilot/conversations',
      accessToken,
      {},
      token
    );
    const conversationId = parseConversationId(conversation);

    const response = await this.request<Record<string, unknown>>(
      `/copilot/conversations/${encodeURIComponent(conversationId)}/chat`,
      accessToken,
      buildChatRequest({
        prompt,
        timeZone: currentTimeZone(config),
        webGrounding: config.get<boolean>('webGrounding', false)
      }),
      token
    );

    return requireCopilotText(response);
  }

  private async request<T extends Record<string, unknown>>(
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
      return await postJsonRecord<T>(graphUrl(path), {
        accessToken,
        body,
        signal: controller.signal,
        maxResponseBytes: MAX_GRAPH_RESPONSE_BYTES
      });
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
