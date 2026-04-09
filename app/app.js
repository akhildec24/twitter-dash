'use strict';
/* ─────────────────────────────────────────────────────────────────────────────
   twitter-dash — Frontend SPA
   Views: landing → loading → portfolio
   Features: masonry/grid/feed, lightbox w/ carousel, hover stats,
             sort, column control, load more, edit mode, theme
───────────────────────────────────────────────────────────────────────────── */

// ── View management ──────────────────────────────────────────────────────────

const VIEWS = {
  landing:   document.getElementById('view-landing'),
  loading:   document.getElementById('view-loading'),
  portfolio: document.getElementById('view-portfolio'),
};
function showView(name) {
  for (const [k, el] of Object.entries(VIEWS)) el.hidden = k !== name;
}

// ── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}
function initTheme() {
  const sys = () => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(localStorage.getItem('theme') || sys());
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change',
    () => { if (!localStorage.getItem('theme')) applyTheme(sys()); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  LANDING
// ══════════════════════════════════════════════════════════════════════════════

function initLanding() {
  const form     = document.getElementById('handle-form');
  const input    = document.getElementById('handle-input');
  const errorEl  = document.getElementById('handle-error');
  const fieldEl  = document.getElementById('handle-field');
  const recentEl = document.getElementById('recent-handles');

  const last = localStorage.getItem('last-handle');
  if (last) input.value = last;

  recentEl.innerHTML = '';
  getRecentHandles().forEach(h => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'recent-chip';
    chip.textContent = `@${h}`;
    chip.addEventListener('click', () => { input.value = h; input.focus(); });
    recentEl.appendChild(chip);
  });

  input.addEventListener('input', () => {
    errorEl.textContent = '';
    fieldEl.classList.remove('error');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const raw = input.value.trim().replace(/^@/, '');
    if (!raw) { showError('Enter a Twitter / X username'); return; }
    if (!/^[a-zA-Z0-9_]{1,50}$/.test(raw)) {
      showError('Usernames can only contain letters, numbers and _');
      return;
    }
    const handle = raw.toLowerCase();
    addRecentHandle(handle);
    input.blur();
    try {
      const res = await fetch(`/api/check?handle=${handle}`);
      const j   = await res.json();
      if (j.exists && j.data?.posts?.length) { launchPortfolio(j.data, handle); return; }
    } catch {}
    startLoading(handle, false);
  });

  function showError(msg) {
    errorEl.textContent = msg;
    fieldEl.classList.add('error');
    input.focus();
  }
}

function getRecentHandles() {
  try { return JSON.parse(localStorage.getItem('recent-handles') || '[]'); } catch { return []; }
}
function addRecentHandle(h) {
  localStorage.setItem('last-handle', h);
  localStorage.setItem('recent-handles',
    JSON.stringify([h, ...getRecentHandles().filter(x => x !== h)].slice(0, 6)));
}

// ══════════════════════════════════════════════════════════════════════════════
//  LOADING
// ══════════════════════════════════════════════════════════════════════════════

let activeSSE = null;

function startLoading(handle, isLoadMore) {
  if (!isLoadMore) showView('loading');

  const get   = id => document.getElementById(id);
  const nameEl   = get('loading-handle-name');
  const avatarEl = get('loading-avatar');
  const statusEl = get('loading-status');
  const countEl  = get('loading-count');
  const barEl    = get('loading-bar');
  const cancelEl = get('loading-cancel');

  if (nameEl)   nameEl.textContent  = handle;
  if (statusEl) { statusEl.textContent = 'Connecting...'; statusEl.style.color = ''; }
  if (countEl)  countEl.textContent  = '';
  if (avatarEl) avatarEl.hidden = true;
  if (barEl)    { barEl.style.width = '0%'; barEl.classList.add('indeterminate'); }

  if (cancelEl) {
    // Remove old handler by replacing node
    const fresh = cancelEl.cloneNode(true);
    cancelEl.replaceWith(fresh);
    fresh.textContent = 'Cancel';
    fresh.addEventListener('click', () => {
      activeSSE?.close(); activeSSE = null;
      if (isLoadMore) setLoadMoreIdle(); else showView('landing');
    }, { once: true });
  }

  const url = isLoadMore
    ? `/api/load-more?handle=${encodeURIComponent(handle)}`
    : `/api/fetch?handle=${encodeURIComponent(handle)}`;

  const src = new EventSource(url);
  activeSSE = src;

  src.addEventListener('progress', e => {
    const d = JSON.parse(e.data);
    if (d.stage === 'profile' && statusEl) statusEl.textContent = 'Fetching profile...';
    if (d.stage === 'fetch' && barEl) {
      barEl.classList.remove('indeterminate');
      const pct = d.maxPosts ? Math.min(96, (d.total / d.maxPosts) * 100) : 0;
      barEl.style.width = `${Math.max(pct, 4)}%`;
      if (statusEl) statusEl.textContent = `Fetching page ${d.page}...`;
      if (countEl)  countEl.textContent  = d.total > 0 ? `${d.total} posts found` : '';
    }
  });

  src.addEventListener('done', e => {
    src.close(); activeSSE = null;
    if (barEl) { barEl.classList.remove('indeterminate'); barEl.style.width = '100%'; }
    const data = JSON.parse(e.data);

    if (isLoadMore) {
      appendPosts(data.newPosts || [], data.total, data.hasMore);
    } else {
      if (data.profile?.avatar && avatarEl) { avatarEl.src = data.profile.avatar; avatarEl.hidden = false; }
      if (statusEl) statusEl.textContent = 'Done!';
      if (countEl)  countEl.textContent  = `${data.posts?.length || 0} posts`;
      setTimeout(() => launchPortfolio(data, handle), 550);
    }
  });

  src.addEventListener('error', e => {
    src.close(); activeSSE = null;
    if (barEl) barEl.classList.remove('indeterminate');
    let msg = 'Something went wrong.';
    try { msg = JSON.parse(e.data).message; } catch {}
    if (isLoadMore) {
      setLoadMoreError(msg);
    } else {
      if (statusEl) { statusEl.textContent = `Error: ${msg}`; statusEl.style.color = 'rgba(239,68,68,0.9)'; }
      const c = document.getElementById('loading-cancel');
      if (c) c.textContent = '← Back';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  PORTFOLIO — STATE
// ══════════════════════════════════════════════════════════════════════════════

let ALL_POSTS    = [];
let SORTED       = [];   // ALL_POSTS after applying sort
let VISIBLE      = [];   // SORTED after applying edit/hidden filter
let PROFILE      = null;
let HANDLE       = null;
let FETCH_META   = { fetchedAt: null, hasMore: false };

let activeLayout = 'masonry';
let sortMode     = 'newest';   // 'newest' | 'oldest' | 'likes'
let numCols      = 5;
let editMode     = false;
let hiddenIds    = new Set();

const GRID = { GAP: 18, EASE: 0.1, POOL: 500, BUFFER: 640 };

const cam = {
  x: 0, y: 0, tx: 0, ty: 0,
  drag: false, startX: 0, startY: 0, prevX: 0, prevY: 0,
  moved: false, touch: null,
};

// ── Sort ─────────────────────────────────────────────────────────────────────

function applySortAndFilter() {
  const withMedia = ALL_POSTS.filter(p => p.images?.length > 0);
  if (sortMode === 'oldest') {
    SORTED = [...withMedia].sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt));
  } else if (sortMode === 'likes') {
    SORTED = [...withMedia].sort((a, b) => b.likeCount - a.likeCount);
  } else {
    SORTED = withMedia; // already newest-first from server
  }
}

// ── Layout ───────────────────────────────────────────────────────────────────

let layoutItems = [];
let totalWidth  = 0;
let totalHeight = 0;
let colWidth    = 0;

function buildLayout() {
  applySortAndFilter();
  VISIBLE = editMode ? SORTED : SORTED.filter(p => !hiddenIds.has(p.id));

  if      (activeLayout === 'feed') buildFeedLayout();
  else if (activeLayout === 'grid') buildGridLayout();
  else                              buildMasonryLayout();
}

function buildMasonryLayout() {
  const vw   = window.innerWidth;
  const gap  = GRID.GAP;
  const cols = numCols;
  colWidth   = Math.floor((vw - gap) / cols);
  totalWidth = colWidth * cols;

  const heights = new Array(cols).fill(0);
  const columns = Array.from({ length: cols }, () => []);

  for (const post of VISIBLE) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c]) c = i;
    const img = post.images[0];
    const w = colWidth - gap;
    const h = w / (img.width / img.height);
    columns[c].push({ post, x: c * colWidth + gap / 2, y: heights[c] + gap / 2, w, h });
    heights[c] += h + gap;
  }

  totalHeight = Math.ceil(Math.max(...heights, 1));

  for (let c = 0; c < cols; c++) {
    const col = columns[c];
    if (col.length <= 1 || heights[c] >= totalHeight) continue;
    const extra = (totalHeight - heights[c]) / col.length;
    col.forEach((item, i) => { item.y += extra * i; });
  }

  layoutItems = [];
  for (let c = 0; c < cols; c++)
    columns[c].forEach((item, r) => layoutItems.push({ key: `${c}-${r}`, ...item }));
}

