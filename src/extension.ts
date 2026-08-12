import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { GraphCopilotClient } from './graphClient';
import { M365InlineCompletionProvider } from './inlineCompletion';
import { M365CopilotProvider } from './provider';

export function activate(context: vscode.ExtensionContext): void {
  const auth = new AuthManager(context);
  const client = new GraphCopilotClient(auth);
  const provider = new M365CopilotProvider(client);

  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider('m365-copilot-graph', provider),
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      new M365InlineCompletionProvider(client)
    ),
    vscode.commands.registerCommand('m365Copilot.signIn', () => auth.signIn()),
    vscode.commands.registerCommand('m365Copilot.setBearerToken', () => auth.setBearerToken()),
    vscode.commands.registerCommand('m365Copilot.clearBearerToken', () => auth.clearBearerToken()),
    vscode.commands.registerCommand('m365Copilot.openSettings', () => {
      return vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:ppadgett.m365-copilot-graph-provider'
      );
    }),
    vscode.commands.registerCommand('m365Copilot.testConnection', async () => {
      const source = new vscode.CancellationTokenSource();
      try {
        const answer = await client.ask(
          'Reply with exactly: M365 Copilot Graph connection successful',
          source.token,
          true
        );
        const preview = answer.length > 500 ? `${answer.slice(0, 500)}…` : answer;
        void vscode.window.showInformationMessage(`M365 Copilot response: ${preview}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`M365 Copilot connection failed: ${message}`);
      } finally {
        source.dispose();
      }
    })
  );
}

export function deactivate(): void {
  // VS Code disposes providers and commands registered through context.subscriptions.
}
