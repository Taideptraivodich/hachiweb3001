const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { getDb, saveDb, dbQuery, dbGet, dbRun } = require('../sqlite');
const {
  cleanRaw,
  normalizeCode,
  splitCodeAliases,
  scoreCode,
  inferCodeType,
} = require('../utils/codeSearch');
const { rebuildSearchDocuments, loadMemoryIndex } = require('../services/navigationIndex');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function numberOrZero(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(value) {
  const v = cleanRaw(value);
  if (!v) return '';
  return v;
}

function normalizeMatchGroup(score) {
  if (score >= 92) return 'exact';
  if (score >= 72) return 'alias';
  return 'fuzzy';
}

function mode(values) {
  const counts = new Map();
  let bestValue = 0;
  let bestCount = 0;
  for (const raw of values) {
    const value = Number(raw || 0);
    if (!value) continue;
    const count = (counts.get(value) || 0) + 1;
    counts.set(value, count);
    if (count > bestCount || (count === bestCount && value > bestValue)) {
      bestCount = count;
      bestValue = value;
    }
  }
  return bestValue;
}

function median(values) {
  const sorted = values.map(Number).filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeWinPrice(value) {
  const n = numberOrZero(value);
  // Sheet WIN đang ghi giá theo đơn vị nghìn (227 = 227.000đ).
  return n > 0 && n < 10000 ? Math.round(n * 1000) : n;
}

function extractWinAliases(maWin, tenHang) {
  const aliases = new Set();
  if (maWin) aliases.add(cleanRaw(maWin));
  const text = String(tenHang || '').toUpperCase();
  const regex = /\b[A-Z]{1,3}\s*[-]?\s*\d{2,}[A-Z0-9-]*\b/g;
  for (const match of text.matchAll(regex)) {
    const raw = cleanRaw(match[0].replace(/\s+/g, ''));
    if (raw) aliases.add(raw);
  }
  return [...aliases];
}

function parseWinSheet(workbook) {
  const sheetName = findSheetName(workbook, ['WIN']);
  if (!sheetName) return { found: false, sheetName: null, rows: [], skipped: 0 };
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (!matrix.length) return { found: true, sheetName, rows: [], skipped: 0 };

  let headerIndex = matrix.findIndex(row => {
    const cells = row.map(normalizeHeader);
    return cells.some(cell => normalizeCode(cell) === 'TENHANGHOA') &&
      cells.some(cell => normalizeCode(cell) === 'CONLAI');
  });
  if (headerIndex < 0) headerIndex = 0;

  const headers = matrix[headerIndex].map(normalizeHeader);
  const headerMap = makeHeaderMap(headers);
  const col = {
    ma_win: 0,
    ten_hang: findHeaderIndex(headerMap, ['TÊN HÀNG HOÁ', 'TEN HANG HOA']),
    gia_thung: findHeaderIndex(headerMap, ['GIÁ THÙNG', 'GIA THUNG']),
    gia_le: findHeaderIndex(headerMap, ['GIÁ LẺ', 'GIA LE']),
    gia_hachi: findHeaderIndex(headerMap, ['GIÁ HACHI', 'GIA HACHI']),
    dvt: findHeaderIndex(headerMap, ['UNIT', 'ĐVT', 'DVT']),
    sl_ban_dau: findHeaderIndex(headerMap, ['SL BAN ĐẦU', 'SL BAN DAU']),
    so_luong: findHeaderIndex(headerMap, ['SỐ LƯỢNG', 'SO LUONG']),
    nhap_them: findHeaderIndex(headerMap, ['NHẬP THÊM', 'NHAP THEM']),
    tong_ban: findHeaderIndex(headerMap, ['TỔNG BÁN', 'TONG BAN']),
    con_lai: findHeaderIndex(headerMap, ['CÒN LẠI', 'CON LAI']),
  };
  if (col.ten_hang < 0 || col.con_lai < 0) {
    throw new Error(`Sheet ${sheetName} thiếu cột Tên hàng hoá hoặc Còn lại`);
  }
  const valueAt = (row, index) => index >= 0 ? row[index] : '';
  const rows = [];
  let skipped = 0;
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const maWin = cleanRaw(valueAt(row, col.ma_win));
    const tenHang = String(valueAt(row, col.ten_hang) || '').trim();
    if (!maWin && !tenHang) continue;
    if (!maWin) { skipped++; continue; }
    rows.push({
      ma_win: maWin,
      ma_win_norm: normalizeCode(maWin),
      ten_hang: tenHang,
      gia_thung: normalizeWinPrice(valueAt(row, col.gia_thung)),
      gia_le: normalizeWinPrice(valueAt(row, col.gia_le)),
      gia_hachi: normalizeWinPrice(valueAt(row, col.gia_hachi)),
      dvt: cleanRaw(valueAt(row, col.dvt)),
      sl_ban_dau: numberOrZero(valueAt(row, col.sl_ban_dau)),
      so_luong: numberOrZero(valueAt(row, col.so_luong)),
      nhap_them: numberOrZero(valueAt(row, col.nhap_them)),
      tong_ban: numberOrZero(valueAt(row, col.tong_ban)),
      con_lai: numberOrZero(valueAt(row, col.con_lai)),
      aliases: extractWinAliases(maWin, tenHang),
    });
  }
  return { found: true, sheetName, rows, skipped };
}

function replaceWinInventory(db, parsed) {
  if (!parsed.found) return { imported: 0, replaced: false };
  if (!parsed.rows.length) throw new Error(`Sheet ${parsed.sheetName} không có dòng WIN hợp lệ; dữ liệu cũ chưa bị xóa`);
  dbRun(db, 'DELETE FROM win_inventory');
  const sql = `
    INSERT INTO win_inventory (
      ma_win, ma_win_norm, ten_hang, gia_thung, gia_le, gia_hachi, dvt,
      sl_ban_dau, so_luong, nhap_them, tong_ban, con_lai, aliases_json,
      imported_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
  `;
  for (const row of parsed.rows) {
    dbRun(db, sql, [
      row.ma_win, row.ma_win_norm, row.ten_hang, row.gia_thung, row.gia_le,
      row.gia_hachi, row.dvt, row.sl_ban_dau, row.so_luong, row.nhap_them,
      row.tong_ban, row.con_lai, JSON.stringify(row.aliases || []),
    ]);
  }
  return { imported: parsed.rows.length, replaced: true };
}

function upsertMaNgoai(db, data) {
  const now = new Date().toISOString();
  const maHang = cleanRaw(data.ma_hang);
  const maNgoai = cleanRaw(data.ma_ngoai);
  dbRun(db, `
    INSERT INTO ma_ngoai (
      ma_hang, ma_ngoai, ma_hang_norm, ma_ngoai_norm, loai_ma,
      nha_cc, xe_ap_dung, vi_tri, gia_dai_ly, gia_thung, sl_thung,
      stock_ncc, trang_thai, ghi_chu, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ma_hang, ma_ngoai) DO UPDATE SET
      ma_hang_norm=excluded.ma_hang_norm,
      ma_ngoai_norm=excluded.ma_ngoai_norm,
      loai_ma=excluded.loai_ma,
      nha_cc=excluded.nha_cc,
      xe_ap_dung=excluded.xe_ap_dung,
      vi_tri=excluded.vi_tri,
      gia_dai_ly=excluded.gia_dai_ly,
      gia_thung=excluded.gia_thung,
      sl_thung=excluded.sl_thung,
      stock_ncc=excluded.stock_ncc,
      trang_thai=excluded.trang_thai,
      ghi_chu=excluded.ghi_chu,
      updated_at=excluded.updated_at
  `, [
    maHang,
    maNgoai,
    normalizeCode(maHang),
    normalizeCode(maNgoai),
    cleanRaw(data.loai_ma || 'KHAC') || 'KHAC',
    cleanRaw(data.nha_cc || ''),
    String(data.xe_ap_dung || '').trim(),
    String(data.vi_tri || '').trim(),
    numberOrZero(data.gia_dai_ly),
    numberOrZero(data.gia_thung),
    numberOrZero(data.sl_thung),
    normalizeStatus(data.stock_ncc),
    data.trang_thai || 'da_xac_nhan',
    String(data.ghi_chu || '').trim(),
    now,
  ]);
}

function buildSearchCorpus(db) {
  const products = dbQuery(db, `
    SELECT ma_hang, ten_hang, kho, dvt, ton_kho, gia_von
    FROM product_cache
  `, {});

  const external = dbQuery(db, `
    SELECT mn.*, p.ten_hang, p.kho, p.dvt, p.ton_kho, p.gia_von
    FROM ma_ngoai mn
    LEFT JOIN product_cache p ON p.ma_hang = mn.ma_hang
    WHERE COALESCE(mn.trang_thai, 'da_xac_nhan') != 'vo_hieu'
  `, {});

  const aliases = dbQuery(db, `
    SELECT pa.*, p.ten_hang, p.kho, p.dvt, p.ton_kho, p.gia_von
    FROM product_aliases pa
    LEFT JOIN product_cache p ON p.ma_hang = pa.ma_hang
    WHERE COALESCE(pa.trang_thai, 'da_xac_nhan') = 'da_xac_nhan'
  `, {});

  const winInventory = dbQuery(db, `
    SELECT * FROM win_inventory ORDER BY con_lai DESC, ma_win
  `, {});
  for (const row of winInventory) {
    try { row.aliases = JSON.parse(row.aliases_json || '[]'); }
    catch { row.aliases = []; }
  }

  const historyCodes = dbQuery(db, `
    SELECT ma_hang,
           MAX(mo_ta) AS mo_ta,
           MAX(hang_sx) AS hang_sx,
           COUNT(*) AS so_dong,
           SUM(COALESCE(so_luong, 0)) AS tong_so_luong
    FROM sales_history
    WHERE ma_hang IS NOT NULL AND TRIM(ma_hang) != ''
    GROUP BY ma_hang
  `, {});

  return { products, external, aliases, historyCodes, winInventory };
}

function addOrMergeCandidate(map, candidate) {
  const key = candidate.key;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...candidate,
      reasons: candidate.reasons || [],
      external_refs: candidate.external_refs || [],
      aliases: candidate.aliases || [],
      history_codes: candidate.history_codes || [],
    });
    return;
  }

  if (candidate.score > existing.score) {
    existing.score = candidate.score;
    existing.match_group = candidate.match_group;
    existing.match_target = candidate.match_target || existing.match_target;
  }
  for (const reason of candidate.reasons || []) {
    if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
  }
  for (const ref of candidate.external_refs || []) {
    if (!existing.external_refs.some(x => x.id === ref.id)) existing.external_refs.push(ref);
  }
  for (const alias of candidate.aliases || []) {
    if (!existing.aliases.includes(alias)) existing.aliases.push(alias);
  }
}