function buildGridLayout() {
  const vw   = window.innerWidth;
  const gap  = GRID.GAP;
  const cols = numCols;
  colWidth   = Math.floor((vw - gap) / cols);
  totalWidth = colWidth * cols;
  const w    = colWidth - gap;

  const heights = new Array(cols).fill(0);
  layoutItems = [];

  VISIBLE.forEach((post, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const h = w / (post.images[0].width / post.images[0].height);
    layoutItems.push({ key: `${c}-${r}`, post, x: c * colWidth + gap / 2, y: heights[c] + gap / 2, w, h });
    heights[c] += h + gap;
  });

  totalHeight = Math.ceil(Math.max(...heights, 1));

  const byCol = new Map();
  for (const item of layoutItems) {
    const c = parseInt(item.key);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c).push(item);
  }
  for (let c = 0; c < cols; c++) {
    const col = byCol.get(c) || [];
    if (col.length <= 1 || heights[c] >= totalHeight) continue;
    const extra = (totalHeight - heights[c]) / col.length;
    col.forEach((item, i) => { item.y += extra * i; });
  }
}

function buildFeedLayout() {
  const vw   = window.innerWidth;
  const gap  = GRID.GAP;
  const w    = Math.min(560, vw - gap * 2);
  colWidth   = w; totalWidth = w;
  let y = gap;
  layoutItems = VISIBLE.map((post, i) => {
    const h = w / (post.images[0].width / post.images[0].height);
    const item = { key: `0-${i}`, post, x: 0, y, w, h };
    y += h + gap;
    return item;
  });
  totalHeight = y || 1;
}

// ── DOM Pool ─────────────────────────────────────────────────────────────────

const pool     = [];
const free     = [];
const active   = new Map();
const elToPost = new WeakMap();

const PLAY_SVG = `<svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M21.25 12C21.25 17.11 17.11 21.25 12 21.25C6.89 21.25 2.75 17.11 2.75 12C2.75 6.89 6.89 2.75 12 2.75C17.11 2.75 21.25 6.89 21.25 12Z" fill="#1E1E1E"/>
  <path d="M10 14.8V9.2C10 8.79 10.45 8.56 10.78 8.78L14.89 11.59C15.19 11.79 15.19 12.21 14.89 12.41L10.78 15.22C10.45 15.44 10 15.21 10 14.8Z" fill="white"/>
</svg>`;

