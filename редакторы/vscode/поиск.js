// Общий поиск компилятора «цуяк» для клиента и сервера: сначала встроенный в расширение
// (bin/tsuyak, кладётся при сборке релиза), затем PATH.
const fs = require('fs');
const path = require('path');

function найтиКомпилятор() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const кандидаты = [path.join(__dirname, 'bin', 'tsuyak' + exe)];
  for (const папка of (process.env.PATH || '').split(path.delimiter)) {
    if (папка) кандидаты.push(path.join(папка, 'цуяк' + exe));
  }
  return кандидаты.find(к => {
    try {
      fs.accessSync(к, fs.constants.X_OK);
      return fs.statSync(к).isFile();
    } catch (_) { return false; }
  }) || null;
}

// Компилятор ищет модули в «.» и «./модули» относительно текущей папки, поэтому
// запускать его нужно из папки проекта: берём корень рабочего пространства, а если
// в нём нет «модули» (например, открыта только папка с примерами) — ближайшую
// родительскую папку файла, где она есть.
function папкаЗапуска(файл, корни) {
  const корень = корни.find(к => файл.startsWith(к + path.sep));
  const кандидаты = [];
  if (корень) кандидаты.push(корень);
  for (let папка = path.dirname(файл); ; папка = path.dirname(папка)) {
    кандидаты.push(папка);
    if (папка === path.dirname(папка)) break;
  }
  const сМодулями = кандидаты.find(к => {
    try { return fs.statSync(path.join(к, 'модули')).isDirectory(); } catch (_) { return false; }
  });
  return сМодулями || корень || path.dirname(файл);
}

module.exports = { найтиКомпилятор, папкаЗапуска };