function attachHistoryCodes(candidates, historyCodes, query) {
  for (const candidate of candidates) {
    const anchors = [
      candidate.ma_hang,
      candidate.direct_code,
      ...(candidate.aliases || []),
      ...(candidate.external_refs || []).map(r => r.ma_ngoai),
    ].filter(Boolean);

    const attached = [];
    for (const history of historyCodes) {
      let best = null;
      for (const anchor of anchors) {
        const scored = scoreCode(anchor, history.ma_hang);
        if (scored && (!best || scored.score > best.score)) best = scored;
      }
      if (best && best.score >= 82) {
        attached.push({
          code: history.ma_hang,
          score: best.score,
          reason: best.reason,
          so_dong: Number(history.so_dong || 0),
          tong_so_luong: Number(history.tong_so_luong || 0),
          mo_ta: history.mo_ta || '',
          hang_sx: history.hang_sx || '',
          confirmed: (candidate.aliases || []).some(a => normalizeCode(a) === normalizeCode(history.ma_hang)),
        });
      }
    }

    attached.sort((a, b) => b.score - a.score || b.so_dong - a.so_dong);
    candidate.history_matches = attached.slice(0, 20);
    candidate.history_codes = [...new Set(attached.filter(x => x.score >= 82).map(x => x.code))];
    candidate.history_count = attached.reduce((sum, x) => sum + x.so_dong, 0);
  }
}