const EYE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
</svg>`;

function initPool() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  pool.length = 0; free.length = 0; active.clear();

  for (let i = 0; i < GRID.POOL; i++) {
    const el = document.createElement('div');
    el.className = 'grid-item';
    el.style.display = 'none';
    el.innerHTML = `
      <img src="" alt="" loading="lazy" decoding="async">
      <div class="video-badge" style="display:none">${PLAY_SVG}</div>
      <div class="multi-badge" style="display:none"></div>
      <div class="hover-stats"></div>
      <div class="hidden-overlay">${EYE_SVG}</div>`;
    grid.appendChild(el);
    pool.push(el); free.push(el);
  }
}

function acquire() {
  if (!free.length) return null;
  const el = free.pop();
  el.style.display = '';
  return el;
}

function release(el) {
  el.style.display    = 'none';
  el.style.visibility = '';
  el.classList.remove('is-hidden');
  el.querySelector('.video-badge').style.display = 'none';
  el.querySelector('.multi-badge').style.display = 'none';
  el.querySelector('.hover-stats').innerHTML = '';
  free.push(el);
}

// ── Image URL ─────────────────────────────────────────────────────────────────

function imgUrl(url, size = 'small') {
  const base = url.split('?')[0];
  const ext  = (base.match(/\.(jpg|jpeg|png)$/i) || ['', 'jpg'])[1].toLowerCase();
  return `${base}?format=${ext}&name=${size}`;
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function render() {
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;
  const buf = GRID.BUFFER;
  const cx  = cam.x; const cy = cam.y;

  const lockX   = activeLayout === 'feed' || activeLayout === 'grid';
  const centerX = lockX ? Math.floor((vw - totalWidth) / 2) : 0;

  const tileX0 = lockX ? 0 : Math.floor((Math.min(cx, cam.tx) - buf) / totalWidth);
  const tileX1 = lockX ? 0 : Math.floor((Math.max(cx, cam.tx) + vw + buf) / totalWidth);
  const tileY0 = Math.floor((Math.min(cy, cam.ty) - buf) / totalHeight);
  const tileY1 = Math.floor((Math.max(cy, cam.ty) + vh + buf) / totalHeight);

  const visible = new Set();

  for (const item of layoutItems) {
    for (let ty = tileY0; ty <= tileY1; ty++) {
      for (let tx = tileX0; tx <= tileX1; tx++) {
        const wx = item.x + tx * totalWidth + centerX;
        const wy = item.y + ty * totalHeight;
        const sx = wx - cx; const sy = wy - cy;

        const inView = (x, y) =>
          x + item.w >= -buf && x <= vw + buf && y + item.h >= -buf && y <= vh + buf;
        if (!inView(sx, sy) && !inView(wx - cam.tx, wy - cam.ty)) continue;

        const key = `${item.key}_${tx}_${ty}`;
        visible.add(key);

        const existing = active.get(key);
        if (existing) {
          if (existing.el !== lbState.cloneEl) {
            existing.el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
          }
          existing.el.classList.toggle('is-hidden', editMode && hiddenIds.has(item.post.id));
        } else {
          const el = acquire();
          if (!el) continue;

          const img = el.querySelector('img');
          const src = imgUrl(item.post.images[0].url, 'medium');
          if (img.src !== src) { img.src = src; img.alt = item.post.text.slice(0, 60); }

          el.querySelector('.video-badge').style.display =
            item.post.images[0].type === 'video' ? '' : 'none';

          const multi = el.querySelector('.multi-badge');
          if (item.post.images.length > 1) {
            multi.textContent = `1 / ${item.post.images.length}`;
            multi.style.display = '';
          } else {
            multi.style.display = 'none';
          }

          // Hover stats
          const stats = el.querySelector('.hover-stats');
          const s = item.post;
          const parts = [];
          if (s.likeCount > 0)    parts.push(`<span class="hover-stat"><span>♥</span>${fmtNum(s.likeCount)}</span>`);
          if (s.repostCount > 0)  parts.push(`<span class="hover-stat"><span>↺</span>${fmtNum(s.repostCount)}</span>`);
          stats.innerHTML = parts.join('');

          el.style.width     = `${item.w}px`;
          el.style.height    = `${item.h}px`;
          el.style.transform = `translate3d(${sx}px,${sy}px,0)`;
          el.classList.toggle('is-hidden', editMode && hiddenIds.has(item.post.id));

          elToPost.set(el, item.post);
          active.set(key, { el, item });
        }
      }
    }
  }

  for (const [key, entry] of active) {
    if (!visible.has(key) && entry.el !== lbState.cloneEl) {
      release(entry.el);
      elToPost.delete(entry.el);
      active.delete(key);
    }
  }
}

// ── RAF loop ──────────────────────────────────────────────────────────────────

let rafRunning = false;

function startRaf() {
  if (rafRunning) return;
  rafRunning = true;
  (function loop() {
    if (!rafRunning) return;
    requestAnimationFrame(loop);
    const dx = cam.tx - cam.x;
    const dy = cam.ty - cam.y;
    if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
      cam.x += dx * GRID.EASE;
      cam.y += dy * GRID.EASE;
      render();
    }
  })();
}

// ── Input events (attached once) ─────────────────────────────────────────────

let eventsAttached = false;

function attachPortfolioEvents() {
  if (eventsAttached) return;
  eventsAttached = true;

  const vp = document.getElementById('viewport');

  vp.addEventListener('mousedown', e => {
    if (lbState.open) return;
    cam.drag = true; cam.moved = false;
    cam.startX = e.clientX; cam.startY = e.clientY;
    cam.prevX  = e.clientX; cam.prevY  = e.clientY;
    vp.classList.add('grabbing');
  });

  vp.addEventListener('mousemove', e => {
    if (!cam.drag) return;
    if (Math.hypot(e.clientX - cam.startX, e.clientY - cam.startY) > 5) cam.moved = true;
    const lockX = activeLayout === 'feed' || activeLayout === 'grid';
    if (!lockX) cam.tx -= e.clientX - cam.prevX;
    cam.ty  -= e.clientY - cam.prevY;
    cam.prevX = e.clientX; cam.prevY = e.clientY;
  });

  const onUp = e => {
    const was = cam.drag;
    cam.drag = false;
    vp.classList.remove('grabbing');
    if (was && !cam.moved && !lbState.open) {
      const el = e.target.closest('.grid-item');
      if (!el) return;
      const post = elToPost.get(el);
      if (!post) return;
      if (editMode) {
        hiddenIds.has(post.id) ? hiddenIds.delete(post.id) : hiddenIds.add(post.id);
        saveHidden(); updateEditCounter(); render();
      } else {
        openLightbox(el, post);
      }
    }
  };
  vp.addEventListener('mouseup', onUp);
  vp.addEventListener('mouseleave', onUp);

  vp.addEventListener('wheel', e => {
    e.preventDefault();
    if (lbState.open) return;
    const lockX = activeLayout === 'feed' || activeLayout === 'grid';
    if (!lockX) cam.tx += e.deltaX;
    cam.ty += e.deltaY;
  }, { passive: false });

  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 1) cam.touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });

  vp.addEventListener('touchmove', e => {
    if (e.touches.length !== 1 || !cam.touch) return;
    e.preventDefault();
    const lockX = activeLayout === 'feed' || activeLayout === 'grid';
    if (!lockX) cam.tx -= e.touches[0].clientX - cam.touch.x;
    cam.ty  -= e.touches[0].clientY - cam.touch.y;
    cam.touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: false });

  vp.addEventListener('touchend', () => { cam.touch = null; });

  // Lightbox controls
  document.getElementById('lightbox-close').addEventListener('click', e => { e.stopPropagation(); closeLightbox(); });
  document.getElementById('lightbox-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('lightbox-overlay')) closeLightbox();
  });
  document.getElementById('lightbox-prev').addEventListener('click', () => navigateLightbox(-1));
  document.getElementById('lightbox-next').addEventListener('click', () => navigateLightbox(+1));
  document.getElementById('copy-link-btn').addEventListener('click', copyPostLink);
  document.getElementById('lb-download-btn').addEventListener('click', downloadCurrentImage);
  document.getElementById('lb-play-btn').addEventListener('click', toggleSlideshow);
  document.getElementById('lb-speed-btn').addEventListener('click', cycleSpeed);

  window.addEventListener('keydown', e => {
    if (!lbState.open) return;
    if (e.key === 'Escape')     { stopSlideshow(); closeLightbox(); }
    if (e.key === 'ArrowLeft')  navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(+1);
    if (e.key === ' ')          { e.preventDefault(); toggleSlideshow(); }
  });

  // Debounced resize
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      buildLayout();
      for (const [k, e] of active) { release(e.el); active.delete(k); }
      render();
    }, 150);
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

const SLIDE_SPEEDS = [2, 3, 5, 8]; // seconds
const slideshow = { playing: false, timer: null, speedIdx: 1 };

const lbState = {
  open: false, animating: false,
  postIndex: -1,    // index in VISIBLE (for prev/next post)
  imgIndex: 0,      // index within current post's images
  sourceEl: null, cloneEl: null,
  endX: 0, endY: 0, endW: 0, endH: 0,
};

function openLightbox(el, post) {
  if (lbState.open || lbState.animating) return;
  lbState.animating = true;
  lbState.open      = true;
  lbState.sourceEl  = el;
  lbState.postIndex = VISIBLE.indexOf(post);
  lbState.imgIndex  = 0;
  _animateLbOpen(el, post);
}

function _animateLbOpen(el, post) {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth; const vh = window.innerHeight;
  const maxW = vw * 0.72; const maxH = vh * 0.72;
  const ar = rect.width / rect.height;
  let tw, th;
  if (maxW / maxH > ar) { th = maxH; tw = th * ar; } else { tw = maxW; th = tw / ar; }
  const ex = (vw - tw) / 2; const ey = (vh - th) / 2;
  lbState.endX = ex; lbState.endY = ey; lbState.endW = tw; lbState.endH = th;

  el.style.visibility = 'hidden';
  lbState.cloneEl?.remove();

  const clone = el.cloneNode(true);
  clone.classList.add('lightbox-active');
  clone.querySelector('.hidden-overlay')?.remove();
  clone.querySelector('.multi-badge')?.remove();
  clone.querySelector('.hover-stats')?.remove();
  clone.querySelector('.video-badge')?.remove();
  clone.style.cssText += `width:${rect.width}px;height:${rect.height}px;visibility:visible;`;
  clone.style.transform = `translate3d(${rect.left}px,${rect.top}px,0)`;
  document.body.appendChild(clone);
  lbState.cloneEl = clone;

  _loadHiRes(clone, post.images[0]);
  _updateLbInfo(post);

  document.getElementById('lightbox-overlay').classList.add('active');
  document.body.classList.add('lightbox-open');

  const dist = Math.hypot(ex - rect.left, ey - rect.top);
  const dur  = 0.42 + Math.min(dist / 2200, 0.22);

  Motion.animate(clone, {
    width:  [`${rect.width}px`,  `${tw}px`],
    height: [`${rect.height}px`, `${th}px`],
    transform: [
      `translate3d(${rect.left}px,${rect.top}px,0)`,
      `translate3d(${ex}px,${ey}px,0)`,
    ],
  }, { type: 'spring', duration: dur, bounce: 0.12 })
  .then(() => { lbState.animating = false; });
}

function closeLightbox() {
  if (!lbState.open || lbState.animating) return;
  lbState.animating = true;
  document.getElementById('lightbox-overlay').classList.remove('active');
  document.body.classList.remove('lightbox-open');

  const el = lbState.sourceEl;
  if (!el) { _cleanupLb(); return; }
  const r = el.getBoundingClientRect();
  const { endX: fx, endY: fy, endW: fw, endH: fh } = lbState;

  Motion.animate(lbState.cloneEl, {
    width:  [`${fw}px`, `${r.width}px`],
    height: [`${fh}px`, `${r.height}px`],
    transform: [
      `translate3d(${fx}px,${fy}px,0)`,
      `translate3d(${r.left}px,${r.top}px,0)`,
    ],
  }, { type: 'spring', duration: 0.38, bounce: 0 }).then(_cleanupLb);
}

function _cleanupLb() {
  stopSlideshow();
  lbState.cloneEl?.querySelector('video')?.pause();
  lbState.cloneEl?.remove(); lbState.cloneEl = null;
  if (lbState.sourceEl) lbState.sourceEl.style.visibility = '';
  lbState.open = lbState.animating = false; lbState.sourceEl = null;
}

// Navigate between POSTS (prev/next in grid)
function navigateLightbox(dir) {
  if (!lbState.open || lbState.animating) return;
  const newIdx = lbState.postIndex + dir;
  if (newIdx < 0 || newIdx >= VISIBLE.length) return;
  lbState.postIndex = newIdx;
  lbState.imgIndex  = 0;
  const post  = VISIBLE[newIdx];
  const clone = lbState.cloneEl;

  Motion.animate(clone, { opacity: [1, 0] }, { duration: 0.14 }).then(() => {
    const img = clone.querySelector('img');
    img.src = imgUrl(post.images[0].url, 'medium');
    clone.querySelectorAll('img:not(:first-child)').forEach(i => i.remove());
    _loadHiRes(clone, post.images[0]);
    _updateLbInfo(post);
    Motion.animate(clone, { opacity: [0, 1] }, { duration: 0.14 });
  });

  // Track source el
  const entry = [...active.values()].find(e => e.item.post === post);
  if (lbState.sourceEl) lbState.sourceEl.style.visibility = '';
  if (entry) { lbState.sourceEl = entry.el; entry.el.style.visibility = 'hidden'; }
  else { lbState.sourceEl = null; }

  _updateLbNavBtns();
}

// Navigate between IMAGES within current post
function navigateLbImage(imgIdx) {
  const post = VISIBLE[lbState.postIndex];
  if (!post || imgIdx < 0 || imgIdx >= post.images.length) return;
  lbState.imgIndex = imgIdx;
  const clone = lbState.cloneEl;
  const img   = clone.querySelector('img');

  Motion.animate(clone, { opacity: [1, 0.6] }, { duration: 0.1 }).then(() => {
    img.src = imgUrl(post.images[imgIdx].url, 'medium');
    clone.querySelectorAll('img:not(:first-child)').forEach(i => i.remove());
    _loadHiRes(clone, post.images[imgIdx]);
    Motion.animate(clone, { opacity: [0.6, 1] }, { duration: 0.1 });
  });

  _updateDots(post.images.length, imgIdx);
}

function _loadHiRes(clone, mediaItem) {
  // Remove any previous hi-res/video overlay
  clone.querySelectorAll('.lb-hires,.lb-video').forEach(e => e.remove());

  if (mediaItem.videoUrl) {
    // Inject a <video> element on top of the thumbnail
    const vid = document.createElement('video');
    vid.className = 'lb-video';
    vid.src = mediaItem.videoUrl;
    vid.controls = true;
    vid.autoplay = true;
    vid.muted = true;  // required for autoplay in all browsers
    vid.loop = mediaItem.type === 'animated_gif';
    vid.playsInline = true;
    vid.poster = mediaItem.url;
    vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;border-radius:12px;background:#000;z-index:2;';
    clone.appendChild(vid);
    return;
  }

  // Photo: load hi-res on top of thumbnail
  const hi = new Image();
  hi.className = 'lb-hires';
  hi.src = imgUrl(mediaItem.url, '4096x4096');
  hi.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:12px;opacity:0;transition:opacity 0.3s ease;pointer-events:none;';
  hi.onload = () => { hi.style.opacity = '1'; };
  clone.appendChild(hi);
}

function _updateDots(total, active) {
  const container = document.getElementById('img-dots');
  if (!container) return;
  if (total <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = Array.from({ length: total }, (_, i) =>
    `<div class="img-dot${i === active ? ' active' : ''}" data-i="${i}"></div>`
  ).join('');
  container.querySelectorAll('.img-dot').forEach(dot => {
    dot.addEventListener('click', () => navigateLbImage(parseInt(dot.dataset.i)));
  });
}

function _updateLbInfo(post) {
  const isVideo = post.images[0]?.type === 'video';
  const caption = post.text.replace(/https?:\/\/t\.co\/\S+/g, '').trim();
  const captionEl = document.getElementById('lightbox-caption');
  captionEl.textContent  = caption ? caption.slice(0, 160) + (caption.length > 160 ? '…' : '') : '';
  captionEl.style.display = caption ? '' : 'none';

  _updateDots(post.images.length, lbState.imgIndex);

  // Stats
  const statsEl = document.getElementById('lightbox-stats');
  const stats = [
    { icon: '♥', val: post.likeCount,     label: 'likes' },
    { icon: '↺', val: post.repostCount,   label: 'reposts' },
    { icon: '⊹', val: post.bookmarkCount, label: 'bookmarks' },
  ].filter(s => s.val > 0);
  statsEl.innerHTML = stats.map(s =>
    `<span class="stat-item" title="${s.val.toLocaleString()} ${s.label}">
      <span class="stat-icon">${s.icon}</span>${fmtNum(s.val)}
    </span>`
  ).join('');

  // Date
  const dateEl = document.getElementById('lb-date');
  dateEl.textContent = fmtDate(post.postedAt);

  // Link
  const linkEl = document.getElementById('lightbox-link');
  linkEl.href        = post.url;
  linkEl.textContent = isVideo ? 'Watch on X' : 'View on X';

  // Reposition info panel
  const info = document.getElementById('lightbox-info');
  info.style.top = `${lbState.endY + lbState.endH + 12}px`;

  _updateLbNavBtns();
}

function _updateLbNavBtns() {
  const prev = document.getElementById('lightbox-prev');
  const next = document.getElementById('lightbox-next');
  if (!prev || !next) return;
  const atStart = lbState.postIndex <= 0;
  const atEnd   = lbState.postIndex >= VISIBLE.length - 1;
  prev.style.opacity       = atStart ? '0.2' : '';
  prev.style.pointerEvents = atStart ? 'none' : '';
  next.style.opacity       = atEnd ? '0.2' : '';
  next.style.pointerEvents = atEnd ? 'none' : '';
}

function copyPostLink() {
  const post = VISIBLE[lbState.postIndex];
  if (!post) return;
  const btn = document.getElementById('copy-link-btn');
  navigator.clipboard.writeText(post.url).then(() => {
    btn.classList.add('copied');
    // Swap to checkmark icon briefly
    const prev = btn.innerHTML;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = prev; }, 2000);
  }).catch(() => {});
}

function downloadCurrentImage() {
  const post = VISIBLE[lbState.postIndex];
  if (!post) return;
  const imgUrl = post.images[lbState.imgIndex]?.url || post.images[0]?.url;
  if (!imgUrl) return;
  // Fetch as blob to force download (avoids open-in-tab on cross-origin)
  fetch(imgUrl)
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ext = imgUrl.split('.').pop().split('?')[0] || 'jpg';
      a.download = `${post.id}_${lbState.imgIndex}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    })
    .catch(() => { window.open(imgUrl, '_blank'); });
}

