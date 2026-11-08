// Языковой сервер ЦУЯ: диагностики от «цуяк проверка» и структура документа.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const {
  createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
  DiagnosticSeverity, SymbolKind, CompletionItemKind, MarkupKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');
const { найтиКомпилятор, папкаЗапуска: найтиПапкуЗапуска } = require('./поиск');

const соединение = createConnection(ProposedFeatures.all);
const документы = new TextDocuments(TextDocument);
let корни = [];

// Для каждого проверенного документа помним, куда мы опубликовали диагностики,
// чтобы очистить их при следующей проверке (ошибка может быть во включённом файле).
const опубликовано = new Map();

соединение.onInitialize(params => {
  корни = (params.workspaceFolders || []).map(п => fileURLToPath(п.uri));
  return {
    capabilities: {
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental, save: {} },
      documentSymbolProvider: true,
      completionProvider: { triggerCharacters: ['.'] },
      definitionProvider: true,
      hoverProvider: true,
    },
  };
});

const СТРОКА_ДИАГНОСТИКИ = /^(.+?):(\d+):(\d+): ([А-ЯЁ]+): (.*)$/;
const СЛОВО = /[\p{L}\p{N}_]+/uy;

function уровень(текст) {
  return текст === 'ОШИБКА' ? DiagnosticSeverity.Error
    : текст === 'СДЕЛАТЬ' ? DiagnosticSeverity.Information
    : DiagnosticSeverity.Warning;
}

function диапазон(документ, строка, столбец) {
  // Компилятор считает строки и столбцы с единицы. Подчёркиваем слово под курсором.
  const текст = документ ? документ.getText().split('\n')[строка] || '' : '';
  const начало = Math.min(столбец, текст.length);
  СЛОВО.lastIndex = начало;
  const совпадение = СЛОВО.exec(текст);
  const конец = совпадение ? начало + совпадение[0].length : начало + 1;
  return { start: { line: строка, character: начало }, end: { line: строка, character: конец } };
}

function запуститьПроверку(компилятор, файл, cwd) {
  return new Promise(resolve => {
    execFile(компилятор, ['проверка', файл], { cwd, timeout: 10000 }, (ошибка, _stdout, stderr) => {
      resolve({ ошибка, stderr: stderr || '' });
    });
  });
}

const папкаЗапуска = файл => найтиПапкуЗапуска(файл, корни);

async function проверить(документ) {
  if (!документ.uri.startsWith('file:')) return;
  const файл = fileURLToPath(документ.uri);
  const cwd = папкаЗапуска(файл);
  const компилятор = найтиКомпилятор();
  const найденные = new Map(); // uri -> Diagnostic[]
  найденные.set(документ.uri, []);

  if (!компилятор) {
    найденные.get(документ.uri).push({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      severity: DiagnosticSeverity.Warning,
      source: 'цуя',
      message: 'Компилятор «цуяк» не найден в PATH: проверка отключена.',
    });
  } else {
    const { ошибка, stderr } = await запуститьПроверку(компилятор, файл, cwd);
    for (const строка of stderr.split('\n')) {
      const м = СТРОКА_ДИАГНОСТИКИ.exec(строка);
      if (!м) continue;
      const сообщённыйФайл = path.resolve(cwd, м[1]);
      // Для самого документа берём его собственный URI: кодировка у клиента может отличаться.
      const uri = сообщённыйФайл === файл ? документ.uri : pathToFileURL(сообщённыйФайл).toString();
      const открытый = документы.get(uri);
      const диагностика = {
        range: диапазон(открытый, Number(м[2]) - 1, Number(м[3]) - 1),
        severity: уровень(м[4]),
        source: 'цуяк',
        message: м[5],
      };
      if (!найденные.has(uri)) найденные.set(uri, []);
      найденные.get(uri).push(диагностика);
    }
    if (ошибка && !stderr.includes('ОШИБКА') && ошибка.code !== 1) {
      соединение.console.error(`цуяк проверка: ${ошибка.message}`);
    }
  }

  for (const uri of опубликовано.get(документ.uri) || []) {
    if (!найденные.has(uri)) соединение.sendDiagnostics({ uri, diagnostics: [] });
  }
  for (const [uri, diagnostics] of найденные) соединение.sendDiagnostics({ uri, diagnostics });
  опубликовано.set(документ.uri, new Set(найденные.keys()));
}

// Проверяем при открытии и сохранении: компилятор читает файлы с диска,
// а включения («вкл») разрешаются относительно рабочей папки.
документы.onDidOpen(e => проверить(e.document));
документы.onDidSave(e => проверить(e.document));
документы.onDidClose(e => {
  for (const uri of опубликовано.get(e.document.uri) || []) {
    соединение.sendDiagnostics({ uri, diagnostics: [] });
  }
  опубликовано.delete(e.document.uri);
});

