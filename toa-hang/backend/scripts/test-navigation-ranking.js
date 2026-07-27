'use strict';

const assert = require('assert');
const { normalizeText, textTokens } = require('../src/utils/navigationText');
const { __test } = require('../src/services/navigationIndex');

function doc({ id, key, code, source, title, subtitle = '', hidden = [] }) {
  const visible = [code, title, subtitle].filter(Boolean).join(' ');
  const all = [visible, ...hidden].join(' ');
  return {
    id,
    document_key: key,
    source_name: source,
    primary_code: code,
    primary_code_norm: String(code).replace(/[^A-Z0-9]/gi, '').toUpperCase(),
    title,
    subtitle,
    visible_text_norm: normalizeText(visible),
    search_text_norm: normalizeText(all),
    visible_tokens: textTokens(visible),
    tokens: textTokens(all),
    history_count: 0,
    history_qty: 0,
    stock_company: 0,
    stock_win: 0,
    cost_hint: 0,
    business_score: 0,
    payload: {},
  };
}

const query = 'rotuyn mazda 2010';
const tokens = textTokens(query);
const qNorm = normalizeText(query);

const onlyRotuyn = doc({ id: 1, key: 'MISA:A', code: 'A', source: 'MISA', title: 'Rotuyn trụ A' });
const rotuynMazda = doc({ id: 2, key: 'MISA:B', code: 'B', source: 'MISA', title: 'Rotuyn lái ngoài Mazda CX5' });
const fullVisible = doc({ id: 3, key: 'QLDH:C', code: 'C', source: 'QLĐH', title: 'ROTUYN TRỤ MAZDA 2010' });
const fullHidden = doc({
  id: 4,
  key: 'MISA:C',
  code: 'C',
  source: 'MISA',
  title: 'Rotuyn trụ C',
  hidden: ['ROTUYN TRỤ MAZDA 2010'],
});

const m1 = __test.evaluateContentMatch(onlyRotuyn, tokens, qNorm);
const m2 = __test.evaluateContentMatch(rotuynMazda, tokens, qNorm);
const m3 = __test.evaluateContentMatch(fullVisible, tokens, qNorm);
const m4 = __test.evaluateContentMatch(fullHidden, tokens, qNorm);

assert.equal(m1.matched_count, 1, 'Dòng chỉ có ROTUYN phải là 1/3');
assert.equal(m2.matched_count, 2, 'Dòng ROTUYN + MAZDA phải là 2/3');
assert.equal(m3.matched_count, 3, 'Dòng đủ ba token phải là 3/3');
assert.equal(m4.matched_count, 3, 'Dữ liệu ẩn vẫn là ứng viên 3/3');
assert(m2.score > m1.score, '2/3 phải có điểm cao hơn 1/3');
assert(m3.visible_match_count > m4.visible_match_count, 'Bằng chứng hiển thị phải được ưu tiên');

function result(d, m) {
  return {
    document_id: d.id,
    document_key: d.document_key,
    canonical_code: d.primary_code_norm,
    primary_code: d.primary_code,
    source_name: d.source_name,
    source_names: [d.source_name],
    title: d.title,
    subtitle: d.subtitle,
    score: m.score,
    matched_count: m.matched_count,
    query_token_count: m.query_token_count,
    exact_count: m.exact_count,
    visible_match_count: m.visible_match_count,
    phrase_match: m.phrase_match,
    business_rank: 0,
    interaction_rank: 0,
    history_count: 0,
    history_qty: 0,
    stock_company: 0,
    stock_win: 0,
    cost_hint: 0,
  };
}

const merged = __test.mergeNavigationResults([
  result(fullHidden, m4),
  result(fullVisible, m3),
  result(rotuynMazda, m2),
  result(onlyRotuyn, m1),
], 'content');

assert.equal(merged[0].canonical_code, 'C', 'Mã khớp 3/3 phải đứng đầu');
assert.equal(merged[0].source_names.length, 2, 'Cùng mã phải gộp nguồn');
assert.equal(merged[0].title, fullVisible.title, 'Đại diện phải là dòng có bằng chứng nhìn thấy tốt nhất');
assert.equal(merged[1].canonical_code, 'B', '2/3 phải đứng trên 1/3');
assert.equal(merged[2].canonical_code, 'A', '1/3 phải đứng sau');

console.log('✓ Navigation ranking tests passed');
