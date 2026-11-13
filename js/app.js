/**
 * Endless Treasury - Core Application Logic
 *
 * Implements:
 * - KJV scripture traversal and verse reference parsing
 * - Inverted full-text topic search with stemming and IDF weighting
 * - Personalized PageRank (PPR) over the Treasury of Scripture Knowledge (TSK) graph
 * - Strong's concordance original language word studies
 * - Browser SpeechSynthesis (TTS) playback engine and MediaSession integration
 * - Responsive UI event listeners, dials, and theme management
 */

(function() {
  'use strict';

  // 1. Verify Data Dependencies
  if (typeof window.G === 'undefined' || typeof window.SW === 'undefined') {
    console.error('Endless Treasury: Required data (G or SW) is not loaded.');
    const note = document.getElementById('seedNote');
    if (note) {
      note.textContent = 'Error: Bible data could not be loaded. Please ensure data.js is loaded.';
    }
    return;
  }

  const G = window.G;
  const SW = window.SW;
  const BOOKS = G.books, CH = G.chap, TEXT = G.text, ADJ = G.adj;

  // Chapter verse offsets and lookup index
  const chapStart = new Int32Array(CH.length);
  const chapIdx = new Map();
  (() => {
    let c = 0;
    CH.forEach((x, k) => {
      chapStart[k] = c;
      c += x[2];
      chapIdx.set(x[0] + ':' + x[1], k);
    });
  })();

  function chapOf(i) {
    let lo = 0, hi = CH.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (chapStart[m] <= i) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  function spanOf(i, n) {
    const k = chapOf(i);
    return Math.max(1, Math.min(n, CH[k][2] - (i - chapStart[k])));
  }

  function refOf(i, n = 1) {
    const k = chapOf(i), v = i - chapStart[k] + 1, nn = spanOf(i, n);
    return BOOKS[CH[k][0]] + ' ' + CH[k][1] + ':' + v + (nn > 1 ? '–' + (v + nn - 1) : '');
  }

  function spokenRef(i, n = 1) {
    const k = chapOf(i), v = i - chapStart[k] + 1, nn = spanOf(i, n);
    return BOOKS[CH[k][0]] + ' ' + CH[k][1] + (nn > 1 ? ', verses ' + v + ' to ' + (v + nn - 1) : ', verse ' + v);
  }

  /* ---------- Reference Parsing ---------- */
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const ALIAS = {
    jn: 'John', mt: 'Matthew', mk: 'Mark', lk: 'Luke', ps: 'Psalms', psalm: 'Psalms', pss: 'Psalms',
    phm: 'Philemon', php: 'Philippians', jas: 'James', jm: 'James', sos: 'Song of Solomon',
    song: 'Song of Solomon', songofsongs: 'Song of Solomon', rev: 'Revelation', dt: 'Deuteronomy',
    jdg: 'Judges', jud: 'Jude', gen: 'Genesis', ex: 'Exodus', num: 'Numbers', josh: 'Joshua',
    prov: 'Proverbs', pr: 'Proverbs', eccl: 'Ecclesiastes', isa: 'Isaiah', heb: 'Hebrews',
    rom: 'Romans', gal: 'Galatians', eph: 'Ephesians', col: 'Colossians', tit: 'Titus',
    mal: 'Malachi', zech: 'Zechariah', '1co': '1 Corinthians', '2co': '2 Corinthians',
    '1th': '1 Thessalonians', '2th': '2 Thessalonians', '1ti': '1 Timothy', '2ti': '2 Timothy',
    '1pe': '1 Peter', '2pe': '2 Peter', '1jn': '1 John', '2jn': '2 John', '3jn': '3 John'
  };
  const ROMAN = { i: '1', ii: '2', iii: '3' };

  function findBook(key, allowPrefix) {
    const names = BOOKS.map(b => norm(b));
    let k = names.indexOf(key);
    if (k >= 0) return k;
    const al = ALIAS[key];
    if (al) return BOOKS.indexOf(al);
    if (allowPrefix && key.length >= 2) {
      k = names.findIndex(n => n.startsWith(key));
      if (k >= 0) return k;
    }
    return -1;
  }

  const REF_RE = /^\s*(?:(1|2|3)\s*|(iii|ii|i)\s+)?([a-z]+(?:\s+of\s+[a-z]+)?)\.?\s*(?:(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?)?\s*$/i;

  function parseRef(q) {
    const m = REF_RE.exec(q);
    if (!m) return null;
    const pre = m[1] || m[2];
    const num = pre ? (ROMAN[pre.toLowerCase()] || pre) : '';
    const key = num + norm(m[3]);
    const hasCh = m[4] != null;
    const b = findBook(key, hasCh);
    if (b < 0) return null;
    const ch = hasCh ? +m[4] : 1;
    const k = chapIdx.get(b + ':' + ch);
    if (k == null) return { error: BOOKS[b] + ' has no chapter ' + ch + '.' };
    const v = m[5] ? Math.min(+m[5], CH[k][2]) : 1;
    const i = chapStart[k] + v - 1;
    const n = m[6] ? Math.max(1, Math.min(3, +m[6] - v + 1)) : 1;
    return { i, n: spanOf(i, n), label: refOf(i, n), chapterOnly: !m[5] };
  }

  /* ---------- Word Index & Stemming ---------- */
  const STOP = new Set('the and of to a an in that is for with on about verses verse bible scripture scriptures what why how does do from by as it its be are was were this those these me my i you your our us find show play read tell'.split(' '));

  function stem(w) {
    w = w.toLowerCase();
    for (const s of ['ness', 'ing', 'eth', 'est', 'ed', 'es', 'en', 'ful', 's']) {
      if (w.length > s.length + 2 && w.endsWith(s)) {
        w = w.slice(0, -s.length);
        break;
      }
    }
    return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
  }

  let IDX = null;
  function buildIndex() {
    const ids = new Map(), names = [], post = [], vstems = new Array(TEXT.length), surf = [];
    for (let i = 0; i < TEXT.length; i++) {
      const seen = [];
      for (const t of TEXT[i].toLowerCase().match(/[a-z]+/g) || []) {
        const s = stem(t);
        let id = ids.get(s);
        if (id === undefined) {
          id = names.length;
          ids.set(s, id);
          names.push(s);
          post.push([]);
          surf.push(new Map());
        }
        if (seen.indexOf(id) < 0) {
          seen.push(id);
          post[id].push(i);
        }
        const m = surf[id];
        m.set(t, (m.get(t) || 0) + 1);
      }
      vstems[i] = seen;
    }
    const N = TEXT.length, idf = new Float64Array(names.length);
    for (let id = 0; id < names.length; id++) {
      idf[id] = Math.log(N / post[id].length);
    }
    IDX = { ids, names, post, vstems, idf, surf };
  }

  function topSurface(id) {
    const m = IDX.surf[id];
    if (!m || !m.size) return IDX.names[id];
    let best = '', bestN = 0;
    for (const [w, n] of m) {
      if (n > bestN) { best = w; bestN = n; }
    }
    return best;
  }

  function lcs(a, b) {
    let best = 0;
    const dp = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let prev = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : 0;
        if (dp[j] > best) best = dp[j];
        prev = tmp;
      }
    }
    return best;
  }

  function suggestTerms(q) {
    if (!IDX) buildIndex();
    const st = stem(q.toLowerCase().replace(/[^a-z]/g, ''));
    if (!st) return [];
    const out = [];
    for (let id = 0; id < IDX.names.length; id++) {
      const s = IDX.names[id], df = IDX.post[id].length;
      if (s.length < 4 || df < 2) continue;
      const L = lcs(st, s);
      const cov = L / Math.max(st.length, s.length);
      const revPref = st.startsWith(s) ? 0.85 : 0;
      if (L < 4 && !revPref) continue;
      const score = Math.max(cov, revPref) * (1 + Math.log(df) / 8);
      out.push({ stem: s, score, df, surface: topSurface(id) });
    }
    out.sort((a, b) => b.score - a.score);
    const seen = new Set(), res = [];
    for (const x of out) {
      if (seen.has(x.stem)) continue;
      seen.add(x.stem);
      res.push(x.surface + ' · ' + x.df + ' verses');
      if (res.length === 5) break;
    }
    return res;
  }

  function searchTopic(q, limit = 40) {
    if (!IDX) buildIndex();
    const terms = [...new Set((q.toLowerCase().match(/[a-z]+/g) || []).filter(w => !STOP.has(w)).map(stem))];
    const match = new Map();
    if (!terms.length) return { ids: [], terms, match };

    const hits = new Map();
    terms.forEach((t, ti) => {
      const tid = IDX.ids.get(t), matched = [];
      if (tid !== undefined) matched.push(tid);
      if (t.length >= 5) {
        for (const [s, id] of IDX.ids) {
          if (id !== tid && s.length <= t.length + 2 && s.startsWith(t) && matched.length < 12) {
            matched.push(id);
          }
        }
      }
      for (const id of matched) {
        const exact = id === tid;
        match.set(id, Math.max(match.get(id) || 0, exact ? 1 : 0.4));
        const w = IDX.idf[id] * (exact ? 1 : 0.4);
        for (const v of IDX.post[id]) {
          const h = hits.get(v) || { score: 0, mask: 0 };
          h.score += w;
          h.mask |= 1 << ti;
          hits.set(v, h);
        }
      }
    });

    const out = [];
    for (const [v, h] of hits) {
      let cov = 0;
      for (let m = h.mask; m; m &= m - 1) cov++;
      const deg = ADJ[v].length / 3;
      out.push([v, h.score * (1 + 0.8 * (cov - 1)) * (1 + Math.log(1 + deg) / 5) / (1 + TEXT[v].length / 350)]);
    }
    out.sort((a, b) => b[1] - a[1]);
    return { ids: out.slice(0, limit).map(x => x[0]), terms, match };
  }

  /* ---------- Link Graph & Personalized PageRank ---------- */
  let GR = null, INADJ = null;
  function buildGraph() {
    const N = TEXT.length, deg = new Int32Array(N);
    INADJ = Array.from({ length: N }, () => []);
    for (let u = 0; u < N; u++) {
      const e = ADJ[u];
      for (let k = 0; k < e.length; k += 3) {
        deg[u]++;
        deg[e[k]]++;
        INADJ[e[k]].push(u, e[k + 2]);
      }
    }
    const off = new Int32Array(N + 1);
    for (let u = 0; u < N; u++) off[u + 1] = off[u] + deg[u];
    const fill = off.slice(0, N), to = new Int32Array(off[N]), w = new Float32Array(off[N]), tw = new Float64Array(N);
    for (let u = 0; u < N; u++) {
      const e = ADJ[u];
      for (let k = 0; k < e.length; k += 3) {
        const t = e[k], ww = Math.log(1 + e[k + 2]);
        to[fill[u]] = t; w[fill[u]++] = ww; tw[u] += ww;
        to[fill[t]] = u; w[fill[t]++] = ww; tw[t] += ww;
      }
    }
    GR = { off, to, w, tw };
  }

  function ppr(seedList, alpha = 0.25, iters = 25) {
    if (!GR) buildGraph();
    const N = TEXT.length, { off, to, w, tw } = GR;
    const s = new Float64Array(N);
    let tot = 0;
    for (const [v, x] of seedList) { s[v] += x; tot += x; }
    for (const [v] of seedList) s[v] /= tot;
    let p = Float64Array.from(s), q = new Float64Array(N);
    for (let it = 0; it < iters; it++) {
      q.fill(0);
      for (let u = 0; u < N; u++) {
        const pu = p[u];
        if (pu === 0 || tw[u] === 0) continue;
        const m = pu * (1 - alpha) / tw[u];
        for (let k = off[u]; k < off[u + 1]; k++) q[to[k]] += m * w[k];
      }
      let sum = 0;
      for (let v = 0; v < N; v++) sum += q[v];
      const rest = 1 - sum;
      for (const [v] of seedList) q[v] += s[v] * rest;
      const t = p; p = q; q = t;
    }
    return p;
  }

  /* ---------- The Anchor: On-Topic Scoring ---------- */
  function buildAnchor(seedList, profile) {
    if (!IDX) buildIndex();
    const N = TEXT.length, p = ppr(seedList), tw = GR.tw;
    const graphScore = new Float64Array(N);
    for (let v = 0; v < N; v++) graphScore[v] = p[v] / Math.sqrt(tw[v] + 1);
    const wordScore = new Float64Array(N);
    for (const [id, wt] of profile) {
      if (IDX.post[id].length > 3000) continue;
      const x = wt * IDX.idf[id];
      for (const v of IDX.post[id]) wordScore[v] += x;
    }
    for (let v = 0; v < N; v++) wordScore[v] /= Math.sqrt(IDX.vstems[v].length + 3);
    const rank = arr => {
      const idx = Int32Array.from({ length: N }, (_, i) => i).sort((a, b) => arr[b] - arr[a]);
      const r = new Int32Array(N);
      for (let k = 0; k < N; k++) r[idx[k]] = k;
      return r;
    };
    const r1 = rank(graphScore), r2 = rank(wordScore);
    const f = new Float64Array(N);
    let fmax = 0;
    for (let v = 0; v < N; v++) {
      f[v] = 1 / (40 + Math.max(r1[v], Math.min(r2[v], 4000)));
      if (f[v] > fmax) fmax = f[v];
    }
    const seedSet = new Set(seedList.map(x => x[0]));
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => (seedSet.has(b) - seedSet.has(a)) || f[b] - f[a]);
    const pos = new Int32Array(N), rel = new Float64Array(N);
    order.forEach((v, k) => {
      pos[v] = k;
      rel[v] = seedSet.has(v) ? 1 : Math.min(1, f[v] / fmax);
    });
    return { order, pos, rel };
  }

  function anchorFromTopic(res) {
    if (!IDX) buildIndex();
    const seedList = res.ids.map((v, k) => [v, 1 / (1 + k / 8)]);
    const prof = new Map();
    for (const [id, m] of res.match) prof.set(id, 3 * m);
    res.ids.slice(0, 25).forEach((v, k) => {
      const x = 0.35 / (1 + k / 8);
      for (const id of IDX.vstems[v]) prof.set(id, (prof.get(id) || 0) + x);
    });
    return buildAnchor(seedList, prof);
  }

  function anchorFromRef(i, n, wholeChapter) {
    if (!IDX) buildIndex();
    const seedV = [];
    if (wholeChapter) {
      const k = chapOf(i);
      for (let v = 0; v < Math.min(CH[k][2], 40); v++) seedV.push(chapStart[k] + v);
    } else {
      for (let k = 0; k < n; k++) seedV.push(i + k);
    }
    const prof = new Map();
    const bump = (v, x) => {
      for (const id of IDX.vstems[v]) prof.set(id, (prof.get(id) || 0) + x);
    };
    for (const v of seedV) {
      bump(v, 1);
      const e = ADJ[v];
      for (let k = 0; k < Math.min(e.length, 18); k += 3) bump(e[k], 0.25);
    }
    return buildAnchor(seedV.map(v => [v, 1]), prof);
  }

  function poolSize(v) {
    return Math.round(44 * Math.pow(2500 / 44, v / 100));
  }

  /* ---------- The Walk ---------- */
  const rand = Math.random;
  function weightedPick(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = rand() * total;
    for (let k = 0; k < items.length; k++) {
      r -= weights[k];
      if (r <= 0) return items[k];
    }
    return items[items.length - 1];
  }

  function chooseNext(cur, A, S, jump, K) {
    const cool = Math.max(10, Math.min(250, Math.floor(K * 0.5)));
    const ok = v => {
      const l = S.last.get(v);
      return l === undefined || S.step - l >= cool;
    };

    if (rand() >= jump) {
      let ni = cur.i + cur.n;
      if (ni >= TEXT.length) ni = 0;
      if (A.pos[ni] < K && ok(ni)) return { i: ni, n: 1, via: 'next', from: cur.i };
    }

    if (!GR) buildGraph();
    const cand = new Map();
    const add = (t, n, votes, mul) => {
      if (t === cur.i || A.pos[t] >= K || !ok(t)) return;
      const w = Math.pow(Math.max(votes, 1), 0.7) * Math.pow(0.25 + A.rel[t], 2) * mul * (S.last.has(t) ? 0.4 : 1);
      const o = cand.get(t);
      if (!o || w > o.w) cand.set(t, { t, n, votes, w });
    };

    const e = ADJ[cur.i];
    for (let k = 0; k < e.length; k += 3) add(e[k], spanOf(e[k], e[k + 1]), e[k + 2], 1);
    const r = INADJ[cur.i];
    for (let k = 0; k < r.length; k += 2) add(r[k], 1, r[k + 1], 0.8);

    if (cand.size) {
      const arr = [...cand.values()], c = weightedPick(arr, arr.map(x => x.w));
      return { i: c.t, n: c.n, via: 'ref', from: cur.i, votes: c.votes };
    }

    const pool = [];
    for (let tries = 0; tries < 120; tries++) {
      const v = A.order[Math.floor(rand() * Math.min(K, TEXT.length))];
      if (v !== cur.i) pool.push(v);
    }
    const fresh = pool.filter(ok);
    if (fresh.length) {
      const v = weightedPick(fresh, fresh.map(x => 0.25 + A.rel[x]));
      return { i: v, n: 1, via: 'return', from: cur.i };
    }
    let oldest = pool[0];
    for (const v of pool) {
      if ((S.last.get(v) ?? -1) < (S.last.get(oldest) ?? -1)) oldest = v;
    }
    return { i: oldest, n: 1, via: 'return', from: cur.i };
  }

  /* ---------- Original-Language Words (Strong's) ---------- */
  const occCache = new Map();
  function occOf(id) {
    let a = occCache.get(id);
    if (!a) {
      a = [];
      let x = 0;
      for (const d of SW.o[id]) {
        x += d;
        a.push(x);
      }
      occCache.set(id, a);
    }
    return a;
  }

  let KJVW = null;
  function wordSearch(term) {
    if (!IDX) buildIndex();
    const t = (term.toLowerCase().match(/[a-z]+/g) || []).filter(w => !STOP.has(w)).map(stem);
    if (t.length !== 1) return [];
    const tid = IDX.ids.get(t[0]);
    if (tid === undefined) return [];
    if (!KJVW) {
      KJVW = new Map();
      for (const id in SW.d) {
        for (const w of SW.d[id][3].toLowerCase().match(/[a-z]{3,}/g) || []) {
          const s = stem(w);
          let a = KJVW.get(s);
          if (!a) KJVW.set(s, a = []);
          if (a[a.length - 1] !== id) a.push(id);
        }
      }
    }
    const out = [];
    for (const id of KJVW.get(t[0]) || []) {
      const vs = occOf(id);
      let n = 0;
      for (const v of vs) {
        if (IDX.vstems[v].includes(tid)) n++;
      }
      if (n >= 2 && n / vs.length >= 0.12) out.push({ id, n, total: vs.length });
    }
    return out.sort((a, b) => b.n - a.n).slice(0, 20);
  }

  /* ---------- Audio & Speech Engine (Zero-Signup / Background Mobile Audio) ---------- */
  const $ = id => document.getElementById(id);
  const ttsOK = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  let localVoices = [];

  function store(k, v) {
    try { localStorage.setItem('et_' + k, v); } catch (e) {}
  }
  function load(k) {
    try { return localStorage.getItem('et_' + k); } catch (e) { return null; }
  }

  function loadVoices() {
    const sel = $('voice');
    if (!sel) return;
    const saved = load('voice') || 'cloud:google';
    sel.innerHTML = '';

    // Public Cloud Audio Stream (Real HTML5 <audio> / Background & Lock-Screen Audio / No Signup)
    const cloudGroup = document.createElement('optgroup');
    cloudGroup.label = 'Cloud Stream (Background & Lock-Screen Audio)';
    const optCloud = document.createElement('option');
    optCloud.value = 'cloud:google';
    optCloud.textContent = 'Google Cloud Audio (No sign-up required)';
    cloudGroup.appendChild(optCloud);
    sel.appendChild(cloudGroup);

    // Device Local Voices (Offline / Native SpeechSynthesis)
    if (ttsOK) {
      localVoices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
      if (localVoices.length) {
        const localGroup = document.createElement('optgroup');
        localGroup.label = 'Device Local Voices (Offline)';
        localVoices.forEach((v, k) => {
          const opt = document.createElement('option');
          opt.value = 'local:' + k;
          opt.textContent = v.name + ' (' + v.lang + ')';
          localGroup.appendChild(opt);
        });
        sel.appendChild(localGroup);
      }
    }

    let match = Array.from(sel.options).find(o => o.value === saved);
    if (!match && saved && ttsOK) {
      match = Array.from(sel.options).find(o => o.textContent.includes(saved));
    }
    sel.value = match ? match.value : 'cloud:google';
  }

  if (ttsOK) {
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }
  loadVoices();

  function splitIntoChunks(text, maxLen = 175) {
    const words = text.split(' ');
    const chunks = [];
    let current = [];
    let curLen = 0;
    for (const w of words) {
      if (curLen + w.length + 1 > maxLen && current.length > 0) {
        chunks.push(current.join(' '));
        current = [w];
        curLen = w.length;
      } else {
        current.push(w);
        curLen += w.length + 1;
      }
    }
    if (current.length) chunks.push(current.join(' '));
    return chunks;
  }

  const rate = () => +$('rate').value / 100;
  const soundOn = () => $('sound').checked;

  /* ---------- Playback diagnostics ---------- */
  const diagEvents = [];
  const DIAG_LIMIT = 160;

  function diagEnvironment() {
    let standalone = false;
    try {
      standalone = !!(navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {}
    return {
      userAgent: navigator.userAgent || 'unknown',
      platform: navigator.platform || 'unknown',
      standalone,
      visibility: document.visibilityState || (document.hidden ? 'hidden' : 'visible'),
      online: navigator.onLine,
      speechSynthesis: ttsOK,
      mediaSession: 'mediaSession' in navigator,
      mediaPlaybackState: navigator.mediaSession?.playbackState || 'unknown',
      sound: soundOn(),
      voice: $('voice')?.value || 'default',
      localVoiceCount: localVoices.length,
      speed: $('rate')?.value || 'unknown',
      gapMs: $('gap')?.value || 'unknown',
      currentReference: $('refLabel')?.textContent || '',
      playButton: $('play')?.textContent || '',
      audioElements: Array.from(document.querySelectorAll('audio') || []).map(a => ({
        paused: a.paused,
        readyState: a.readyState,
        networkState: a.networkState,
        ...sourceInfo(a)
      }))
    };
  }

  function renderDiagnostics() {
    const log = $('playbackDiagLog');
    if (!log) return;
    const environment = JSON.stringify(diagEnvironment(), null, 2);
    const events = diagEvents.map(x => `${x.time} ${x.name}${x.detail ? ' ' + x.detail : ''}`).join('\n');
    log.textContent = `Environment:\n${environment}\n\nEvents:\n${events}`;
    log.scrollTop = log.scrollHeight;
  }

  function diag(name, details = {}) {
    let detail = '';
    try { detail = Object.keys(details).length ? JSON.stringify(details) : ''; }
    catch (e) { detail = String(details); }
    const ref = $('refLabel')?.textContent;
    const entry = {
      time: new Date().toLocaleTimeString(),
      name,
      detail: [ref ? `ref=${ref}` : '', detail].filter(Boolean).join(' ')
    };
    diagEvents.push(entry);
    if (diagEvents.length > DIAG_LIMIT) diagEvents.shift();
    const status = $('playbackDiagStatus');
    if (status) status.textContent = `${entry.time} — ${name}${detail ? ': ' + detail : ''}`;
    renderDiagnostics();
  }

  function errorInfo(err) {
    return {
      name: err?.name || 'Error',
      message: err?.message || String(err || 'unknown error')
    };
  }

  function sourceInfo(a) {
    const src = a.currentSrc || a.src || '';
    let origin = 'none';
    try { origin = new URL(src, location.href).origin; } catch (e) {}
    return {
      origin,
      readyState: a.readyState,
      networkState: a.networkState,
      duration: Number.isFinite(a.duration) ? +a.duration.toFixed(2) : String(a.duration),
      currentTime: Number.isFinite(a.currentTime) ? +a.currentTime.toFixed(2) : String(a.currentTime),
      mediaError: a.error ? { code: a.error.code, message: a.error.message || '' } : null
    };
  }

  diag('app.ready', diagEnvironment());
  document.addEventListener('visibilitychange', () => {
    diag('page.visibilitychange', { state: document.visibilityState || (document.hidden ? 'hidden' : 'visible') });
  });
  window.addEventListener('pagehide', e => diag('page.pagehide', { persisted: !!e.persisted }));
  window.addEventListener('pageshow', e => diag('page.pageshow', { persisted: !!e.persisted }));
  window.addEventListener('online', () => diag('network.online'));
  window.addEventListener('offline', () => diag('network.offline'));
  window.addEventListener('error', e => diag('js.error', { message: e.message, line: e.lineno, column: e.colno }));
  window.addEventListener('unhandledrejection', e => diag('js.unhandledrejection', errorInfo(e.reason)));

  /* ---------- Continuous Audio Pipeline ----------
   * Two alternating <audio> elements share a single queue. A verse is queued
   * as 1-3 speech segments, and the pause between verses is a silent segment
   * inside that same stream, so playback never actually stops. The next verse
   * is decided and prefetched the moment the current one starts, so the queue
   * never runs dry - which is what mobile OSes require to keep audio alive
   * when the page is sent to the background.
   */

  const silenceCache = new Map();
  function silenceUrl(ms) {
    if (silenceCache.has(ms)) return silenceCache.get(ms);
    const sr = 8000, n = Math.max(1, Math.round(sr * ms / 1000));
    const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, 36 + n, true);
    ws(8, 'WAVE'); ws(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    ws(36, 'data'); v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128);        // 8-bit PCM silence is 128, not 0
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    silenceCache.set(ms, url);
    return url;
  }

  const ttsUrl = q => 'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=' + encodeURIComponent(q);

  const player = (function () {
    const els = [null, null];
    const queue = [];       // items awaiting playback
    let slot = 0;           // element index for the next segment
    let gen = 0;            // bumped to cancel in-flight callbacks
    let live = false;
    let painted = null;     // step currently on screen
    let timer = 0;
    let warmed = false;
    let visibilityHandlerAttached = false;
    let diagnosticAudioId = 0;
    let pendingWatchdog = 0;

    const el = i => {
      let a = els[i];
      if (!a) {
        a = els[i] = new Audio();
        a._diagId = `audio-${++diagnosticAudioId}`;
        a.playsInline = true;
        a.webkitPlaysInline = true;
        a.preload = 'auto';
        for (const eventName of ['playing', 'waiting', 'stalled', 'ended', 'emptied', 'loadedmetadata', 'pause']) {
          a.addEventListener(eventName, () => diag(`audio.${eventName}`, { element: a._diagId, ...sourceInfo(a) }));
        }
        a.addEventListener('error', () => diag('audio.error-event', { element: a._diagId, ...sourceInfo(a) }));
        // Must be in DOM for iOS background audio to persist
        document.body.appendChild(a);
        diag('audio.element-created', { element: a._diagId, inDOM: a.isConnected });
      }
      return a;
    };

    function stepText(step) {
      const verses = [];
      for (let k = 0; k < step.n; k++) verses.push(TEXT[step.i + k]);
      return ($('announce').checked ? spokenRef(step.i, step.n) + '. ' : '') + verses.join(' ');
    }

    function clearPendingWatchdog() {
      if (pendingWatchdog) { clearTimeout(pendingWatchdog); pendingWatchdog = 0; }
    }

    function enqueue(step) {
      if (!step) return;
      const said = stepText(step);
      const cloud = $('voice').value === 'cloud:google';
      let segmentCount = 0;
      if (!soundOn()) {
        queue.push({ kind: 'tick', ms: (1400 + said.split(/\s+/).length * 330) / rate(), step });
        segmentCount = 1;
      } else if (cloud) {
        const chunks = splitIntoChunks(said);
        for (const c of chunks) queue.push({ kind: 'speech', url: ttsUrl(c), text: c, step });
        segmentCount = chunks.length;
      } else {
        queue.push({ kind: 'speech', speak: said, step });
        segmentCount = 1;
      }
      // Gap is queued without a URL and materialised on play, so dragging the
      // slider takes effect at the very next pause rather than a verse later.
      const gap = +$('gap').value;
      if (gap > 0) queue.push({ kind: 'gap', ms: gap });
      diag('verse.queued', { ref: refOf(step.i, step.n), voice: cloud ? 'cloud:google' : ($('voice').value || 'default'), segments: segmentCount, gapMs: gap });
    }

    function prefetch() {
      const next = queue[0];
      const idle = el(slot);
      if (!next || !next.url || idle._u === next.url) return;
      if (!idle.paused) return;   // don't interrupt the one-off warm-up
      idle._u = next.url;
      idle.src = next.url;
    }

    // The first segment runs on element 0 inside the tap that started playback,
    // so that element is unlocked by the gesture. Element 1 needs its own
    // gesture-activated play() call, which this provides.
    function warmOther() {
      if (warmed) return;
      warmed = true;
      const a = el(1);
      a._u = '';
      a.src = silenceUrl(150);
      diag('audio.warmup-request', { element: a._diagId, ...sourceInfo(a) });
      try {
        const result = a.play();
        if (result && typeof result.then === 'function') {
          result.then(() => diag('audio.warmup-resolved', { element: a._diagId }))
            .catch(err => diag('audio.warmup-rejected', { element: a._diagId, ...errorInfo(err), ...sourceInfo(a) }));
        }
      } catch (err) {
        diag('audio.warmup-threw', { element: a._diagId, ...errorInfo(err), ...sourceInfo(a) });
      }
    }

    function speakLocal(text, next) {
      if (!live) return;
      if (!text) {
        diag('speech.no-text');
        timer = setTimeout(next, 400);
        return;
      }
      if (!ttsOK) {
        diag('speech.unavailable-timed-advance', { chars: text.length });
        timer = setTimeout(next, Math.max(400, text.length * 60));
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      const val = $('voice').value;
      if (val.startsWith('local:')) {
        const v = localVoices[+val.slice(6)];
        if (v) { u.voice = v; u.lang = v.lang; }
      }
      u.rate = rate();
      let settled = false;
      const finish = (eventName, details = {}) => {
        if (settled) return;
        settled = true;
        clearPendingWatchdog();
        diag(eventName, { chars: text.length, voice: val || 'default', ...details });
        next();
      };
      u.onstart = () => diag('speech.started', { chars: text.length, voice: val || 'default', rate: u.rate });
      u.onend = () => finish('speech.ended');
      u.onerror = e => finish('speech.error', { error: e.error || e.name || 'unknown' });
      pendingWatchdog = setTimeout(() => {
        if (!settled) diag('speech.no-end-or-error-after-60s', { chars: text.length, voice: val || 'default' });
      }, 60000);
      diag('speech.speak-request', { chars: text.length, voice: val || 'default', rate: u.rate });
      try {
        speechSynthesis.speak(u);
      } catch (err) {
        finish('speech.speak-threw', errorInfo(err));
      }
    }

    function playNext(g) {
      if (!live || g !== gen) return;
      const it = queue.shift();
      if (!it) {
        // Defensive only: the queue is always extended at a verse's first
        // segment, so this should never fire.
        if (!live) return;
        const more = advance();
        if (more) enqueue(more);
        if (!queue.length) return;
        return playNext(g);
      }

      let done = false;
      const next = () => {
        if (done) return;
        done = true;
        clearPendingWatchdog();
        playNext(g);
      };

      // Paint and extend the queue exactly when a verse becomes audible, so the
      // walk state advances at the same relative point it always has.
      if (it.step && it.step !== painted) {
        painted = it.step;
        show(it.step);
        enqueue(advance());
      }

      if (it.kind === 'gap' && !it.url) it.url = soundOn() ? silenceUrl(it.ms) : '';

      if (it.url) {
        const a = el(slot);
        slot = 1 - slot;
        a.onended = () => {
          diag('audio.ended-handler', { element: a._diagId, kind: it.kind, ...sourceInfo(a) });
          next();
        };
        a.onerror = () => {
          clearPendingWatchdog();
          diag('audio.onerror-handler-fallback', { element: a._diagId, kind: it.kind, ...sourceInfo(a) });
          speakLocal(it.text, next);
        };
        a.ontimeupdate = () => {
          if ('mediaSession' in navigator) {
            try {
              navigator.mediaSession.setPositionState({
                duration: a.duration || 0,
                playbackRate: a.playbackRate,
                position: a.currentTime || 0
              });
            } catch (e) {}
          }
        };
        a.playbackRate = it.kind === 'gap' ? 1 : rate();   // gap stays literal ms
        if (a._u !== it.url) { a._u = it.url; a.src = it.url; }

        diag('audio.play-request', { element: a._diagId, kind: it.kind, ...sourceInfo(a) });
        pendingWatchdog = setTimeout(() => {
          if (!done) diag('audio.no-ended-or-error-after-60s', { element: a._diagId, kind: it.kind, ...sourceInfo(a) });
        }, 60000);
        // Update MediaSession metadata BEFORE play() so iOS lock screen picks it up
        if ('mediaSession' in navigator && it.step) {
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: refOf(it.step.i, it.step.n),
              artist: 'Endless Treasury',
              album: 'King James Bible',
              artwork: [{ src: 'icons/icon.svg', sizes: '192x192', type: 'image/svg+xml' }]
            });
            // Position state for lock screen scrubber
            navigator.mediaSession.setPositionState({
              duration: a.duration || 0,
              playbackRate: a.playbackRate,
              position: 0
            });
          } catch (e) {}
        }

        try {
          const playResult = a.play();
          if (playResult && typeof playResult.then === 'function') {
            playResult.then(() => {
              diag('audio.play-resolved', { element: a._diagId, kind: it.kind });
            }).catch(err => {
              clearPendingWatchdog();
              diag('audio.play-rejected', { element: a._diagId, kind: it.kind, ...errorInfo(err), ...sourceInfo(a) });
              if (err && err.name === 'NotAllowedError') { pause(); return; }
              speakLocal(it.text, next);
            });
          } else {
            diag('audio.play-no-promise', { element: a._diagId, kind: it.kind });
          }
        } catch (err) {
          clearPendingWatchdog();
          diag('audio.play-threw', { element: a._diagId, kind: it.kind, ...errorInfo(err), ...sourceInfo(a) });
          if (err && err.name === 'NotAllowedError') { pause(); return; }
          speakLocal(it.text, next);
        }
        prefetch();
        return;
      }

      if (it.speak) { speakLocal(it.speak, next); return; }
      diag('playback.timer-segment', { kind: it.kind, durationMs: it.ms });
      timer = setTimeout(() => {
        diag('playback.timer-complete', { kind: it.kind });
        next();
      }, it.ms || 0);
    }

    function start(step) {
      stop();
      live = true;
      gen++;
      const g = gen;
      diag('player.start', { ref: refOf(step.i, step.n), voice: $('voice').value || 'default', sound: soundOn() });
      warmOther();
      enqueue(step);
      setState('playing');
      playNext(g);

      // Keep audio alive when page visibility changes
      if (!visibilityHandlerAttached) {
        visibilityHandlerAttached = true;
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            // Page going to background - ensure we don't pause
            // The audio element should keep playing on its own
          } else {
            // Page coming to foreground - refresh metadata/position
            if (live && queue.length) {
              const playing = els.find(a => !a.paused);
              if (playing) {
                try {
                  navigator.mediaSession.setPositionState({
                    duration: playing.duration || 0,
                    playbackRate: playing.playbackRate,
                    position: playing.currentTime || 0
                  });
                } catch (e) {}
              }
            }
          }
        });
      }
    }

    function stop() {
      live = false;
      gen++;
      if (timer) { clearTimeout(timer); timer = 0; }
      clearPendingWatchdog();
      queue.length = 0;
      painted = null;
      if (ttsOK) speechSynthesis.cancel();
      for (const a of els) {
        if (!a) continue;
        a.onended = null;
        a.onerror = null;
        try { a.pause(); } catch (e) {}
        a._u = '';
      }
      diag('player.stopped');
      setState('paused');
    }

    function setState(s) {
      if ('mediaSession' in navigator) {
        try { navigator.mediaSession.playbackState = s; } catch (e) {}
      }
    }

    function unlock() {
      for (const i of [0, 1]) {
        const a = el(i);
        diag('audio.unlock-request', { element: a._diagId, ...sourceInfo(a) });
        try {
          const result = a.play();
          if (result && typeof result.then === 'function') {
            result.then(() => diag('audio.unlock-resolved', { element: a._diagId }))
              .catch(err => diag('audio.unlock-rejected', { element: a._diagId, ...errorInfo(err), ...sourceInfo(a) }));
          } else {
            diag('audio.unlock-no-promise', { element: a._diagId });
          }
        } catch (err) {
          diag('audio.unlock-threw', { element: a._diagId, ...errorInfo(err), ...sourceInfo(a) });
        }
      }
    }

    return { start, stop, unlock };
  })();

  /* ---------- State & UI Rendering ---------- */
  let cur = { i: 0, n: 1, via: 'seed' }, running = false, token = 0;
  const trail = [];
  let PL = null;
  let A = null, S = { step: 0, last: new Map() };
  const pickFrom = arr => arr[Math.floor(rand() * arr.length)];
  const K = () => poolSize(+$('focus').value);

  function setAnchor(a) {
    A = a;
    S = { step: 0, last: new Map() };
    PL = null;
    $('shuffleWrap').hidden = true;
  }

  function ensureAnchor() {
    if (!A) setAnchor(anchorFromRef(cur.i, cur.n, false));
  }

  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GLYPH = { seed: '●', ref: '↳', next: '→', return: '⟲', word: '◆' };

  function viaText(s) {
    if (s.via === 'ref') return 'Cross-reference from ' + refOf(s.from) + ' · strength ' + s.votes;
    if (s.via === 'next') return 'Reading on from ' + refOf(s.from);
    if (s.via === 'word' && PL) return 'Occurrence ' + (s.k + 1) + ' of ' + s.total + ' · ' + SW.d[PL.id][0] + ' ' + PL.id;
    if (s.via === 'return') return 'No close link left, so returning to a verse near your topic';
    return 'Starting verse';
  }

  function renderTrail() {
    const ol = $('trail');
    if (!trail.length) {
      ol.innerHTML = '<li class="trail-empty">Nothing yet.</li>';
      return;
    }
    ol.innerHTML = trail.map((s, k) =>
      '<li><button type="button" data-k="' + k + '"><span class="g" aria-hidden="true">' + GLYPH[s.via] + '</span><span class="r">' + esc(refOf(s.i, s.n)) +
      '</span><span class="t">' + esc(TEXT[s.i]) + '</span></button></li>').join('');
  }

  function renderNext() {
    const ul = $('nextList');
    $('nextHead').textContent = PL ? 'Next occurrences' : 'Where it can go from here';
    if (PL) {
      ul.innerHTML = PL.list.slice(PL.pos + 1, PL.pos + 7).map(v =>
        '<li><button type="button" data-t="' + v + '">' + esc(refOf(v)) + '</button></li>').join('') ||
        '<li class="note">That was the last one. It starts again from the top.</li>';
      return;
    }
    const e = ADJ[cur.i], k0 = K();
    let h = '', shown = 0;
    for (let k = 0; k < e.length && shown < 6; k += 3) {
      if (A && A.pos[e[k]] >= k0) continue;
      shown++;
      h += '<li><button type="button" data-t="' + e[k] + '" data-n="' + e[k + 1] + '" data-v="' + e[k + 2] + '">' +
        esc(refOf(e[k], e[k + 1])) + '<span>' + e[k + 2] + '</span></button></li>';
    }
    ul.innerHTML = h || '<li class="note">No on-topic link from this verse. It will read on, or return to a verse near your topic.</li>';
  }

  function show(step) {
    cur = step;
    if (!step.shown) {
      step.shown = true;
      trail.unshift(step);
      if (trail.length > 80) trail.pop();
      S.step++;
      for (let k = 0; k < step.n; k++) S.last.set(step.i + k, S.step);
      renderTrail();
    }
    const st = $('stage');
    st.classList.remove('fade');
    void st.offsetWidth;
    st.classList.add('fade');
    $('refLabel').textContent = refOf(step.i, step.n);
    $('via').textContent = viaText(step);

    let h = '';
    for (let k = 0; k < step.n; k++) {
      h += (step.n > 1 ? '<sup>' + (i2v(step.i + k)) + '</sup>' : '') + esc(TEXT[step.i + k]) + ' ';
    }
    $('verseText').innerHTML = h;
    renderNext();
  }

  function i2v(i) {
    const k = chapOf(i);
    return i - chapStart[k] + 1;
  }

  function setRunning(on) {
    running = on;
    $('play').textContent = on ? 'Pause' : 'Play';
  }

  function go(step) {
    token++;
    cur = step;
    setRunning(true);
    player.start(step);
  }

  function pause() {
    token++;
    setRunning(false);
    player.stop();
  }

  function advance() {
    if (PL) {
      PL.pos++;
      if (PL.pos >= PL.list.length) {
        PL.pos = 0;
        applyShuffle();
      }
      return wordStep(PL.pos);
    }
    ensureAnchor();
    return chooseNext(cur, A, S, +$('jump').value / 100, K());
  }

  const wordStep = p => ({ i: PL.list[p], n: 1, via: 'word', k: p, total: PL.list.length });

  function applyShuffle() {
    if (!$('shuffle').checked) {
      PL.list = PL.base;
      return;
    }
    const a = [...PL.base];
    for (let k = a.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [a[k], a[j]] = [a[j], a[k]];
    }
    PL.list = a;
  }

  function renderPicker(q, active) {
    const c = wordSearch(q), box = $('words');
    box.hidden = !c.length;
    if (!c.length) return;
    box.dataset.q = q;
    $('wlist').innerHTML = '<button class="wchip" type="button" data-id="" aria-pressed="' + !active + '"><span class="wl">All meanings</span><span class="wg">Verses about “' + esc(q) + '” in any sense, following cross-references.</span></button>' +
      c.map(x => {
        const d = SW.d[x.id];
        return '<button class="wchip" type="button" data-id="' + x.id + '" aria-pressed="' + (x.id === active) + '">' +
          '<span class="wl" dir="auto">' + esc(d[0]) + '</span>' +
          '<span class="wx">' + esc(d[1]) + ' · ' + x.id + ' · ' + x.total + ' verses</span>' +
          '<span class="wg">' + esc(d[2]) + '</span>' +
          '<span class="wg">KJV: ' + esc(d[3]) + '</span></button>';
      }).join('');
  }

  function startWord(id) {
    const base = occOf(id), d = SW.d[id];
    PL = { id, base, list: base, pos: 0 };
    $('shuffleWrap').hidden = false;
    applyShuffle();
    $('seedNote').textContent = 'Playing all ' + base.length + ' verses with ' + d[0] + ' (' + d[1] + ', ' + id + ') ' + ($('shuffle').checked ? 'in shuffled order.' : 'in Bible order.');
    renderPicker($('words').dataset.q, id);
    go(wordStep(0));
  }

  /* ---------- Starting Points ---------- */
  function start(q) {
    q = q.trim();
    if (!q) return;
    const note = $('seedNote');
    $('words').hidden = true;
    const r = parseRef(q);
    if (r && r.error) {
      note.textContent = r.error;
      return;
    }
    if (r) {
      note.textContent = 'Working out which verses stay close to ' + r.label + '…';
      setAnchor(anchorFromRef(r.i, r.n, r.chapterOnly));
      note.textContent = 'Starting at ' + r.label + ' and staying close to ' + (r.chapterOnly ? 'its theme.' : 'it.');
      go({ i: r.i, n: r.n, via: 'seed' });
      return;
    }
    const res = searchTopic(q);
    if (!res.ids.length) {
      const sug = suggestTerms(q);
      if (sug.length) {
        note.innerHTML = 'No verses matched "' + esc(q) + '". The King James wording may differ.' +
          '<div class="wlist" style="margin-top:6px">' +
          sug.map(w => '<button class="wchip" type="button" data-sug="' + esc(w) + '">' + esc(w) + '</button>').join('') +
          '</div>';
        return;
      }
      note.textContent = 'No verses matched "' + q + '". The King James wording may differ, so try another word or a reference such as John 3:16.';
      return;
    }
    setAnchor(anchorFromTopic(res));
    const s = pickFrom(res.ids.slice(0, 8));
    renderPicker(q);
    const step = { i: s, n: 1, via: 'seed' };
    show(step);
    cur = step;
    note.textContent = 'Press ▶ Play or choose a root word below.';
  }

  function copyCurrentVerse() {
    const ref = refOf(cur.i, cur.n);
    let text = '';
    for (let k = 0; k < cur.n; k++) {
      text += (cur.n > 1 ? '[' + i2v(cur.i + k) + '] ' : '') + TEXT[cur.i + k] + ' ';
    }
    const clipText = ref + ' — ' + text.trim();
    navigator.clipboard.writeText(clipText).then(() => {
      const btn = $('copyVerseBtn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    }).catch(() => {});
  }

  /* ---------- Theme Management ---------- */
  const themes = ['auto', 'light', 'dark'];
  function applyTheme(th) {
    if (th === 'dark' || th === 'light') {
      document.documentElement.setAttribute('data-theme', th);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const icon = $('themeIcon');
    if (icon) {
      icon.textContent = th === 'dark' ? '🌙' : (th === 'light' ? '☀️' : '🌓');
    }
  }

  function cycleTheme() {
    const curTh = load('theme') || 'auto';
    const nextIdx = (themes.indexOf(curTh) + 1) % themes.length;
    const nextTh = themes[nextIdx];
    store('theme', nextTh);
    applyTheme(nextTh);
  }

  /* ---------- Event Wiring ---------- */
  $('seedForm').addEventListener('submit', e => {
    e.preventDefault();
    start($('q').value);
  });

  $('chips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    $('q').value = b.textContent;
    start(b.textContent);
  });

  $('play').addEventListener('click', () => {
    if (running) pause();
    else { player.unlock(); go(cur); }
  });

  $('copyPlaybackDiagnostics').addEventListener('click', async () => {
    const report = [
      'Endless Treasury playback diagnostics',
      JSON.stringify(diagEnvironment(), null, 2),
      ...diagEvents.map(x => `${x.time} ${x.name}${x.detail ? ' ' + x.detail : ''}`)
    ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
      $('playbackDiagStatus').textContent = 'Diagnostic report copied. Paste it into your message.';
    } catch (err) {
      $('playbackDiagStatus').textContent = 'Copy was blocked by the browser. Open this panel and select/copy the log manually.';
      diag('diagnostics.copy-failed', errorInfo(err));
    }
  });

  $('skip').addEventListener('click', () => {
    const nx = advance();
    if (running) { player.unlock(); go(nx); }
    else show(nx);
  });

  $('nextList').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (PL) {
      PL.pos = PL.list.indexOf(+b.dataset.t);
      player.unlock();
      go(wordStep(PL.pos));
      return;
    }
    player.unlock();
    go({ i: +b.dataset.t, n: spanOf(+b.dataset.t, +b.dataset.n), via: 'ref', from: cur.i, votes: +b.dataset.v });
  });

  $('wlist').addEventListener('click', e => {
    const b = e.target.closest('.wchip');
    if (b) {
      if (b.dataset.id) startWord(b.dataset.id);
      else { player.unlock(); start($('words').dataset.q); }
    }
  });

  $('seedNote').addEventListener('click', e => {
    const b = e.target.closest('.wchip[data-sug]');
    if (b) { player.unlock(); start(b.dataset.sug.split(' · ')[0]); }
  });

  $('shuffle').addEventListener('change', () => {
    if (!PL) return;
    const here = PL.list[PL.pos];
    applyShuffle();
    PL.pos = Math.max(0, PL.list.indexOf(here));
    renderNext();
  });

  $('trail').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = trail[+b.dataset.k];
    setAnchor(anchorFromRef(s.i, s.n, false));
    $('seedNote').textContent = 'Now staying close to ' + refOf(s.i, s.n) + '.';
    go({ i: s.i, n: s.n, via: 'seed' });
  });

  $('voice').addEventListener('change', () => {
    store('voice', $('voice').value);
  });

  const copyBtn = $('copyVerseBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyCurrentVerse);

  const themeBtn = $('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', cycleTheme);

  // Initialize theme from storage
  applyTheme(load('theme') || 'auto');

  // Sliders and Dials
  const dials = [
    ['jump', v => v < 20 ? 'mostly reads on' : v > 80 ? 'hops nearly every verse' : v + '%'],
    ['focus', v => '≈ ' + poolSize(v) + ' verses'],
    ['rate', v => (v / 100).toFixed(2) + '×'],
    ['gap', v => (v / 1000).toFixed(1) + ' s']
  ];

  for (const [id, fmt] of dials) {
    const el = $(id), out = $(id + 'Out'), saved = load(id);
    if (saved !== null && saved !== '') el.value = saved;
    const upd = () => {
      out.textContent = fmt(+el.value);
      store(id, el.value);
    };
    el.addEventListener('input', upd);
    upd();
  }

  // Keyboard Shortcuts
  document.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      $('play').click();
    }
    if (e.code === 'ArrowRight' && e.target.type !== 'range') {
      $('skip').click();
    }
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'BUTTON') {
      copyCurrentVerse();
    }
  });

  // MediaSession Handlers
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => { if (!running) go(cur); });
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('nexttrack', () => $('skip').click());
    } catch (e) {}
  }

  if (!ttsOK) {
    $('seedNote').textContent = 'This browser has no built-in voice, so verses will advance silently at reading pace.';
  }

  $('focus').addEventListener('input', renderNext);

  // Initialize View
  show(cur);
  setTimeout(() => {
    ensureAnchor();
    renderNext();
  }, 80);

})();
