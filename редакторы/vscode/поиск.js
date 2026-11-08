// Общий поиск компилятора «цуяк» в PATH для клиента и сервера.
const fs = require('fs');
const path = require('path');

function найтиКомпилятор() {
  const имя = process.platform === 'win32' ? 'цуяк.exe' : 'цуяк';
  for (const папка of (process.env.PATH || '').split(path.delimiter)) {
    if (!папка) continue;
    const кандидат = path.join(папка, имя);
    try {
      fs.accessSync(кандидат, fs.constants.X_OK);
      if (fs.statSync(кандидат).isFile()) return кандидат;
    } catch (_) { /* не подходит, ищем дальше */ }
  }
  return null;
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