// ---- Индекс объявлений ----

const ИДЕНТ = '[\\p{L}_][\\p{L}\\p{N}_]*';
const РЕ_ПРО = new RegExp(`^[ \\t]*про[ \\t]+(${ИДЕНТ})[ \\t]*\\(([^)]*)\\)`, 'u');
const РЕ_СТРУКТ = new RegExp(`^[ \\t]*структ[ \\t]+(${ИДЕНТ})`, 'u');
const РЕ_ПОЛЕ = new RegExp(`^[ \\t]*(${ИДЕНТ})[ \\t]*:[ \\t]*([^;]+);`, 'u');
const РЕ_КОНСТ = new RegExp(`^[ \\t]*конст[ \\t]+(${ИДЕНТ})`, 'u');
const РЕ_ПЕР = new RegExp(`(?<![\\p{L}\\p{N}_])пер[ \\t]+(${ИДЕНТ})`, 'gu');
const РЕ_ВКЛ = new RegExp(`^[ \\t]*вкл[ \\t]+(${ИДЕНТ})[ \\t]*;`, 'u');

// Разбирает текст в список объявлений. «Глобальные» — про, структ, конст;
// «локальные» — параметры и переменные (область видимости не различаем).
function разобрать(текст, uri) {
  const объявления = [];
  const включения = [];
  const строки = текст.split('\n');
  let структура = null;
  строки.forEach((строка, номер) => {
    const добавить = (имя, вид, подпись, глобальное, поискИмени = имя) => {
      const столбец = Math.max(0, строка.indexOf(поискИмени));
      объявления.push({ имя, вид, подпись, глобальное, uri, строка: номер, столбец });
    };
    if (структура) {
      if (/^[ \t]*кц(?![\p{L}\p{N}_])/u.test(строка)) { структура = null; return; }
      const поле = РЕ_ПОЛЕ.exec(строка);
      if (поле) {
        const объявление = { имя: поле[1], вид: 'поле', подпись: `${поле[1]}: ${поле[2].trim()}`,
          глобальное: false, uri, строка: номер, столбец: строка.indexOf(поле[1]), структура };
        объявления.push(объявление);
      }
      return;
    }
    let м;
    if ((м = РЕ_ПРО.exec(строка))) {
      добавить(м[1], 'про', строка.trim().replace(/[ \t]+(нч|то)(?![\p{L}\p{N}_]).*$/u, ''), true);
      for (const параметр of м[2].split(',')) {
        const п = new RegExp(`^[ \\t]*(${ИДЕНТ})[ \\t]*:`, 'u').exec(параметр);
        if (п) добавить(п[1], 'пер', параметр.trim(), false, п[1]);
      }
    } else if ((м = РЕ_СТРУКТ.exec(строка))) {
      добавить(м[1], 'структ', `структ ${м[1]}`, true);
      структура = м[1];
    } else if ((м = РЕ_КОНСТ.exec(строка))) {
      добавить(м[1], 'конст', строка.trim().replace(/;.*$/u, ''), true);
    } else if ((м = РЕ_ВКЛ.exec(строка))) {
      включения.push(м[1]);
    }
    for (const п of строка.matchAll(РЕ_ПЕР)) {
      const глобальное = /^пер/u.test(строка);
      объявления.push({ имя: п[1], вид: 'пер', подпись: строка.trim().replace(/[ \t]*:=.*$/u, '').replace(/;.*$/u, ''),
        глобальное, uri, строка: номер, столбец: п.index + п[0].length - п[1].length });
    }
  });
  return { объявления, включения };
}

function текстФайла(uri) {
  const открытый = документы.get(uri);
  if (открытый) return открытый.getText();
  try { return fs.readFileSync(fileURLToPath(uri), 'utf8'); } catch (_) { return null; }
}

// Объявления файла и всех файлов, включённых через «вкл» (рекурсивно).
function объявленияДоступные(документ) {
  const файл = fileURLToPath(документ.uri);
  const cwd = папкаЗапуска(файл);
  const увиденные = new Set([документ.uri]);
  const локальные = разобрать(документ.getText(), документ.uri);
  const внешние = [];
  const очередь = [...локальные.включения];
  while (очередь.length) {
    const имя = очередь.shift();
    for (const каталог of [cwd, path.join(cwd, 'модули')]) {
      const путь = path.join(каталог, имя + '.цуя');
      const uri = pathToFileURL(путь).toString();
      if (увиденные.has(uri)) break;
      const текст = текстФайла(uri);
      if (текст === null) continue;
      увиденные.add(uri);
      const результат = разобрать(текст, uri);
      внешние.push(...результат.объявления.filter(о => о.глобальное || о.вид === 'поле'));
      очередь.push(...результат.включения);
      break;
    }
  }
  return { локальные: локальные.объявления, внешние };
}

