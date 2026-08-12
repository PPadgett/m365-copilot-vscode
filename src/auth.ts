import * as vscode from 'vscode';
import { inspectDelegatedGraphToken, REQUIRED_GRAPH_SCOPES } from './core';

const BEARER_SECRET = 'm365Copilot.graphBearerToken';

export const GRAPH_SCOPES = [
  ...REQUIRED_GRAPH_SCOPES.map(scope => `https://graph.microsoft.com/${scope}`),
  'offline_access'
] as const;

export class AuthManager {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async getAccessToken(interactive: boolean): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('m365Copilot');
    const authMode = config.get<'microsoft' | 'bearer'>('authMode', 'microsoft');

    if (authMode === 'bearer') {
      const token = await this.context.secrets.get(BEARER_SECRET);
      if (!token && interactive) {
        await vscode.commands.executeCommand('m365Copilot.setBearerToken');
        return this.context.secrets.get(BEARER_SECRET);
      }
      if (token) {
        const inspection = inspectDelegatedGraphToken(token);
        if (inspection.errors.length > 0) {
          throw new Error(`Stored Microsoft Graph token is invalid: ${inspection.errors.join(' ')}`);
        }
      }
      return token;
    }

    const options: vscode.AuthenticationGetSessionOptions = interactive
      ? { createIfNone: true }
      : { silent: true };

    const session = await vscode.authentication.getSession(
      'microsoft',
      GRAPH_SCOPES,
      options
    );

    return session?.accessToken;
  }

  public async signIn(): Promise<void> {
    const session = await vscode.authentication.getSession('microsoft', GRAPH_SCOPES, {
      createIfNone: true
    });

    await vscode.workspace.getConfiguration('m365Copilot').update(
      'authMode',
      'microsoft',
      vscode.ConfigurationTarget.Global
    );

    void vscode.window.showInformationMessage(
      `M365 Copilot signed in as ${session.account.label}.`
    );
  }

  public async setBearerToken(): Promise<void> {
    const token = await vscode.window.showInputBox({
      title: 'Microsoft 365 Copilot Graph Bearer Token',
      prompt: 'Paste a delegated Microsoft Graph JWT with all Copilot Chat API permissions.',
      placeHolder: 'eyJ0eXAiOiJKV1QiLCJub25jZSI6...',
      password: true,
      ignoreFocusOut: true
    });

    if (!token) {
      return;
    }

    const trimmedToken = token.trim();
    const inspection = inspectDelegatedGraphToken(trimmedToken);
    if (inspection.errors.length > 0) {
      void vscode.window.showErrorMessage(
        `Token was not stored. ${inspection.errors.join(' ')}`
      );
      return;
    }

    await this.context.secrets.store(BEARER_SECRET, trimmedToken);
    await vscode.workspace.getConfiguration('m365Copilot').update(
      'authMode',
      'bearer',
      vscode.ConfigurationTarget.Global
    );

    const expiry = inspection.expiresAt?.toLocaleString() ?? 'an unknown time';
    const warning = inspection.warnings.length > 0
      ? ` ${inspection.warnings.join(' ')}`
      : '';
    void vscode.window.showInformationMessage(
      `M365 Copilot Graph token stored in VS Code SecretStorage. It expires at ${expiry}.${warning}`
    );
  }

  public async clearBearerToken(): Promise<void> {
    await this.context.secrets.delete(BEARER_SECRET);
    void vscode.window.showInformationMessage('M365 Copilot Graph bearer token cleared.');
  }
}
