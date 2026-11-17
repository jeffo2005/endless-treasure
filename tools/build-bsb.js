#!/usr/bin/env node
/**
 * Build js/bsb-data.js from the public-domain Berean Standard Bible plain text.
 *
 * The BSB text is formatted as tab-separated "Reference<TAB>Verse text" lines:
 *   Genesis 1:1	In the beginning God created the heavens and the earth.
 *
 * Every reference is mapped onto the existing KJV verse index in js/data.js so
 * that the journey engine (TSK graph, Strong's, scope filters) keeps working
 * unchanged. The BSB uses "Psalm" where our index uses "Psalms"; that is the
 * only book alias needed. The handful of verses the BSB omits are stored as
 * empty strings so the array stays exactly 31,102 entries long.
 *
 * Usage:
 *   node tools/build-bsb.js
 *   node tools/build-bsb.js --source bsb.txt
 *   node tools/build-bsb.js --source https://bereanbible.com/bsb.txt --out js/bsb-data.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE = 'https://bereanbible.com/bsb.txt';
const DEFAULT_OUT = path.join(ROOT, 'js', 'bsb-data.js');

function arg(name, fallback) {
  const hit = process.argv.slice(2).find(a => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const i = process.argv.indexOf(hit);
  return process.argv[i + 1] || fallback;
}

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects while fetching ' + url));
    https.get(url, { headers: { 'user-agent': 'endless-treasure-build/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, depth + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' while fetching ' + url));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) return get(source);
  return fs.promises.readFile(path.resolve(source), 'utf8');
}

function buildReferenceMap() {
  require(path.join(ROOT, 'js', 'data.js'));
  const G = globalThis.G;
  if (!G || !Array.isArray(G.books) || !Array.isArray(G.chap) || !Array.isArray(G.text)) {
    throw new Error('js/data.js did not expose G.books, G.chap and G.text');
  }
  const map = new Map();
  let index = 0;
  for (const [book, chapter, verseCount] of G.chap) {
    for (let verse = 1; verse <= verseCount; verse++) {
      map.set(G.books[book] + ' ' + chapter + ':' + verse, index++);
    }
  }
  if (index !== G.text.length) throw new Error('KJV index mismatch: ' + index + ' refs vs ' + G.text.length + ' verses');
  return { G, map };
}

function parseBible(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const refs = new Map();
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const reference = line.slice(0, tab).trim();
    const verse = line.slice(tab + 1).trim();
    const m = /^((?:[1-3] )?[A-Za-z][A-Za-z ]*?) (\d+):(\d+)$/.exec(reference);
    if (!m) continue;
    const key = m[1].replace(/^Psalm$/, 'Psalms') + ' ' + m[2] + ':' + m[3];
    refs.set(key, verse);
  }
  return refs;
}

function jsStringArray(items) {
  return '[' + items.map(s => JSON.stringify(s)).join(',') + ']';
}

(async () => {
  const source = arg('source', DEFAULT_SOURCE);
  const out = path.resolve(arg('out', DEFAULT_OUT));

  const raw = await readSource(source);
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  const { G, map } = buildReferenceMap();
  const refs = parseBible(raw);

  const text = new Array(map.size).fill('');
  const unknown = [];
  const seen = new Set();
  let duplicates = 0;

  for (const [key, verse] of refs) {
    const i = map.get(key);
    if (i === undefined) { unknown.push(key); continue; }
    if (seen.has(key)) duplicates++;
    seen.add(key);
    text[i] = verse;
  }

  const missing = [];
  for (const key of map.keys()) if (!seen.has(key)) missing.push(key);
  const empty = [...refs].filter(([, v]) => !v).map(([k]) => k);

  console.log('Source: ' + source);
  console.log('SHA-256: ' + digest);
  console.log('References parsed: ' + refs.size + ' / ' + map.size);
  if (unknown.length) console.log('Unknown references (' + unknown.length + '): ' + unknown.slice(0, 20).join(', '));
  if (missing.length) console.log('Missing references (' + missing.length + '): ' + missing.slice(0, 20).join(', '));
  if (duplicates) console.log('Duplicate references: ' + duplicates);
  console.log('Omitted verses (' + empty.length + '): ' + empty.join(', '));

  if (unknown.length || missing.length || duplicates) {
    throw new Error('BSB data does not align with the KJV verse index; refusing to write output.');
  }

  const retrieved = new Date().toISOString();
  const header = [
    '/**',
    ' * Berean Standard Bible (BSB) - public domain.',
    ' *',
    ' * Generated by tools/build-bsb.js. Do not edit by hand.',
    ' * Source: ' + source,
    ' * Retrieved: ' + retrieved,
    ' * Source SHA-256: ' + digest,
    ' * License: Public Domain (https://berean.bible/terms.htm)',
    ' *',
    ' * Array order matches G.text in js/data.js exactly: index 0 is Genesis 1:1,',
    ' * index 31101 is Revelation 22:21. Verses the BSB omits are empty strings.',
    ' */',
    '(function (root) {',
    '  root.BSB = {',
    "    id: 'bsb',",
    "    name: 'Berean Standard Bible',",
    "    short: 'BSB',",
    "    license: 'Public Domain',",
    "    source: " + JSON.stringify(source) + ',',
    '    retrieved: ' + JSON.stringify(retrieved) + ',',
    '    sha256: ' + JSON.stringify(digest) + ',',
    '    text: ' + jsStringArray(text),
    '  };',
    '})(typeof window !== "undefined" ? window : globalThis);',
    ''
  ].join('\n');

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, header, 'utf8');

  const bytes = Buffer.byteLength(header);
  console.log('Wrote ' + path.relative(ROOT, out) + ' (' + bytes.toLocaleString() + ' bytes, ' + G.text.length + ' slots)');
})().catch(err => {
  console.error('BSB build failed: ' + err.message);
  process.exit(1);
});