function toggleSlideshow() {
  if (slideshow.playing) stopSlideshow();
  else startSlideshow();
}

function startSlideshow() {
  slideshow.playing = true;
  _updateSlideshowUI();
  _scheduleSlide();
}

function stopSlideshow() {
  slideshow.playing = false;
  clearTimeout(slideshow.timer);
  slideshow.timer = null;
  _updateSlideshowUI();
}

function _scheduleSlide() {
  clearTimeout(slideshow.timer);
  if (!slideshow.playing) return;
  const ms = SLIDE_SPEEDS[slideshow.speedIdx] * 1000;
  slideshow.timer = setTimeout(() => {
    if (!slideshow.playing || !lbState.open) return;
    const atEnd = lbState.postIndex >= VISIBLE.length - 1;
    if (atEnd) { stopSlideshow(); return; }
    navigateLightbox(+1);
    _scheduleSlide();
  }, ms);
}

function cycleSpeed() {
  slideshow.speedIdx = (slideshow.speedIdx + 1) % SLIDE_SPEEDS.length;
  document.getElementById('lb-speed-label').textContent = `${SLIDE_SPEEDS[slideshow.speedIdx]}s`;
  // Restart timer with new speed if playing
  if (slideshow.playing) { clearTimeout(slideshow.timer); _scheduleSlide(); }
}

