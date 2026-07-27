'use strict';

const { getDb, dbQuery, dbGet } = require('../sqlite');
const { normalizeCode } = require('../utils/codeSearch');

let currentIndex = null;
let loadPromise = null;
let invalidationVersion = 0;

function emptyIndex() {
  return {
    byCode: new Map(),
    rowCount: 0,
    codeCount: 0,
    lastSync: null,
    loadedAt: null,
  };
}

function invalidateInventoryCacheIndex() {
  invalidationVersion += 1;
  currentIndex = null;
}

async function loadInventoryCacheIndex(force = false) {
  if (!force && currentIndex) return currentIndex;

  if (loadPromise) {
    await loadPromise;
    if (!force && currentIndex) return currentIndex;
  }

  const startVersion = invalidationVersion;
  const promise = (async () => {
    const db = await getDb();
    try {
      const rows = dbQuery(db, `
        SELECT
          _rowid,
          ma_hang,
          ten_hang,
          kho,
          dvt,
          ton_kho,
          don_gia,
          don_gia_goc,
          don_gia_vat_rate,
          updated_at
        FROM (
          SELECT
            t.rowid AS _rowid,
            t.ma_hang,
            t.ten_hang,
            t.kho,
            t.dvt,
            t.cuoi_ky_sl AS ton_kho,
            t.don_gia,
            t.don_gia_goc,
            t.don_gia_vat_rate,
            t.updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY UPPER(t.ma_hang), t.kho
              ORDER BY t.updated_at DESC, t.rowid DESC
            ) AS rn
          FROM tonkho_cache t
        )
        WHERE rn = 1
        ORDER BY ma_hang, kho
      `);

      const meta = dbGet(db, `SELECT value FROM sync_meta WHERE key = ?`, ['last_sync_tonkho']);
      const byCode = new Map();
      const dedupe = new Map();

      for (const row of rows) {
        const normalized = normalizeCode(row.ma_hang);
        if (!normalized) continue;

        const warehouseKey = `${normalized}::${String(row.kho || '').toUpperCase()}`;
        const existing = dedupe.get(warehouseKey);
        if (existing && Number(existing._rowid || 0) >= Number(row._rowid || 0)) continue;
        dedupe.set(warehouseKey, row);
      }

      for (const row of dedupe.values()) {
        const normalized = normalizeCode(row.ma_hang);
        const payload = {
          ma_hang: row.ma_hang,
          ten_hang: row.ten_hang || '',
          kho: row.kho || '',
          dvt: row.dvt || '',
          ton_kho: Number(row.ton_kho || 0),
          don_gia: Number(row.don_gia || 0),
          don_gia_goc: Number(row.don_gia_goc || 0),
          don_gia_vat_rate: Number(row.don_gia_vat_rate || 0),
          updated_at: row.updated_at || null,
        };

        if (!byCode.has(normalized)) byCode.set(normalized, []);
        byCode.get(normalized).push(payload);
      }

      for (const list of byCode.values()) {
        list.sort((a, b) => String(a.kho || '').localeCompare(String(b.kho || ''), 'vi'));
      }

      const nextIndex = {
        byCode,
        rowCount: dedupe.size,
        codeCount: byCode.size,
        lastSync: meta?.value || null,
        loadedAt: new Date().toISOString(),
      };

      if (startVersion === invalidationVersion) currentIndex = nextIndex;
      return nextIndex;
    } finally {
      db.close();
    }
  })();

  loadPromise = promise;
  try {
    return await promise;
  } finally {
    if (loadPromise === promise) loadPromise = null;
  }
}

async function lookupInventoryCache(maHang) {
  const normalized = normalizeCode(maHang);
  if (!normalized) {
    return {
      rows: [],
      lastSync: currentIndex?.lastSync || null,
      indexLoadedAt: currentIndex?.loadedAt || null,
    };
  }

  const index = await loadInventoryCacheIndex();
  return {
    rows: index.byCode.get(normalized) || [],
    lastSync: index.lastSync,
    indexLoadedAt: index.loadedAt,
  };
}

function getInventoryCacheIndexStats() {
  return currentIndex || emptyIndex();
}

module.exports = {
  invalidateInventoryCacheIndex,
  loadInventoryCacheIndex,
  lookupInventoryCache,
  getInventoryCacheIndexStats,
};