function attachWinInventory(candidates, winInventory, query) {
  for (const candidate of candidates) {
    const anchors = [
      query,
      candidate.ma_hang,
      candidate.direct_code,
      ...(candidate.aliases || []),
      ...(candidate.external_refs || []).flatMap(r => [r.ma_ngoai, r.ma_hang]),
      ...(candidate.history_codes || []),
    ].filter(Boolean);
    const matches = [];
    for (const row of winInventory) {
      const targets = [row.ma_win, ...(row.aliases || [])].filter(Boolean);
      let best = null;
      for (const anchor of anchors) {
        for (const target of targets) {
          const scored = scoreCode(anchor, target);
          if (scored && (!best || scored.score > best.score)) best = { ...scored, target };
        }
      }
      if (best && best.score >= 82) {
        matches.push({
          ...row,
          score: best.score,
          reason: best.reason,
          matched_target: best.target,
          match_group: normalizeMatchGroup(best.score),
        });
      }
    }
    matches.sort((a, b) => b.score - a.score || Number(b.con_lai || 0) - Number(a.con_lai || 0));
    candidate.win_matches = matches.slice(0, 12);
  }
}

// ── GET /api/ma-ngoai/lookup?q=... ──────────────────────────────────────────
// Màn hình tra cứu nghiệp vụ: tìm chính xác → bí danh → gần đúng.
router.get('/lookup', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'Nhập ít nhất 2 ký tự mã' });

    const db = await getDb();
    const { products, external, aliases, historyCodes, winInventory } = buildSearchCorpus(db);
    const candidates = new Map();

    // 1) Mã tồn kho MISA — ứng viên chính xác nhất khi user nhập đúng mã kho.
    for (const product of products) {
      const match = scoreCode(q, product.ma_hang);
      if (!match) continue;
      addOrMergeCandidate(candidates, {
        key: `product:${normalizeCode(product.ma_hang)}`,
        ma_hang: product.ma_hang,
        direct_code: product.ma_hang,
        ten_hang: product.ten_hang || '',
        kho_cache: product.kho || '',
        ton_kho_cache: Number(product.ton_kho || 0),
        gia_von_cache: Number(product.gia_von || 0),
        score: match.score,
        match_group: normalizeMatchGroup(match.score),
        match_target: match.matched_target,
        conversion_applied: false,
        requires_user_choice: match.score < 92,
        reasons: [match.reason],
      });
    }

    // 2) Bí danh đã được người dùng xác nhận — được phép nối về mã chuẩn.
    for (const alias of aliases) {
      const match = scoreCode(q, alias.alias_raw);
      if (!match) continue;
      addOrMergeCandidate(candidates, {
        key: `product:${normalizeCode(alias.ma_hang)}`,
        ma_hang: alias.ma_hang,
        direct_code: alias.ma_hang,
        ten_hang: alias.ten_hang || '',
        kho_cache: alias.kho || '',
        ton_kho_cache: Number(alias.ton_kho || 0),
        gia_von_cache: Number(alias.gia_von || 0),
        score: Math.min(98, match.score + 2),
        match_group: match.score >= 82 ? 'alias' : 'fuzzy',
        match_target: alias.alias_raw,
        conversion_applied: true,
        conversion_kind: 'confirmed_alias',
        requires_user_choice: false,
        reasons: [`Bí danh đã xác nhận “${alias.alias_raw}” → ${alias.ma_hang}`, match.reason],
        aliases: [alias.alias_raw],
      });
    }

    // 3) Mã ngoài. Chỉ loại 555 được tự quy đổi sang mã Aisin/mã kho.
    for (const row of external) {
      const matchOutside = scoreCode(q, row.ma_ngoai);
      const matchInside = scoreCode(q, row.ma_hang);
      const codeType = cleanRaw(row.loai_ma || 'KHAC') || 'KHAC';

      if (matchOutside) {
        if (codeType === '555') {
          addOrMergeCandidate(candidates, {
            key: `product:${normalizeCode(row.ma_hang)}`,
            ma_hang: row.ma_hang,
            direct_code: row.ma_hang,
            ten_hang: row.ten_hang || '',
            kho_cache: row.kho || '',
            ton_kho_cache: Number(row.ton_kho || 0),
            gia_von_cache: Number(row.gia_von || 0),
            score: Math.min(100, matchOutside.score + 2),
            match_group: normalizeMatchGroup(Math.min(100, matchOutside.score + 2)),
            match_target: row.ma_ngoai,
            conversion_applied: true,
            conversion_kind: '555_to_aisin',
            requires_user_choice: matchOutside.score < 92,
            reasons: [`Mã 555 ${row.ma_ngoai} → mã Aisin/kho ${row.ma_hang}`, matchOutside.reason],
            external_refs: [row],
          });
        } else {
          // MK/KYB/OEM/...: ưu tiên tìm trực tiếp đúng mã ngoài trong lịch sử.
          addOrMergeCandidate(candidates, {
            key: `direct:${normalizeCode(row.ma_ngoai)}`,
            ma_hang: row.ma_ngoai,
            direct_code: row.ma_ngoai,
            reference_ma_hang: row.ma_hang,
            ten_hang: row.ten_hang || row.xe_ap_dung || '',
            score: matchOutside.score,
            match_group: normalizeMatchGroup(matchOutside.score),
            match_target: row.ma_ngoai,
            conversion_applied: false,
            requires_user_choice: matchOutside.score < 92,
            reasons: [`Mã ${codeType} được tìm trực tiếp; không tự quy đổi`, matchOutside.reason],
            external_refs: [row],
          });

          // Vẫn cho user thấy mã kho đã mapping như một lựa chọn riêng, không tự chọn.
          if (row.ma_hang && normalizeCode(row.ma_hang) !== normalizeCode(row.ma_ngoai)) {
            addOrMergeCandidate(candidates, {
              key: `product:${normalizeCode(row.ma_hang)}`,
              ma_hang: row.ma_hang,
              direct_code: row.ma_hang,
              ten_hang: row.ten_hang || '',
              kho_cache: row.kho || '',
              ton_kho_cache: Number(row.ton_kho || 0),
              gia_von_cache: Number(row.gia_von || 0),
              score: Math.max(55, matchOutside.score - 18),
              match_group: 'fuzzy',
              match_target: row.ma_hang,
              conversion_applied: false,
              requires_user_choice: true,
              reasons: [`Mã kho tham khảo đã mapping: ${row.ma_hang} (không tự chuyển vì không phải 555)`],
              external_refs: [row],
            });
          }
        }
      }

      if (matchInside) {
        addOrMergeCandidate(candidates, {
          key: `product:${normalizeCode(row.ma_hang)}`,
          ma_hang: row.ma_hang,
          direct_code: row.ma_hang,
          ten_hang: row.ten_hang || '',
          kho_cache: row.kho || '',
          ton_kho_cache: Number(row.ton_kho || 0),
          gia_von_cache: Number(row.gia_von || 0),
          score: matchInside.score,
          match_group: normalizeMatchGroup(matchInside.score),
          match_target: row.ma_hang,
          conversion_applied: false,
          requires_user_choice: matchInside.score < 92,
          reasons: [matchInside.reason],
          external_refs: [row],
        });
      }
    }

    // 4) Kho Win Win: tìm theo mã WIN và các mã hãng nằm trong tên hàng.
    for (const row of winInventory) {
      const targets = [row.ma_win, ...(row.aliases || [])].filter(Boolean);
      let best = null;
      for (const target of targets) {
        const match = scoreCode(q, target);
        if (match && (!best || match.score > best.score)) best = { ...match, target };
      }
      if (!best) continue;
      addOrMergeCandidate(candidates, {
        key: `win:${normalizeCode(row.ma_win)}`,
        ma_hang: row.ma_win,
        direct_code: row.ma_win,
        ten_hang: row.ten_hang || '',
        score: best.score,
        match_group: normalizeMatchGroup(best.score),
        match_target: best.target,
        conversion_applied: false,
        requires_user_choice: best.score < 92,
        source_kind: 'win_inventory',
        reasons: [`Tìm thấy trong kho Win Win qua mã “${best.target}”`, best.reason],
        aliases: row.aliases || [],
        win_matches: [{ ...row, score: best.score, reason: best.reason, matched_target: best.target }],
      });
    }

    // 5) Lịch sử QLĐH có thể chứa tên/mã cũ chưa hề có trong product_cache.
    for (const history of historyCodes) {
      const match = scoreCode(q, history.ma_hang);
      if (!match) continue;
      addOrMergeCandidate(candidates, {
        key: `history:${normalizeCode(history.ma_hang)}:${cleanRaw(history.ma_hang)}`,
        ma_hang: history.ma_hang,
        direct_code: history.ma_hang,
        ten_hang: history.mo_ta || '',
        hang_sx: history.hang_sx || '',
        score: match.score,
        match_group: normalizeMatchGroup(match.score),
        match_target: history.ma_hang,
        conversion_applied: false,
        requires_user_choice: match.score < 92,
        reasons: [`Tìm thấy trong lịch sử QLĐH`, match.reason],
        history_codes: [history.ma_hang],
        history_count: Number(history.so_dong || 0),
      });
    }

    let result = [...candidates.values()];
    attachHistoryCodes(result, historyCodes, q);
    attachWinInventory(result, winInventory, q);

    // Không để candidate lịch sử trùng nội dung lấn át mã chuẩn đã gom được chính mã lịch sử đó.
    result = result.filter((candidate, index, arr) => {
      if (!candidate.key.startsWith('history:')) return true;
      return !arr.some(other =>
        !other.key.startsWith('history:') &&
        (other.history_codes || []).some(code => cleanRaw(code) === cleanRaw(candidate.ma_hang)) &&
        other.score >= candidate.score
      );
    });

    // Nếu một mã 555 chính xác trả nhiều mapping, bắt buộc người dùng chọn.
    const exact555 = result.filter(item =>
      item.conversion_kind === '555_to_aisin' && item.score >= 92
    );
    if (exact555.length > 1) {
      exact555.forEach(item => {
        item.requires_user_choice = true;
        if (!item.reasons.includes('Mã 555 có nhiều mapping — cần chọn theo ứng dụng xe/VIN')) {
          item.reasons.push('Mã 555 có nhiều mapping — cần chọn theo ứng dụng xe/VIN');
        }
      });
    }

    result.sort((a, b) =>
      b.score - a.score ||
      Number(b.history_count || 0) - Number(a.history_count || 0) ||
      String(a.ma_hang).localeCompare(String(b.ma_hang))
    );

    db.close();

    res.json({
      query: q,
      query_normalized: normalizeCode(q),
      data: result.slice(0, 30),
      groups: {
        exact: result.filter(x => x.match_group === 'exact').length,
        alias: result.filter(x => x.match_group === 'alias').length,
        fuzzy: result.filter(x => x.match_group === 'fuzzy').length,
      },
      note: 'Kết quả gần đúng chỉ để tham khảo; người dùng phải xác nhận mã trước khi báo hàng.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ma-ngoai/lookup/detail ─────────────────────────────────────────
router.post('/lookup/detail', async (req, res) => {
  try {
    const maHang = cleanRaw(req.body.ma_hang || '');
    const requestedCodes = Array.isArray(req.body.history_codes) ? req.body.history_codes : [];
    const codes = [...new Set([maHang, ...requestedCodes].map(cleanRaw).filter(Boolean))].slice(0, 30);
    if (!codes.length) return res.status(400).json({ error: 'Thiếu mã cần xem lịch sử' });

    const db = await getDb();
    const placeholders = codes.map(() => '?').join(',');
    const rows = dbQuery(db, `
      SELECT id, stt, ma_hang, hang_sx, mo_ta, dvt, so_luong, don_gia,
             thanh_tien, ten_kh, gia_von, nha_cc, ghi_chu
      FROM sales_history
      WHERE UPPER(TRIM(ma_hang)) IN (${placeholders})
      ORDER BY stt DESC, id DESC
      LIMIT 3000
    `, codes.map(code => cleanRaw(code)));

    const quoteRows = dbQuery(db, `
      SELECT d.ma_hang, d.ten_hang, o.ten_kh, d.so_luong,
             d.don_gia_ban AS don_gia, d.so_luong * d.don_gia_ban AS thanh_tien,
             d.gia_von, d.nha_cung_cap AS nha_cc, o.ma_toa, o.ngay_tao
      FROM order_details d
      JOIN orders o ON o.id = d.order_id
      WHERE UPPER(TRIM(d.ma_hang)) IN (${placeholders})
        AND o.trang_thai != 'Đã hủy'
      ORDER BY o.id DESC
      LIMIT 500
    `, codes.map(code => cleanRaw(code)));

    db.close();

    const prices = rows.map(r => Number(r.don_gia || 0)).filter(v => v > 0);
    const customerMap = new Map();
    for (const row of rows) {
      const key = cleanRaw(row.ten_kh || '(Không tên)');
      if (!customerMap.has(key)) customerMap.set(key, { ten_kh: row.ten_kh || '(Không tên)', so_dong: 0, tong_sl: 0, prices: [] });
      const item = customerMap.get(key);
      item.so_dong += 1;
      item.tong_sl += Number(row.so_luong || 0);
      if (Number(row.don_gia || 0) > 0) item.prices.push(Number(row.don_gia));
    }

    const customers = [...customerMap.values()].map(item => ({
      ten_kh: item.ten_kh,
      so_dong: item.so_dong,
      tong_sl: item.tong_sl,
      gia_thap_nhat: item.prices.length ? Math.min(...item.prices) : 0,
      gia_cao_nhat: item.prices.length ? Math.max(...item.prices) : 0,
      gia_thuong_gap: mode(item.prices),
    })).sort((a, b) => b.so_dong - a.so_dong);

    res.json({
      ma_hang: maHang,
      history_codes: codes,
      sales: rows,
      quotes: quoteRows,
      customers,
      stats: {
        so_dong: rows.length,
        tong_so_luong: rows.reduce((sum, row) => sum + Number(row.so_luong || 0), 0),
        gia_thap_nhat: prices.length ? Math.min(...prices) : 0,
        gia_cao_nhat: prices.length ? Math.max(...prices) : 0,
        gia_trung_vi: median(prices),
        gia_thuong_gap: mode(prices),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/ma-ngoai/aliases — xác nhận tên/mã cũ ─────────────────────────
router.post('/aliases', async (req, res) => {
  try {
    const maHang = cleanRaw(req.body.ma_hang || '');
    const aliasRaw = cleanRaw(req.body.alias_raw || '');
    if (!maHang || !aliasRaw) return res.status(400).json({ error: 'Thiếu mã chuẩn hoặc bí danh' });

    const db = await getDb();
    dbRun(db, `
      INSERT INTO product_aliases
        (ma_hang, alias_raw, alias_norm, loai_alias, nguon, trang_thai, ghi_chu, created_by, updated_at)
      VALUES (?, ?, ?, ?, ?, 'da_xac_nhan', ?, ?, datetime('now','localtime'))
      ON CONFLICT(ma_hang, alias_norm) DO UPDATE SET
        alias_raw=excluded.alias_raw,
        loai_alias=excluded.loai_alias,
        nguon=excluded.nguon,
        trang_thai='da_xac_nhan',
        ghi_chu=excluded.ghi_chu,
        created_by=excluded.created_by,
        updated_at=datetime('now','localtime')
    `, [
      maHang,
      aliasRaw,
      normalizeCode(aliasRaw),
      req.body.loai_alias || 'ten_cu',
      req.body.nguon || 'tra_cuu',
      String(req.body.ghi_chu || '').trim(),
      String(req.body.created_by || '').trim(),
    ]);
    rebuildSearchDocuments(db);
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true, ma_hang: maHang, alias_raw: aliasRaw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/aliases/:ma_hang', async (req, res) => {
  try {
    const db = await getDb();
    const rows = dbQuery(db, `
      SELECT * FROM product_aliases WHERE ma_hang = ? ORDER BY created_at DESC
    `, [req.params.ma_hang]);
    db.close();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ma-ngoai — danh sách quản trị ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = await getDb();
    const { q, nha_cc, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = ['1=1'];
    const params = {};
    if (q) {
      where.push(`(
        mn.ma_hang LIKE $q OR mn.ma_ngoai LIKE $q OR p.ten_hang LIKE $q OR
        mn.xe_ap_dung LIKE $q OR mn.nha_cc LIKE $q OR mn.loai_ma LIKE $q
      )`);
      params.$q = `%${q}%`;
    }
    if (nha_cc) {
      where.push('mn.nha_cc = $nha_cc');
      params.$nha_cc = nha_cc;
    }

    const whereStr = where.join(' AND ');
    const total = dbGet(db, `
      SELECT COUNT(*) AS cnt FROM ma_ngoai mn
      LEFT JOIN product_cache p ON p.ma_hang = mn.ma_hang
      WHERE ${whereStr}
    `, params);

    const rows = dbQuery(db, `
      SELECT mn.*, p.ten_hang, p.ton_kho, p.gia_von
      FROM ma_ngoai mn
      LEFT JOIN product_cache p ON p.ma_hang = mn.ma_hang
      WHERE ${whereStr}
      ORDER BY mn.nha_cc, mn.ma_hang
      LIMIT $limit OFFSET $offset
    `, { ...params, $limit: parseInt(limit, 10), $offset: offset });

    const dsNhaCC = dbQuery(db, `
      SELECT DISTINCT nha_cc FROM ma_ngoai WHERE nha_cc != '' ORDER BY nha_cc
    `, {});

    db.close();
    res.json({ data: rows, total: total?.cnt || 0, dsNhaCC: dsNhaCC.map(r => r.nha_cc) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { ma_hang, ma_ngoai } = req.body;
    if (!ma_hang || !ma_ngoai) return res.status(400).json({ error: 'Thiếu ma_hang hoặc ma_ngoai' });
    const db = await getDb();
    upsertMaNgoai(db, req.body);
    rebuildSearchDocuments(db);
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const old = dbGet(db, `SELECT * FROM ma_ngoai WHERE id = ?`, [req.params.id]);
    if (!old) {
      db.close();
      return res.status(404).json({ error: 'Không tìm thấy mã ngoài' });
    }
    dbRun(db, `DELETE FROM ma_ngoai WHERE id = ?`, [req.params.id]);
    upsertMaNgoai(db, { ...old, ...req.body });
    rebuildSearchDocuments(db);
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    dbRun(db, `DELETE FROM ma_ngoai WHERE id = ?`, [req.params.id]);
    rebuildSearchDocuments(db);
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function normalizeHeader(value) {
  return cleanRaw(value).replace(/\n/g, ' ').replace(/\s+/g, ' ');
}


function findSheetName(workbook, names) {
  const wanted = new Set(names.map(name => normalizeCode(name)));
  return workbook.SheetNames.find(sheetName => wanted.has(normalizeCode(sheetName))) || null;
}

function makeHeaderMap(headers) {
  const map = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeCode(normalizeHeader(header));
    if (normalized && !map.has(normalized)) map.set(normalized, index);
  });
  return map;
}

function findHeaderIndex(headerMap, aliases) {
  for (const alias of aliases) {
    const exact = headerMap.get(normalizeCode(alias));
    if (exact !== undefined) return exact;
  }
  return -1;
}

function parseSalesHistorySheet(workbook) {
  const sheetName = findSheetName(workbook, ['QLĐH', 'QLDH']);
  if (!sheetName) return { found: false, sheetName: null, rows: [], skipped: 0 };

  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
  if (!matrix.length) return { found: true, sheetName, rows: [], skipped: 0 };

  let headerIndex = matrix.findIndex(row => {
    const cells = row.map(normalizeHeader);
    return cells.some(cell => normalizeCode(cell) === 'MAHANG') &&
      cells.some(cell => normalizeCode(cell) === 'TENKH');
  });
  if (headerIndex < 0) headerIndex = 0;

  const headers = matrix[headerIndex].map(normalizeHeader);
  const headerMap = makeHeaderMap(headers);
  const columns = {
    stt: findHeaderIndex(headerMap, ['STT']),
    ma_hang: findHeaderIndex(headerMap, ['MÃ HÀNG', 'MA HANG']),
    hang_sx: findHeaderIndex(headerMap, ['HÃNG SẢN XUẤT', 'HÃNG', 'HANG SAN XUAT', 'HANG']),
    mo_ta: findHeaderIndex(headerMap, ['MÔ TẢ', 'MO TA']),
    dvt: findHeaderIndex(headerMap, ['ĐVT', 'DVT']),
    so_luong: findHeaderIndex(headerMap, ['SL', 'SỐ LƯỢNG', 'SO LUONG']),
    don_gia: findHeaderIndex(headerMap, ['ĐƠN GIÁ', 'DON GIA']),
    thanh_tien: findHeaderIndex(headerMap, ['THÀNH TIỀN', 'THANH TIEN']),
    ten_kh: findHeaderIndex(headerMap, ['TÊN KH', 'TEN KH', 'TÊN KHÁCH HÀNG']),
    ma_kh: findHeaderIndex(headerMap, ['MÃ KH', 'MA KH']),
    ngay_xuat: findHeaderIndex(headerMap, ['NGÀY XUẤT HÀNG', 'NGAY XUAT HANG']),
    gia_von: findHeaderIndex(headerMap, ['GIÁ VỐN', 'GIA VON']),
    nha_cc: findHeaderIndex(headerMap, ['NHÀ CC', 'NHA CC', 'NHÀ CUNG CẤP']),
    ghi_chu: findHeaderIndex(headerMap, ['GHI CHÚ', 'GHI CHU']),
  };

  if (columns.ma_hang < 0) {
    throw new Error(`Sheet ${sheetName} không tìm thấy cột MÃ HÀNG`);
  }

  const valueAt = (row, index) => index >= 0 ? row[index] : '';
  const rows = [];
  let skipped = 0;
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const maHang = cleanRaw(valueAt(row, columns.ma_hang));
    if (!maHang) {
      if (row.some(cell => cleanRaw(cell))) skipped++;
      continue;
    }
    rows.push([
      numberOrZero(valueAt(row, columns.stt)),
      maHang,
      cleanRaw(valueAt(row, columns.hang_sx)),
      String(valueAt(row, columns.mo_ta) || '').trim(),
      cleanRaw(valueAt(row, columns.dvt)),
      numberOrZero(valueAt(row, columns.so_luong)),
      numberOrZero(valueAt(row, columns.don_gia)),
      numberOrZero(valueAt(row, columns.thanh_tien)),
      String(valueAt(row, columns.ten_kh) || '').trim(),
      cleanRaw(valueAt(row, columns.ma_kh)),
      valueAt(row, columns.ngay_xuat) ?? '',
      numberOrZero(valueAt(row, columns.gia_von)),
      cleanRaw(valueAt(row, columns.nha_cc)),
      String(valueAt(row, columns.ghi_chu) || '').trim(),
    ]);
  }
  return { found: true, sheetName, rows, skipped };
}

function replaceSalesHistory(db, parsed) {
  if (!parsed.found) return { imported: 0, replaced: false };
  if (!parsed.rows.length) {
    throw new Error(`Sheet ${parsed.sheetName} không có dòng lịch sử hợp lệ; dữ liệu cũ chưa bị xóa`);
  }

  dbRun(db, 'DELETE FROM sales_history');
  const sql = `
    INSERT INTO sales_history (
      stt, ma_hang, hang_sx, mo_ta, dvt, so_luong, don_gia,
      thanh_tien, ten_kh, ma_kh, ngay_xuat, gia_von, nha_cc, ghi_chu
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  for (const values of parsed.rows) dbRun(db, sql, values);
  return { imported: parsed.rows.length, replaced: true };
}

function detectSchema(rows, sheetName) {
  const normalizedRows = rows.slice(0, 15).map(row => row.map(normalizeHeader));
  const headerKeywords = [
    'MÃ ', 'MA ', 'TYPE', 'MODEL', 'POSITION', 'VỊ TRÍ', 'VI TRI',
    'LOẠI XE', 'LOAI XE', 'PART NO', 'GIÁ', 'GIA ', 'STOCK',
    'SL/', 'SL THÙNG', 'TÊN XE', 'TÊN SẢN PHẨM', 'XUẤT XỨ',
  ];

  // Một số sheet không có dòng header thực sự.
  if (cleanRaw(sheetName) === 'MITSUBOSHI') {
    return {
      headerIdx: -1,
      headers: [],
      colMaTonKho: 0,
      externalSpecs: [{ col: 0, type: 'MITSUBOSHI', header: 'MÃ MITSUBOSHI' }],
      colViTri: -1,
      colXeApDung: 3,
      colGiaDaiLy: 2,
      colGiaThung: -1,
      colSlThung: -1,
      colStock: 4,
    };
  }

  let headerIdx = 0;
  let bestScore = -1;
  let bestFilled = -1;
  normalizedRows.forEach((row, index) => {
    const filled = row.filter(Boolean).length;
    const keywordHits = row.reduce((sum, cell) => {
      if (!cell) return sum;
      return sum + (headerKeywords.some(keyword => cell.includes(keyword)) ? 1 : 0);
    }, 0);
    // Ưu tiên dòng có nhiều từ khóa header; số ô có dữ liệu chỉ dùng phá hòa.
    const score = keywordHits * 100 + Math.min(filled, 20);
    if (score > bestScore || (score === bestScore && filled > bestFilled)) {
      bestScore = score;
      bestFilled = filled;
      headerIdx = index;
    }
  });

  const headers = rows[headerIdx].map(normalizeHeader);
  const find = keywords => headers.findIndex(col =>
    keywords.some(keyword => col.includes(keyword))
  );

  const canonicalCandidates = [
    ['MÃ ROTUYN', 'MA ROTUYN'],
    ['TYPE'],
    ['MÃ SP', 'MA SP'],
    ['MÃ HÀNG', 'MA HANG'],
    ['SKU'],
  ];
  let colMaTonKho = -1;
  for (const keywords of canonicalCandidates) {
    colMaTonKho = find(keywords);
    if (colMaTonKho >= 0) break;
  }

  const externalSpecs = [];
  const externalDefinitions = [
    { keywords: ['MÃ 555', 'MA 555'], type: '555' },
    { keywords: ['MÃ MK', 'MA MK'], type: 'MK' },
    { keywords: ['MÃ SAKURA', 'MA SAKURA'], type: 'SAKURA' },
    { keywords: ['MÃ OEM', 'MA OEM', 'MÃ CHÍNH HÃNG', 'CHÍNH HÃNG'], type: 'OEM' },
    { keywords: ['PART NO'], type: 'PART_NO' },
  ];
  for (const definition of externalDefinitions) {
    const index = find(definition.keywords);
    if (index >= 0 && index !== colMaTonKho) {
      externalSpecs.push({ col: index, type: definition.type, header: headers[index] });
    }
  }

  const colViTri = find(['VỊ TRÍ', 'VI TRI', 'POSITION']);
  const colXeApDung = find(['LOẠI XE', 'LOAI XE', 'MODEL', 'XE ÁP DỤNG', 'TÊN XE']);
  const colGiaThung = find(['GIÁ THÙNG', 'GIA THUNG', 'GIÁ SL', 'GIÁ BÁN THEO THÙNG']);
  let colGiaDaiLy = find(['GIÁ ĐẠI LÝ', 'GIA DAI LY', 'GIÁ LẺ', 'GIA LE', 'GIÁ HACHI']);
  if (colGiaDaiLy < 0) {
    const genericPrice = headers.findIndex((col, index) =>
      index !== colGiaThung && (col === 'GIÁ' || /^GIÁ\s+[0-9]/.test(col))
    );
    colGiaDaiLy = genericPrice;
  }
  const colSlThung = find(['SL/ THÙNG', 'SL/THÙNG', 'SL THÙNG', 'SỐ LƯỢNG THÙNG', 'SL YÊU CẦU']);
  const colStock = find(['STOCK', 'END STOCK', 'TỒN', 'SỐ LƯỢNG']);

  // Nếu không có cột mã ngoài nhưng sheet bản thân là catalog mã hãng (TOKICO...).
  if (!externalSpecs.length && colMaTonKho >= 0) {
    externalSpecs.push({
      col: colMaTonKho,
      type: inferCodeType(headers[colMaTonKho], sheetName),
      header: headers[colMaTonKho],
    });
  }

  return {
    headerIdx,
    headers,
    colMaTonKho,
    externalSpecs,
    colViTri,
    colXeApDung,
    colGiaDaiLy,
    colGiaThung,
    colSlThung,
    colStock,
  };
}

function findBestProductMatch(code, productCodes) {
  const scored = productCodes
    .map(productCode => ({ productCode, match: scoreCode(code, productCode) }))
    .filter(item => item.match)
    .sort((a, b) => b.match.score - a.match.score);

  if (!scored.length) return null;
  if (scored[0].match.score >= 90 && (!scored[1] || scored[0].match.score - scored[1].match.score >= 5)) {
    return { ma_hang: scored[0].productCode, score: scored[0].match.score };
  }
  return {
    suggestions: scored.slice(0, 5).map(item => item.productCode),
    score: scored[0].match.score,
  };
}

router.post('/import', upload.single('file'), async (req, res) => {
  let db;
  try {
    if (!req.file) return res.status(400).json({ error: 'Chưa chọn file' });
    db = await getDb();
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const productCodes = dbQuery(db, `SELECT ma_hang FROM product_cache`, {}).map(row => row.ma_hang);
    const results = {
      sales_history: { found: false, sheet: null, imported: 0, skipped: 0, replaced: false },
      catalog: { matched: 0, unmatched: 0, skipped: 0, suggestions: [], sheets: [] },
      win_inventory: { found: false, sheet: null, imported: 0, skipped: 0, replaced: false },
    };

    // Một lần import cập nhật đồng thời lịch sử QLĐH và catalog nhà cung cấp.
    // Dùng transaction để tránh trạng thái nửa cũ, nửa mới khi có lỗi giữa chừng.
    dbRun(db, 'BEGIN TRANSACTION');

    const salesParsed = parseSalesHistorySheet(wb);
    const salesResult = replaceSalesHistory(db, salesParsed);
    results.sales_history = {
      found: salesParsed.found,
      sheet: salesParsed.sheetName,
      imported: salesResult.imported,
      skipped: salesParsed.skipped,
      replaced: salesResult.replaced,
    };

    const winParsed = parseWinSheet(wb);
    const winResult = replaceWinInventory(db, winParsed);
    results.win_inventory = {
      found: winParsed.found,
      sheet: winParsed.sheetName,
      imported: winResult.imported,
      skipped: winParsed.skipped,
      replaced: winResult.replaced,
    };

    for (const sheetName of wb.SheetNames) {
      // QLĐH và WIN đã xử lý riêng ở trên. Các sheet nội bộ/nháp không phải catalog NCC.
      if (/^(QLĐH|QLDH|SHEET1|T7|NHÁP T7|NHAP T7|WIN)$/i.test(sheetName.trim())) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      if (rows.length < 2) continue;

      const schema = detectSchema(rows, sheetName);
      let sheetMatched = 0;
      let sheetUnmatched = 0;

      for (let i = schema.headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.filter(cell => String(cell || '').trim() !== '').length < 2) continue;

        const canonicalRaw = schema.colMaTonKho >= 0 ? cleanRaw(row[schema.colMaTonKho]) : '';
        const viTri = schema.colViTri >= 0 ? String(row[schema.colViTri] || '').trim() : '';
        const xeApDung = schema.colXeApDung >= 0 ? String(row[schema.colXeApDung] || '').trim() : '';
        const prices = {
          gia_dai_ly: schema.colGiaDaiLy >= 0 ? numberOrZero(row[schema.colGiaDaiLy]) : 0,
          gia_thung: schema.colGiaThung >= 0 ? numberOrZero(row[schema.colGiaThung]) : 0,
          sl_thung: schema.colSlThung >= 0 ? numberOrZero(row[schema.colSlThung]) : 0,
          stock_ncc: schema.colStock >= 0 ? String(row[schema.colStock] || '').trim() : '',
        };

        let rowMapped = 0;
        for (const spec of schema.externalSpecs) {
          const rawCell = cleanRaw(row[spec.col]);
          if (!rawCell || /^#(ERROR|VALUE|N\/A)/i.test(rawCell)) continue;

          const splitCodes = splitCodeAliases(rawCell).filter(code => normalizeCode(code).length >= 3);
          const externalCodes = splitCodes.length > 1
            ? splitCodes.filter(code => cleanRaw(code) !== cleanRaw(rawCell))
            : splitCodes;

          for (const maNgoai of externalCodes) {
            let maHang = canonicalRaw;
            if (spec.col === schema.colMaTonKho) maHang = canonicalRaw || maNgoai;

            if (!maHang) {
              const matched = findBestProductMatch(maNgoai, productCodes);
              if (!matched || matched.suggestions) {
                results.catalog.unmatched++;
                sheetUnmatched++;
                results.catalog.suggestions.push({
                  ma_excel: maNgoai,
                  ma_ngoai: maNgoai,
                  loai_ma: spec.type,
                  nha_cc: sheetName,
                  xe_ap_dung: xeApDung,
                  vi_tri: viTri,
                  ...prices,
                  ma_hang: null,
                  candidates: matched?.suggestions || [],
                });
                continue;
              }
              maHang = matched.ma_hang;
            }

            const inCache = productCodes.find(code => normalizeCode(code) === normalizeCode(maHang));
            upsertMaNgoai(db, {
              ma_hang: inCache || maHang,
              ma_ngoai: maNgoai,
              loai_ma: spec.type,
              nha_cc: sheetName,
              xe_ap_dung: xeApDung,
              vi_tri: viTri,
              ...prices,
            });
            results.catalog.matched++;
            sheetMatched++;
            rowMapped++;
          }
        }

        if (rowMapped === 0 && canonicalRaw && normalizeCode(canonicalRaw).length >= 3) {
          const inCache = productCodes.find(code => normalizeCode(code) === normalizeCode(canonicalRaw));
          upsertMaNgoai(db, {
            ma_hang: inCache || canonicalRaw,
            ma_ngoai: canonicalRaw,
            loai_ma: inferCodeType(schema.headers?.[schema.colMaTonKho] || '', sheetName),
            nha_cc: sheetName,
            xe_ap_dung: xeApDung,
            vi_tri: viTri,
            ...prices,
          });
          results.catalog.matched++;
          sheetMatched++;
        }
      }

      results.catalog.sheets.push({ sheet: sheetName, matched: sheetMatched, unmatched: sheetUnmatched });
    }

    const navigationIndex = rebuildSearchDocuments(db);
    dbRun(db, 'COMMIT');
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({
      success: true,
      message: `Đã nhập ${results.sales_history.imported} dòng QLĐH, ${results.win_inventory.imported} mã WIN và ${results.catalog.matched} mapping NCC`,
      ...results,
      // Giữ field cũ để frontend/clients cũ không vỡ.
      matched: results.catalog.matched,
      unmatched: results.catalog.unmatched,
      suggestions: results.catalog.suggestions,
      navigation_index: navigationIndex,
    });
  } catch (e) {
    if (db) {
      try { dbRun(db, 'ROLLBACK'); } catch (_) { /* transaction chưa bắt đầu hoặc đã kết thúc */ }
    }
    res.status(500).json({ error: e.message });
  }
});

router.post('/import/confirm', async (req, res) => {
  try {
    const db = await getDb();
    let count = 0;
    for (const item of req.body.items || []) {
      if (!item.ma_hang || !item.ma_ngoai) continue;
      upsertMaNgoai(db, item);
      count++;
    }
    rebuildSearchDocuments(db);
    saveDb(db);
    await loadMemoryIndex(true);
    res.json({ success: true, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/by-hang/:ma_hang', async (req, res) => {
  try {
    const db = await getDb();
    const rows = dbQuery(db, `
      SELECT * FROM ma_ngoai WHERE ma_hang = ? ORDER BY nha_cc, loai_ma
    `, [req.params.ma_hang]);
    db.close();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.__test = { parseSalesHistorySheet, replaceSalesHistory, parseWinSheet, replaceWinInventory, detectSchema };
module.exports = router;