function _updateSlideshowUI() {
  const btn       = document.getElementById('lb-play-btn');
  const playIcon  = document.getElementById('lb-play-icon');
  const pauseIcon = document.getElementById('lb-pause-icon');
  if (!playIcon || !pauseIcon) return;
  if (slideshow.playing) {
    playIcon.style.display  = 'none';
    pauseIcon.style.display = '';
    btn?.classList.add('playing');
  } else {
    playIcon.style.display  = '';
    pauseIcon.style.display = 'none';
    btn?.classList.remove('playing');
  }
}

// ── Layout switcher ───────────────────────────────────────────────────────────

let switching = false;

function applyLayout(name) {
  if (switching || name === activeLayout) return;
  switching = true; activeLayout = name;
  document.body.classList.remove('layout-masonry', 'layout-grid', 'layout-feed');
  document.body.classList.add(`layout-${name}`);

  const grid = document.getElementById('grid');
  grid.style.transition = 'opacity 0.15s ease';
  grid.style.opacity    = '0';
  setTimeout(() => {
    cam.x = cam.y = cam.tx = cam.ty = 0;
    for (const [k, e] of active) { release(e.el); active.delete(k); }
    buildLayout(); render();
    grid.style.transition = 'opacity 0.22s ease';
    grid.style.opacity    = '1';
    setTimeout(() => { grid.style.transition = ''; switching = false; }, 230);
  }, 160);
}

