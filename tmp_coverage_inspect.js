const c = require('./coverage/coverage-final.json');
const key = Object.keys(c).find((k) => k.endsWith('localRepository.ts'));
const data = c[key];
const branchMap = data.branchMap;
const b = data.b;
for (const id in branchMap) {
  const bm = branchMap[id];
  const counts = b[id];
  counts.forEach((cnt, i) => {
    if (cnt === 0) {
      const loc = bm.locations[i];
      console.log('branch', id, i, bm.type, 'line', loc.start.line);
    }
  });
}
