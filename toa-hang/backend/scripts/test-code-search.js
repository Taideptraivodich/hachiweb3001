const assert = require('assert');
const {
  normalizeCode,
  splitCodeAliases,
  scoreCode,
} = require('../src/utils/codeSearch');

assert.strictEqual(normalizeCode('HUB-MI-004'), 'HUBMI004');
assert.strictEqual(normalizeCode(' mi 004 '), 'MI004');
assert.deepStrictEqual(
  splitCodeAliases('C1147 / C1142').slice(1),
  ['C1147', 'C1142'],
);
assert.deepStrictEqual(
  splitCodeAliases('31470-12111\n31470-12140').slice(1),
  ['31470-12111', '31470-12140'],
);

const aliasMatch = scoreCode('HUB-MI-004', 'MI-004/MI004');
assert(aliasMatch, 'Phải tìm được mã cũ MI-004/MI004');
assert(aliasMatch.score >= 82, `Điểm alias quá thấp: ${aliasMatch.score}`);

const exactMatch = scoreCode('SR3880', 'SR-3880');
assert(exactMatch && exactMatch.score >= 92, 'Mã có/không dấu gạch phải khớp cao');

const fuzzyMatch = scoreCode('MI-004', 'MI-044');
assert(fuzzyMatch && fuzzyMatch.group === 'fuzzy', 'Sai 1 chữ số phải chỉ là gần đúng');

console.log('✅ codeSearch tests passed');
