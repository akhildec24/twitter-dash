'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { fetchUserData } = require('./twitter');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json());

// ─── API ──────────────────────────────────────────────────────────────────────

// Check if cached data exists for a handle, return it if so
app.get('/api/check', (req, res) => {
  const handle = sanitizeHandle(req.query.handle);
  if (!handle) return res.status(400).json({ error: 'handle required' });

  const file = dataPath(handle);
  if (!fs.existsSync(file)) return res.json({ exists: false });

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json({ exists: true, data });
  } catch {
    res.json({ exists: false });
  }
});

// Stream fetch progress via Server-Sent Events
app.get('/api/fetch', (req, res) => {
  const handle = sanitizeHandle(req.query.handle);
  if (!handle) { res.status(400).end(); return; }

  const maxPosts = Math.min(parseInt(req.query.maxPosts) || 200, 500);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  fetchUserData(handle, maxPosts, (progress) => emit('progress', progress))
    .then((data) => {
      // Store userId so load-more can skip re-fetching the profile
      if (!data.userId && data.profile) data.userId = null; // will be set by twitter.js
      fs.writeFileSync(dataPath(handle), JSON.stringify(data));
      emit('done', data);
      res.end();
    })
    .catch((err) => {
      console.error(`[server] fetch error @${handle}:`, err.message);
      emit('error', { message: err.message });
      res.end();
    });
});

// Save hidden post IDs
app.post('/api/hidden', (req, res) => {
  const handle = sanitizeHandle(req.body?.handle);
  const hiddenIds = req.body?.hiddenIds;
  if (!handle || !Array.isArray(hiddenIds)) {
    return res.status(400).json({ error: 'handle and hiddenIds required' });
  }

  const file = dataPath(handle);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'no data for handle' });

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.hiddenIds = hiddenIds;
    fs.writeFileSync(file, JSON.stringify(data));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream more posts starting from the stored cursor (SSE)
app.get('/api/load-more', (req, res) => {
  const handle = sanitizeHandle(req.query.handle);
  if (!handle) { res.status(400).end(); return; }

  const file = dataPath(handle);
  if (!fs.existsSync(file)) { res.status(404).end(); return; }

  let existing;
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { res.status(500).json({ error: 'corrupt cache' }); return; }

  const { nextCursor, userId } = existing;
  if (!nextCursor) {
    res.status(400).json({ error: 'no_more', message: 'No more pages available' });
    return;
  }

  const maxMore = Math.min(parseInt(req.query.maxPosts) || 200, 500);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  fetchUserData(handle, maxMore, (p) => emit('progress', p), nextCursor, userId)
    .then((newData) => {
      // Merge new posts (deduplicate by id)
      const existingIds = new Set(existing.posts.map(p => p.id));
      const fresh = newData.posts.filter(p => !existingIds.has(p.id));

      existing.posts = [...existing.posts, ...fresh];
      existing.nextCursor = newData.nextCursor;
      existing.hasMore    = newData.hasMore;
      if (!existing.userId && newData.userId) existing.userId = newData.userId;

      fs.writeFileSync(file, JSON.stringify(existing));

      emit('done', { newPosts: fresh, total: existing.posts.length, hasMore: existing.hasMore });
      res.end();
    })
    .catch((err) => {
      console.error(`[server] load-more error @${handle}:`, err.message);
      emit('error', { message: err.message });
      res.end();
    });
});

// Clear cached data (triggers re-fetch next time)
app.delete('/api/cache/:handle', (req, res) => {
  const handle = sanitizeHandle(req.params.handle);
  const file = dataPath(handle);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(__dirname));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeHandle(raw = '') {
  return String(raw).toLowerCase().trim().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
}

function dataPath(handle) {
  return path.join(DATA_DIR, `${handle}.json`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n  twitter-dash');
  console.log(`  → ${url}\n`);
  // Auto-open browser (macOS)
  exec(`open "${url}"`);
});
