const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const vscode = require('vscode');

exports.run = async function run() {
  const extension = vscode.extensions.getExtension('ppadgett.m365-copilot-graph-provider');
  assert.ok(extension, 'The extension must be discoverable in the real extension host.');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  const expectedCommands = extension.packageJSON.contributes.commands.map(command => command.command);
  for (const command of expectedCommands) assert.ok(commands.includes(command), `Missing command: ${command}`);
  const models = await vscode.lm.selectChatModels({ vendor: 'm365-copilot-graph' });
  assert.ok(models.some(model => model.id === 'm365-copilot-chat'), 'The model must appear in real VS Code model discovery.');
  const config = vscode.workspace.getConfiguration('m365Copilot');
  for (const setting of ['webGrounding', 'enableToolCalling', 'inlineCompletions']) {
    assert.equal(config.get(setting), false, `${setting} must remain opt-in.`);
  }
  const report = {
    vscodeVersion: vscode.version,
    extensionVersion: extension.packageJSON.version,
    commands: expectedCommands,
    models: models.map(model => ({ id: model.id, vendor: model.vendor, name: model.name })),
    liveTenantTested: false,
    result: 'passed'
  };
  if (process.env.M365_HOST_REPORT_PATH) writeFileSync(process.env.M365_HOST_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
};
