const asar = require('@electron/asar');
const p = 'F:/backup/windowsapps/installed/daymark/resources/app.asar';
const norm = f => f.split('\\').join('/');
const name = norm(asar.listPackage(p).find(f => /index-.*\.css/.test(f)));
const c = asar.extractFile(p, name).toString();
console.log('yellow:', c.includes('e0a92b'), '| is-interval:', c.includes('is-interval'));
for (const f of asar.listPackage(p).filter(f => /index-.*\.js/.test(f))) {
  const s = asar.extractFile(p, norm(f)).toString();
  if (s.includes('is-interval')) {
    console.log(f, '| active-class:', s.includes('board-column__auto--active'), '| force fn:', s.includes('readAutoIntervalMinutes'));
  }
}
