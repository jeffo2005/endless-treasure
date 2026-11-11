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
    const ids = new Map(), names = [], post = [], vstems = new Array(TEXT.length);
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
        }
        if (seen.indexOf(id) < 0) {
          seen.push(id);
          post[id].push(i);
        }
      }
      vstems[i] = seen;
    }
    const N = TEXT.length, idf = new Float64Array(names.length);
    for (let id = 0; id < names.length; id++) {
      idf[id] = Math.log(N / post[id].length);
    }
    IDX = { ids, names, post, vstems, idf };
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

  /* ---------- Audio & Text-to-Speech Engine ---------- */
  const $ = id => document.getElementById(id);
  const ttsOK = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  let localVoices = [];
  let currentAudio = null;

  const CLOUD_VOICES = [
    { id: 'cloud:openai:onyx', label: 'Onyx (Deep Dramatic Narrator - AI)', provider: 'openai', voice: 'onyx' },
    { id: 'cloud:openai:fable', label: 'Fable (British Narrative - AI)', provider: 'openai', voice: 'fable' },
    { id: 'cloud:openai:echo', label: 'Echo (Clear Warm Male - AI)', provider: 'openai', voice: 'echo' },
    { id: 'cloud:aws:Matthew', label: 'Matthew (Scripture Baritone - AI)', provider: 'aws-polly', voice: 'Matthew', engine: 'neural' },
    { id: 'cloud:aws:Arthur', label: 'Arthur (British Classic - AI)', provider: 'aws-polly', voice: 'Arthur', engine: 'neural' },
    { id: 'cloud:aws:Stephen', label: 'Stephen (Expressive Reader - AI)', provider: 'aws-polly', voice: 'Stephen', engine: 'neural' },
    { id: 'cloud:aws:Ruth', label: 'Ruth (Clear Dignified Female - AI)', provider: 'aws-polly', voice: 'Ruth', engine: 'neural' },
    { id: 'cloud:openai:alloy', label: 'Alloy (Balanced Neutral - AI)', provider: 'openai', voice: 'alloy' }
  ];

  function store(k, v) {
    try { localStorage.setItem('et_' + k, v); } catch (e) {}
  }
  function load(k) {
    try { return localStorage.getItem('et_' + k); } catch (e) { return null; }
  }

  function loadVoices() {
    const sel = $('voice');
    if (!sel) return;
    const saved = load('voice') || 'cloud:openai:onyx';
    sel.innerHTML = '';

    // Realistic Cloud AI Voices (HTML5 <audio> / Background Playback on Mobile)
    const cloudGroup = document.createElement('optgroup');
    cloudGroup.label = 'Realistic Cloud AI Voices (Background Audio)';
    CLOUD_VOICES.forEach(cv => {
      const opt = document.createElement('option');
      opt.value = cv.id;
      opt.textContent = cv.label;
      cloudGroup.appendChild(opt);
    });
    sel.appendChild(cloudGroup);

    // Device Local Voices (SpeechSynthesis Fallback)
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
    sel.value = match ? match.value : 'cloud:openai:onyx';
  }

  if (ttsOK) {
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
  }
  loadVoices();

  function fallbackTTS(said, finish) {
    if (!ttsOK || !$('sound').checked) {
      const bodyLen = said.split(/\s+/).length;
      setTimeout(finish, (1400 + bodyLen * 330) / rate());
      return;
    }
    const u = new SpeechSynthesisUtterance(said);
    const val = $('voice').value;
    if (val.startsWith('local:')) {
      const idx = +val.slice(6);
      const v = localVoices[idx];
      if (v) { u.voice = v; u.lang = v.lang; }
    }
    u.rate = rate();
    u.onend = finish;
    u.onerror = finish;
    setTimeout(finish, 5000 + said.length * 110 / rate());
    speechSynthesis.speak(u);
  }

  const rate = () => +$('rate').value / 100;
  const engine = {
    play(step) {
      const verses = [];
      for (let k = 0; k < step.n; k++) verses.push(TEXT[step.i + k]);
      const body = verses.join(' ');
      const said = ($('announce').checked ? spokenRef(step.i, step.n) + '. ' : '') + body;

      return new Promise(async resolve => {
        let done = false;
        let wd;
        const finish = () => {
          if (!done) {
            done = true;
            if (wd) clearTimeout(wd);
            resolve();
          }
        };

        if (!$('sound').checked) {
          wd = setTimeout(finish, (1400 + body.split(/\s+/).length * 330) / rate());
          return;
        }

        const voiceVal = $('voice').value;
        const isCloud = voiceVal.startsWith('cloud:') && typeof puter !== 'undefined' && puter.ai && puter.ai.txt2speech;

        if (isCloud) {
          const cfg = CLOUD_VOICES.find(v => v.id === voiceVal) || CLOUD_VOICES[0];
          try {
            const opts = { provider: cfg.provider, voice: cfg.voice };
            if (cfg.engine) opts.engine = cfg.engine;
            const audio = await puter.ai.txt2speech(said, opts);
            currentAudio = audio;
            audio.playbackRate = rate();
            audio.onended = finish;
            audio.onerror = () => {
              console.warn('Cloud audio stream error, falling back to local TTS');
              fallbackTTS(said, finish);
            };
            wd = setTimeout(finish, 45000 + said.length * 100);
            await audio.play();
            return;
          } catch (err) {
            console.warn('Cloud audio generation failed, falling back:', err);
            fallbackTTS(said, finish);
            return;
          }
        }

        // Default or local fallback
        fallbackTTS(said, finish);
      });
    },
    stop() {
      if (currentAudio) {
        try {
          currentAudio.pause();
          currentAudio.currentTime = 0;
        } catch (e) {}
        currentAudio = null;
      }
      if (ttsOK) speechSynthesis.cancel();
    }
  };

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

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: refOf(step.i, step.n),
          artist: 'Endless Treasury',
          album: 'King James Bible'
        });
      } catch (e) {}
    }
  }

  function i2v(i) {
    const k = chapOf(i);
    return i - chapStart[k] + 1;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function loop(my) {
    while (running && token === my) {
      show(cur);
      await engine.play(cur);
      if (!running || token !== my) return;
      await sleep(+$('gap').value);
      if (!running || token !== my) return;
      cur = advance();
    }
  }

  function setRunning(on) {
    running = on;
    $('play').textContent = on ? 'Pause' : 'Play';
  }

  function go(step) {
    token++;
    engine.stop();
    cur = step;
    setRunning(true);
    loop(token);
  }

  function pause() {
    token++;
    setRunning(false);
    engine.stop();
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
      note.textContent = 'No verses matched “' + q + '”. The King James wording may differ, so try another word or a reference such as John 3:16.';
      return;
    }
    setAnchor(anchorFromTopic(res));
    const s = pickFrom(res.ids.slice(0, 8));
    note.textContent = 'Staying close to “' + q + '”. Starting at ' + refOf(s) + '.';
    go({ i: s, n: 1, via: 'seed' });
    renderPicker(q);
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
    else go(cur);
  });

  $('skip').addEventListener('click', () => {
    const nx = advance();
    if (running) go(nx);
    else show(nx);
  });

  $('nextList').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (PL) {
      PL.pos = PL.list.indexOf(+b.dataset.t);
      go(wordStep(PL.pos));
      return;
    }
    go({ i: +b.dataset.t, n: spanOf(+b.dataset.t, +b.dataset.n), via: 'ref', from: cur.i, votes: +b.dataset.v });
  });

  $('wlist').addEventListener('click', e => {
    const b = e.target.closest('.wchip');
    if (b) {
      if (b.dataset.id) startWord(b.dataset.id);
      else start($('words').dataset.q);
    }
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
