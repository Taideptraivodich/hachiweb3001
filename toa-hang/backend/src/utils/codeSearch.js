'use strict';

/**
 * Chuẩn hóa và chấm điểm mã phụ tùng.
 *
 * Nguyên tắc an toàn:
 * - Kết quả gần đúng chỉ để tham khảo, không tự coi là cùng một sản phẩm.
 * - Mọi phép biến đổi đều trả lại lý do để UI giải thích cho người dùng.
 */

const SAFE_ALIAS_SEPARATORS = /[\/;,=\n\r]+/g;

function cleanRaw(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function compactCode(value) {
  return cleanRaw(value).replace(/\s+/g, '');
}

function normalizeCode(value) {
  return compactCode(value).replace(/[^A-Z0-9]/g, '');
}

function splitCodeAliases(value) {
  const source = String(value ?? '').trim().toUpperCase();
  const raw = cleanRaw(source);
  if (!raw) return [];

  // Tách trên chuỗi gốc trước khi cleanRaw gộp newline thành khoảng trắng.
  const parts = source
    .split(SAFE_ALIAS_SEPARATORS)
    .map(cleanRaw)
    .filter(Boolean);

  return [...new Set([raw, ...parts])];
}

function stripLikelyGroupPrefix(value) {
  const raw = compactCode(value);
  const m = raw.match(/^([A-Z]{2,8})[-_. ]+(.+)$/);
  if (!m) return null;

  const prefix = m[1];
  const rest = m[2];
  if (!/[0-9]/.test(rest) || rest.length < 3) return null;
  return { prefix, rest };
}

function buildVariants(value) {
  const raw = cleanRaw(value);
  const variants = [];
  const seen = new Set();

  function add(v, kind, reason, penalty = 0) {
    const normalized = normalizeCode(v);
    if (!normalized || seen.has(`${kind}:${normalized}`)) return;
    seen.add(`${kind}:${normalized}`);
    variants.push({ raw: cleanRaw(v), normalized, kind, reason, penalty });
  }

  add(raw, 'raw', 'Trùng mã nguyên bản', 0);
  add(compactCode(raw), 'compact', 'Bỏ khoảng trắng', 2);

  for (const alias of splitCodeAliases(raw)) {
    add(alias, 'token', 'Tách mã trong ô có nhiều mã', 4);
  }

  const stripped = stripLikelyGroupPrefix(raw);
  if (stripped) {
    add(
      stripped.rest,
      'prefix_stripped',
      `Bỏ tiền tố nhóm “${stripped.prefix}”`,
      10,
    );
  }

  return variants;
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  const curr = new Array(t.length + 1);

  for (let i = 1; i <= s.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= t.length; j++) prev[j] = curr[j];
  }
  return prev[t.length];
}

function similarity(a, b) {
  const aa = normalizeCode(a);
  const bb = normalizeCode(b);
  if (!aa || !bb) return 0;
  const maxLen = Math.max(aa.length, bb.length);
  return maxLen === 0 ? 1 : 1 - levenshtein(aa, bb) / maxLen;
}

/**
 * Chấm điểm query so với một chuỗi mã trong dữ liệu.
 * Trả null khi không đủ gần để hiển thị.
 */
function scoreCode(query, target) {
  const queryVariants = buildVariants(query);
  const targetAliases = splitCodeAliases(target);
  const targetVariants = [];

  for (const alias of targetAliases) {
    const raw = cleanRaw(alias);
    const normalized = normalizeCode(alias);
    if (!normalized) continue;
    targetVariants.push({ raw, normalized, isToken: alias !== cleanRaw(target) });
  }

  let best = null;

  for (const qv of queryVariants) {
    for (const tv of targetVariants) {
      let score = 0;
      let reason = '';
      let group = 'fuzzy';

      if (cleanRaw(qv.raw) === cleanRaw(tv.raw)) {
        score = 100 - qv.penalty;
        reason = qv.kind === 'raw' ? 'Trùng mã nguyên bản' : qv.reason;
        group = score >= 95 ? 'exact' : 'alias';
      } else if (qv.normalized === tv.normalized) {
        score = 96 - qv.penalty - (tv.isToken ? 1 : 0);
        reason = [qv.reason, tv.isToken ? `Khớp bí danh “${tv.raw}” trong ô nhiều mã` : 'Bỏ dấu gạch/khoảng trắng']
          .filter(Boolean)
          .join(' · ');
        group = score >= 92 ? 'exact' : 'alias';
      } else if (
        qv.normalized.length >= 4 &&
        tv.normalized.length >= 4 &&
        (qv.normalized.includes(tv.normalized) || tv.normalized.includes(qv.normalized))
      ) {
        const shorter = Math.min(qv.normalized.length, tv.normalized.length);
        const longer = Math.max(qv.normalized.length, tv.normalized.length);
        const ratio = shorter / longer;
        if (ratio >= 0.72) {
          score = Math.round(74 * ratio) - qv.penalty;
          reason = 'Một mã chứa đầy đủ phần mã còn lại';
          group = 'fuzzy';
        }
      } else {
        const sim = similarity(qv.normalized, tv.normalized);
        const distance = levenshtein(qv.normalized, tv.normalized);
        const maxLen = Math.max(qv.normalized.length, tv.normalized.length);
        if (maxLen >= 4 && distance <= 2 && sim >= 0.72) {
          score = Math.round(sim * 65) - qv.penalty;
          reason = `Gần giống ${Math.round(sim * 100)}% (khác ${distance} ký tự)`;
          group = 'fuzzy';
        }
      }

      if (score > 0 && (!best || score > best.score)) {
        best = {
          score,
          group,
          reason,
          matched_target: tv.raw,
          query_variant: qv.raw,
          query_variant_kind: qv.kind,
        };
      }
    }
  }

  // Không trả kết quả quá yếu — tránh "rác" khi database lớn.
  if (!best || best.score < 45) return null;
  return best;
}

function inferCodeType(header = '', sheetName = '') {
  const h = cleanRaw(header);
  const s = cleanRaw(sheetName);
  if (h.includes('555') || s.includes('ROTUYN')) return '555';
  if (h.includes('MÃ MK') || h.includes('MA MK')) return 'MK';
  if (h.includes('SAKURA')) return 'SAKURA';
  if (h.includes('OEM') || h.includes('CHÍNH HÃNG')) return 'OEM';
  if (h.includes('KYB')) return 'KYB';
  if (h.includes('TOKICO') || s.includes('TOKICO')) return 'TOKICO';
  if (h.includes('PART NO')) return 'PART_NO';
  return 'KHAC';
}

module.exports = {
  cleanRaw,
  compactCode,
  normalizeCode,
  splitCodeAliases,
  stripLikelyGroupPrefix,
  buildVariants,
  levenshtein,
  similarity,
  scoreCode,
  inferCodeType,
};