function resetCamera() {
  cam.x = cam.y = cam.tx = cam.ty = 0;
  for (const [k, e] of active) { release(e.el); active.delete(k); }
  buildLayout(); render();
}

// ── Edit mode ─────────────────────────────────────────────────────────────────

function saveHidden() {
  if (!HANDLE) return;
  fetch('/api/hidden', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: HANDLE, hiddenIds: [...hiddenIds] }),
  }).catch(() => {});
}

function updateEditCounter() {
  const el = document.getElementById('edit-counter');
  if (!el) return;
  const total   = ALL_POSTS.filter(p => p.images?.length > 0).length;
  const visible = total - hiddenIds.size;
  el.textContent = `${visible}/${total}`;
}

// ── Load more ─────────────────────────────────────────────────────────────────

function setLoadMoreIdle() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.querySelector('.load-more-label').textContent = 'Load more';
  btn.querySelector('.load-more-spinner').style.display = 'none';
}

function setLoadMoreError(msg) {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.disabled = false;
  btn.title = `Error: ${msg}`;
  btn.querySelector('.load-more-label').textContent = 'Retry';
  btn.querySelector('.load-more-spinner').style.display = 'none';
}

function appendPosts(newPosts, total, hasMore) {
  FETCH_META.hasMore = hasMore;
  const existing = new Set(ALL_POSTS.map(p => p.id));
  const fresh    = newPosts.filter(p => !existing.has(p.id) && p.images?.length > 0);
  if (fresh.length) {
    ALL_POSTS = [...ALL_POSTS, ...fresh];
    buildLayout();
    for (const [k, e] of active) { release(e.el); active.delete(k); }
    render();
    updateProfileHeader();
  }
  const btn = document.getElementById('load-more-btn');
  if (btn) { if (!hasMore) btn.style.display = 'none'; else setLoadMoreIdle(); }
}

