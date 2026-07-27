'use strict';

const express = require('express');
const router = express.Router();
const {
  searchNavigation,
  getNavigationDetail,
  recordNavigationClick,
  loadMemoryIndex,
} = require('../services/navigationIndex');

router.get('/search', async (req, res) => {
  const started = process.hrtime.bigint();
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ error: 'Nhập ít nhất 2 ký tự' });
    const result = await searchNavigation(q, Number(req.query.limit || 50));
    const ended = process.hrtime.bigint();
    result.elapsed_ms = Number(ended - started) / 1e6;
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/documents/:id', async (req, res) => {
  try {
    const detail = await getNavigationDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Không tìm thấy dữ liệu điều hướng' });
    res.json(detail);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/click', async (req, res) => {
  try {
    const userId = req.user?.username || req.user?.id || '';
    await recordNavigationClick({
      query: req.body.query,
      documentKey: req.body.document_key,
      documentId: req.body.document_id,
      userId,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', async (_req, res) => {
  try {
    const index = await loadMemoryIndex();
    res.json({
      ready: true,
      documents: index.documents.size,
      tokens: index.tokenIndex.size,
      codes: index.codeIndex.size,
      loaded_at: index.loadedAt,
    });
  } catch (error) {
    res.status(500).json({ ready: false, error: error.message });
  }
});

module.exports = router;
