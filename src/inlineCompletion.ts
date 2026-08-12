import * as vscode from 'vscode';
import { cleanCompletion } from './core';
import { GraphCopilotClient } from './graphClient';

export class M365InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  public constructor(private readonly client: GraphCopilotClient) {}

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    const config = vscode.workspace.getConfiguration('m365Copilot');
    if (!config.get<boolean>('inlineCompletions', false)) {
      return [];
    }

    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
      return [];
    }

    const maxPrefix = config.get<number>('inlineMaxPrefixChars', 6000);
    const maxSuffix = config.get<number>('inlineMaxSuffixChars', 2000);
    const maxCompletion = config.get<number>('inlineMaxCompletionChars', 4000);

    const offset = document.offsetAt(position);
    const text = document.getText();
    const prefix = text.slice(Math.max(0, offset - maxPrefix), offset);
    const suffix = text.slice(offset, Math.min(text.length, offset + maxSuffix));

    if (!prefix.trim()) {
      return [];
    }

    const prompt = [
      'Act as an inline code completion engine.',
      `Language ID: ${document.languageId}`,
      `File name: ${basename(document.uri.path)}`,
      'Return only the exact text that should be inserted at <CURSOR>.',
      'Do not use Markdown fences, explanations, commentary, or XML tags.',
      'Prefer a short continuation, usually one expression, line, or small block.',
      '',
      '<BEFORE_CURSOR>',
      prefix,
      '</BEFORE_CURSOR>',
      '<CURSOR>',
      '<AFTER_CURSOR>',
      suffix,
      '</AFTER_CURSOR>'
    ].join('\n');

    try {
      const raw = await this.client.ask(prompt, token, false);
      const completion = cleanCompletion(raw);
      if (!completion || completion.length > maxCompletion || token.isCancellationRequested) {
        return [];
      }

      return [
        new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position)
        )
      ];
    } catch {
      // Inline requests are frequent. Use the explicit connection-test command for diagnostics.
      return [];
    }
  }
}

function basename(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.at(-1) ?? 'untitled';
}