const ВИД_СИМВОЛА = { про: SymbolKind.Function, структ: SymbolKind.Struct, конст: SymbolKind.Constant };

соединение.onDocumentSymbol(({ textDocument }) => {
  const документ = документы.get(textDocument.uri);
  if (!документ) return [];
  return разобрать(документ.getText(), документ.uri).объявления
    .filter(о => о.вид in ВИД_СИМВОЛА)
    .map(о => {
      const range = { start: { line: о.строка, character: о.столбец }, end: { line: о.строка, character: о.столбец + о.имя.length } };
      return { name: о.имя, kind: ВИД_СИМВОЛА[о.вид], range, selectionRange: range };
    });
});

// ---- Автодополнение, переход к объявлению, подсказка ----

const КЛЮЧЕВЫЕ_СЛОВА = ['пер', 'про', 'конст', 'структ', 'вкл', 'внешняя', 'библ', 'если', 'то', 'иначе', 'пока', 'для',
  'вернуть', 'вилка', 'когда', 'любое', 'нч', 'кц', 'и', 'или', 'либо', 'лбс', 'пбс', 'ост', 'как', 'истина', 'ложь'];
const ТИПЫ = ['цел', 'цел64', 'нат', 'нат64', 'нат8', 'вещ', 'вещ32', 'строка', 'лог', 'массив', 'срез'];
const ВСТРОЕННЫЕ = ['печать', 'ввод', 'срез', 'сисвызов', 'размер', 'адрес'];

const ВИД_ДОПОЛНЕНИЯ = {
  про: CompletionItemKind.Function, структ: CompletionItemKind.Struct, конст: CompletionItemKind.Constant,
  пер: CompletionItemKind.Variable, поле: CompletionItemKind.Field,
};

function слово(документ, позиция) {
  const текст = документ.getText().split('\n')[позиция.line] || '';
  for (const м of текст.matchAll(new RegExp(ИДЕНТ, 'gu'))) {
    if (м.index <= позиция.character && позиция.character <= м.index + м[0].length) return м[0];
  }
  return null;
}

// Ближайшее объявление: локальное выше курсора, затем глобальное этого файла, затем из включённых.
function найтиОбъявление(документ, позиция, имя) {
  const { локальные, внешние } = объявленияДоступные(документ);
  const подходящие = локальные.filter(о => о.имя === имя && о.вид !== 'поле');
  const выше = подходящие.filter(о => !о.глобальное && о.строка <= позиция.line).pop();
  return выше || подходящие.find(о => о.глобальное) || внешние.find(о => о.имя === имя && о.вид !== 'поле')
    || подходящие[0];
}

соединение.onCompletion(({ textDocument, position }) => {
  const документ = документы.get(textDocument.uri);
  if (!документ) return [];
  const { локальные, внешние } = объявленияДоступные(документ);
  const все = [...локальные, ...внешние];
  const доКурсора = (документ.getText().split('\n')[position.line] || '').slice(0, position.character);
  const уникальные = (список, вид) => {
    const видны = new Set();
    return список.filter(о => !видны.has(о.имя) && видны.add(о.имя)).map(о => ({
      label: о.имя, kind: вид(о), detail: о.подпись,
    }));
  };
  if (new RegExp(`(${ИДЕНТ}|\\))?\\.$`, 'u').test(доКурсора) && !доКурсора.endsWith('..')) {
    return уникальные(все.filter(о => о.вид === 'поле'), () => CompletionItemKind.Field);
  }
  return [
    ...КЛЮЧЕВЫЕ_СЛОВА.map(label => ({ label, kind: CompletionItemKind.Keyword })),
    ...ТИПЫ.map(label => ({ label, kind: CompletionItemKind.Class })),
    ...ВСТРОЕННЫЕ.map(label => ({ label, kind: CompletionItemKind.Function })),
    ...уникальные(все.filter(о => о.вид !== 'поле'), о => ВИД_ДОПОЛНЕНИЯ[о.вид]),
  ];
});

соединение.onDefinition(({ textDocument, position }) => {
  const документ = документы.get(textDocument.uri);
  const имя = документ && слово(документ, position);
  const о = имя && найтиОбъявление(документ, position, имя);
  if (!о) return null;
  const range = { start: { line: о.строка, character: о.столбец }, end: { line: о.строка, character: о.столбец + о.имя.length } };
  return { uri: о.uri, range };
});

соединение.onHover(({ textDocument, position }) => {
  const документ = документы.get(textDocument.uri);
  const имя = документ && слово(документ, position);
  if (!имя) return null;
  const о = найтиОбъявление(документ, position, имя);
  if (!о) return null;
  return { contents: { kind: MarkupKind.Markdown, value: '```tsuya\n' + о.подпись + '\n```' } };
});

документы.listen(соединение);
соединение.listen();