// ── Profile header ────────────────────────────────────────────────────────────

function updateProfileHeader() {
  const count = ALL_POSTS.filter(p => p.images?.length > 0).length;
  const c = document.getElementById('ph-count');
  if (c) c.textContent = `${count} posts`;
  const a = document.getElementById('ph-ago');
  if (a && FETCH_META.fetchedAt) a.textContent = timeAgo(FETCH_META.fetchedAt);
}

function buildProfileHeader() {
  document.getElementById('profile-header')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'profile-header'; wrap.className = 'profile-header glass-card';

  // Avatar + name
  const left = document.createElement('a');
  left.className = 'ph-left'; left.href = PROFILE?.url || '#';
  left.target = '_blank'; left.rel = 'noopener noreferrer';
  if (PROFILE?.avatar) {
    const img = document.createElement('img');
    img.className = 'profile-header-avatar'; img.src = PROFILE.avatar; img.alt = '';
    left.appendChild(img);
  }
  const ng = document.createElement('div');
  ng.className = 'ph-name-group';
  const ns = document.createElement('span');
  ns.className = 'profile-header-name'; ns.textContent = PROFILE?.name || HANDLE;
  const hs = document.createElement('span');
  hs.className = 'profile-header-handle'; hs.textContent = `@${HANDLE}`;
  ng.append(ns, hs); left.appendChild(ng);
  wrap.appendChild(left);

  // Divider
  const div = document.createElement('div');
  div.className = 'ph-divider'; wrap.appendChild(div);

  // Meta + refresh
  const right = document.createElement('div');
  right.className = 'ph-right';
  const meta = document.createElement('div');
  meta.className = 'ph-meta';

  const countEl = document.createElement('span');
  countEl.id = 'ph-count'; countEl.className = 'ph-meta-item';
  countEl.textContent = `${ALL_POSTS.filter(p => p.images?.length).length} posts`;
  meta.appendChild(countEl);

  if (FETCH_META.fetchedAt) {
    const sep = document.createElement('span');
    sep.className = 'ph-meta-sep'; sep.textContent = '·'; meta.appendChild(sep);
    const ago = document.createElement('span');
    ago.id = 'ph-ago'; ago.className = 'ph-meta-item';
    ago.textContent = timeAgo(FETCH_META.fetchedAt); meta.appendChild(ago);
  }

  right.appendChild(meta);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'ph-refresh-btn'; resetBtn.title = 'Search another account';
  resetBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  resetBtn.addEventListener('click', () => goToLanding());
  right.appendChild(resetBtn);

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'ph-refresh-btn'; reloadBtn.title = 'Re-fetch all posts';
  reloadBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
  reloadBtn.addEventListener('click', async () => {
    reloadBtn.classList.add('spinning');
    try { await fetch(`/api/cache/${HANDLE}`, { method: 'DELETE' }); } catch {}
    goToLoading(HANDLE);
  });
  right.appendChild(reloadBtn);
  wrap.appendChild(right);

  document.getElementById('view-portfolio').appendChild(wrap);
}

