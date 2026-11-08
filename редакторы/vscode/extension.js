const path = require('path');
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { найтиКомпилятор, папкаЗапуска: найтиПапкуЗапуска } = require('./поиск');

let клиент;

function папкаЗапуска(uri) {
  const корни = (vscode.workspace.workspaceFolders || []).map(п => п.uri.fsPath);
  return найтиПапкуЗапуска(uri.fsPath, корни);
}

async function запустить(uri) {
  const редактор = vscode.window.activeTextEditor;
  uri = uri || (редактор && редактор.document.uri);
  if (!uri || uri.scheme !== 'file') return;
  const компилятор = найтиКомпилятор();
  if (!компилятор) {
    vscode.window.showErrorMessage('Компилятор «цуяк» не найден в PATH.');
    return;
  }
  // Генерация машинного кода поддерживается только на Linux x86_64, на остальных платформах интерпретируем.
  const команда = process.platform === 'linux' && process.arch === 'x64' ? ['комп', '-пуск'] : ['интер'];
  const документ = vscode.workspace.textDocuments.find(д => д.uri.toString() === uri.toString());
  if (документ && документ.isDirty) await документ.save();

  const strong = vscode.ShellQuoting.Strong;
  const задача = new vscode.Task(
    { type: 'cuya' },
    vscode.TaskScope.Workspace,
    'запустить ' + path.basename(uri.fsPath),
    'цуя',
    new vscode.ShellExecution(
      { value: компилятор, quoting: strong },
      команда.map(value => ({ value, quoting: strong })).concat([{ value: uri.fsPath, quoting: strong }]),
      { cwd: папкаЗапуска(uri) }),
    []);
  задача.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, focus: true };
  await vscode.tasks.executeTask(задача);
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('cuya.run', запустить));

  const модуль = context.asAbsolutePath('server.js');
  клиент = new LanguageClient(
    'cuya', 'ЦУЯ',
    { run: { module: модуль, transport: TransportKind.ipc },
      debug: { module: модуль, transport: TransportKind.ipc } },
    { documentSelector: [{ scheme: 'file', language: 'cuya' }] });
  клиент.start();
}

function deactivate() {
  return клиент ? клиент.stop() : undefined;
}

module.exports = { activate, deactivate };
