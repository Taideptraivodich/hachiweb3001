'use strict';

const { normalizeCode, cleanRaw } = require('./codeSearch');

const STOP_TOKENS = new Set(['VA', 'HOAC', 'CHO', 'CUA', 'THEO']);

function removeDiacritics(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd');
}

function normalizeText(value) {
  return removeDiacritics(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textTokens(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return [...new Set(normalized.split(' ').filter(token => token.length >= 2 && !STOP_TOKENS.has(token)))];
}

/**
 * Trích các mã dạng C 2337 / SR-3880 / 04465-0K290 từ nội dung.
 * Luôn tạo cả dạng gốc lẫn dạng compact để C2237 tìm được C 2237.
 */
function extractEmbeddedCodes(value) {
  const raw = cleanRaw(value);
  if (!raw) return [];
  const found = new Set();
  const regex = /\b[A-Z]{1,6}(?:\s*[-_.\/]?\s*[A-Z0-9]{1,12}){1,4}\b/g;
  for (const match of raw.matchAll(regex)) {
    const candidate = cleanRaw(match[0]);
    const compact = normalizeCode(candidate);
    if (compact.length >= 3 && /\d/.test(compact)) {
      found.add(candidate);
      found.add(compact);
    }
  }
  return [...found];
}

function looksLikeCodeQuery(value) {
  const raw = cleanRaw(value);
  if (!raw || raw.includes(' ')) return false;
  const norm = normalizeCode(raw);
  return norm.length >= 3 && /\d/.test(norm) && norm.length <= 40;
}

function headerSignature(headers) {
  return headers.map(header => normalizeText(header)).join('|');
}

module.exports = {
  removeDiacritics,
  normalizeText,
  textTokens,
  extractEmbeddedCodes,
  looksLikeCodeQuery,
  headerSignature,
};