function goToLoading(handle) {
  rafRunning = false;
  for (const [k, e] of active) { release(e.el); active.delete(k); }
  cam.x = cam.y = cam.tx = cam.ty = 0;
  ALL_POSTS = []; VISIBLE = [];
  document.getElementById('profile-header')?.remove();
  document.getElementById('toolbar')?.remove();
  lbState.cloneEl?.remove(); lbState.cloneEl = null;
  document.getElementById('lightbox-overlay').classList.remove('active');
  document.body.classList.remove('lightbox-open', 'edit-mode');
  showView('loading');
  startLoading(handle, false);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function buildToolbar() {
  document.getElementById('toolbar')?.remove();

  const toolbar = document.createElement('div');
  toolbar.id = 'toolbar'; toolbar.className = 'toolbar';

  // ── Layout group
  const layoutGroup = makeGlassGroup();
  [
    { id: 'masonry', icon: 'assets/masonry.svg', label: 'Masonry' },
    { id: 'grid',    icon: 'assets/grid.svg',    label: 'Grid' },
    { id: 'feed',    icon: 'assets/feed.svg',    label: 'Feed' },
  ].forEach(l => {
    const btn = makeIconBtn(l.icon, l.label, l.id === activeLayout);
    btn.addEventListener('click', () => {
      layoutGroup.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyLayout(l.id);
    });
    layoutGroup.appendChild(btn);
  });
  toolbar.appendChild(layoutGroup);

  // ── Column group
  const colGroup = makeGlassGroup();
  const colLabel = document.createElement('span');
  colLabel.className = 'ph-meta-item'; colLabel.style.padding = '0 4px';
  colLabel.textContent = `${numCols} col`;
  colLabel.id = 'col-label';

  const colMinus = makeLabelBtn('−', 'Fewer columns');
  const colPlus  = makeLabelBtn('+', 'More columns');
  colMinus.addEventListener('click', () => {
    if (numCols <= 2) return;
    numCols--;
    colLabel.textContent = `${numCols} col`;
    resetCamera();
  });
  colPlus.addEventListener('click', () => {
    if (numCols >= 8) return;
    numCols++;
    colLabel.textContent = `${numCols} col`;
    resetCamera();
  });
  colGroup.append(colMinus, colLabel, colPlus);
  toolbar.appendChild(colGroup);

  // ── Sort group
  const sortGroup = makeGlassGroup();
  const sortModes = ['newest', 'oldest', 'likes'];
  const sortLabels = { newest: '↓ Date', oldest: '↑ Date', likes: '♥ Top' };
  const sortBtn = document.createElement('button');
  sortBtn.className = 'toolbar-btn load-more-btn'; // reuse style for text btn
  sortBtn.title = 'Change sort order';
  sortBtn.style.minWidth = '62px';

  const updateSortBtn = () => {
    sortBtn.innerHTML = `<span class="load-more-label">${sortLabels[sortMode]}</span>`;
  };
  updateSortBtn();

  sortBtn.addEventListener('click', () => {
    const idx = sortModes.indexOf(sortMode);
    sortMode = sortModes[(idx + 1) % sortModes.length];
    updateSortBtn();
    cam.x = cam.y = cam.tx = cam.ty = 0;
    for (const [k, e] of active) { release(e.el); active.delete(k); }
    buildLayout(); render();
  });
  sortGroup.appendChild(sortBtn);
  toolbar.appendChild(sortGroup);

  // ── Edit group (localhost only)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    const editGroup = makeGlassGroup();
    const editBtn = makeIconBtn('assets/edit.svg', 'Edit — click posts to hide/show', false);
    editBtn.id = 'edit-btn';
    const counter = document.createElement('span');
    counter.id = 'edit-counter'; counter.className = 'edit-counter';
    editBtn.addEventListener('click', () => {
      editMode = !editMode;
      editBtn.classList.toggle('active', editMode);
      counter.classList.toggle('visible', editMode);
      document.body.classList.toggle('edit-mode', editMode);
      if (editMode) updateEditCounter();
      for (const [k, e] of active) { release(e.el); active.delete(k); }
      buildLayout(); render();
    });
    editGroup.append(editBtn, counter);
    toolbar.appendChild(editGroup);
  }

  // ── Load more (if available)
  if (FETCH_META.hasMore) {
    const moreGroup = makeGlassGroup();
    const moreBtn = document.createElement('button');
    moreBtn.id = 'load-more-btn'; moreBtn.className = 'toolbar-btn load-more-btn';
    moreBtn.title = 'Load more posts';
    moreBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      <span class="load-more-label">Load more</span>
      <span class="load-more-spinner" style="display:none"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="spinner-icon"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0"/></svg></span>`;
    moreBtn.addEventListener('click', () => {
      if (moreBtn.disabled) return;
      moreBtn.disabled = true;
      moreBtn.querySelector('.load-more-label').textContent = 'Fetching...';
      moreBtn.querySelector('.load-more-spinner').style.display = '';
      startLoading(HANDLE, true);
    });
    moreGroup.appendChild(moreBtn);
    toolbar.appendChild(moreGroup);
  }

  // ── Right: search + theme
  const rightGroup = makeGlassGroup();
  const searchBtn = document.createElement('button');
  searchBtn.className = 'toolbar-btn'; searchBtn.title = 'Search another account';
  searchBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
  searchBtn.addEventListener('click', goToLanding);
  rightGroup.appendChild(searchBtn);

  const themeBtn = makeIconBtn('assets/theme.svg', 'Toggle light / dark', false);
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
  rightGroup.appendChild(themeBtn);
  toolbar.appendChild(rightGroup);

  document.getElementById('view-portfolio').appendChild(toolbar);
}

function makeGlassGroup() {
  const g = document.createElement('div');
  g.className = 'toolbar-group glass-card';
  return g;
}

function makeIconBtn(icon, title, isActive) {
  const btn = document.createElement('button');
  btn.className = `toolbar-btn${isActive ? ' active' : ''}`;
  btn.title = title;
  btn.innerHTML = `<img src="${icon}" alt="${title}" width="18" height="18">`;
  return btn;
}

function makeLabelBtn(label, title) {
  const btn = document.createElement('button');
  btn.className = 'toolbar-btn';
  btn.title = title;
  btn.innerHTML = `<span class="toolbar-btn-label">${label}</span>`;
  return btn;
}

// ── Go to landing ─────────────────────────────────────────────────────────────

function goToLanding() {
  rafRunning = false;
  activeSSE?.close(); activeSSE = null;
  document.getElementById('profile-header')?.remove();
  document.getElementById('toolbar')?.remove();
  lbState.cloneEl?.remove(); lbState.cloneEl = null;
  document.getElementById('lightbox-overlay').classList.remove('active');
  document.body.classList.remove('lightbox-open', 'edit-mode',
    'layout-masonry', 'layout-grid', 'layout-feed');
  for (const [k, e] of active) { release(e.el); active.delete(k); }
  cam.x = cam.y = cam.tx = cam.ty = 0;
  ALL_POSTS = []; SORTED = []; VISIBLE = []; PROFILE = null; HANDLE = null;
  FETCH_META = { fetchedAt: null, hasMore: false };
  lbState.open = lbState.animating = false; lbState.sourceEl = null;
  editMode = false; sortMode = 'newest';
  showView('landing');
  initLanding();
}

// ── Launch portfolio ───────────────────────────────────────────────────────────

let poolReady = false;

function launchPortfolio(data, handle) {
  ALL_POSTS    = data.posts  || [];
  PROFILE      = data.profile || null;
  HANDLE       = handle;
  hiddenIds    = new Set(data.hiddenIds || []);
  FETCH_META   = { fetchedAt: data.fetchedAt || null, hasMore: data.hasMore || false };
  activeLayout = 'masonry';
  sortMode     = 'newest';
  editMode     = false;
  switching    = false;

  document.title = `@${handle} — twitter-dash`;
  document.body.classList.remove('layout-masonry', 'layout-grid', 'layout-feed');
  document.body.classList.add('layout-masonry');

  showView('portfolio');
  buildLayout();

  if (!poolReady) { initPool(); poolReady = true; }
  else { for (const [k, e] of active) { release(e.el); active.delete(k); } }

  render();
  buildProfileHeader();
  buildToolbar();
  attachPortfolioEvents();

  // Warm up Motion
  const w = document.createElement('div');
  w.style.cssText = 'position:fixed;top:-9999px;width:1px;height:1px;';
  document.body.appendChild(w);
  Motion.animate(w, { opacity: [0, 1] }, { duration: 0.01 }).then(() => w.remove());

  rafRunning = false;
  startRaf();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

initTheme();
showView('landing');
initLanding();
