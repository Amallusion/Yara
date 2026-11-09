/*
 * Yara chat: a Cloudflare Worker that answers like the Dify app did, without Dify.
 *
 *   1. Finds the most relevant sections of Yara's five knowledge files (they are built into this file).
 *   2. For price questions, reads data/prices.csv live from the website (same rules as the old CODE node).
 *   3. Asks a Workers AI model, with Yara's prompt, and streams the answer back.
 *
 * Settings (Worker → Settings → Variables), all optional:
 *   MODEL            the Workers AI model. Default below.
 *   ALLOWED_ORIGINS  comma-separated sites allowed to call this Worker. Default below.
 *   PRICES_URL       where the price list lives. Default below.
 * Binding (Worker → Settings → Bindings): Workers AI, variable name AI. Required.
 *
 * Chats are not stored anywhere.
 * Built by tools/build_worker.py on __BUILT__ from the files in knowledge/.
 */

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_ORIGINS = 'https://amallusion.github.io,http://localhost:8080,http://127.0.0.1:8080';
const DEFAULT_PRICES_URL = 'https://amallusion.github.io/yara/data/prices.csv';
const MAX_MESSAGE = 1000;   // characters in one user message
const HISTORY_TURNS = 3;    // earlier user+assistant pairs sent to the model (like Memory window 3)
const TOP_K = 6;            // knowledge sections per answer (like Top K 6)
const CONTEXT_CHARS = 10000;
const SECTION_CHARS = 2600;

const KNOWLEDGE = __KNOWLEDGE__;

const SYSTEM_PROMPT = `You are Yara, a Saudi-first plant-based companion. You help people eat more plant-based or fully vegan meals in Saudi Arabia, respecting their budget, protein goals, family situation, culture, time and what local supermarkets sell. You are friendly, warm, motivating and lightly humorous, never judgmental: like a helpful friend who knows the local supermarket aisle, not a strict nutrition lecturer.

Information you can use:
{{CONTEXT}}

Grocery prices (live list):
{{PRICES}}

How to answer:
1. Answer the user's question first. Keep it short and practical.
2. Use the user's language: English gets English, Arabic gets Arabic, mixed gets a natural mix. Understand Arabizi (abgha, wsh, bkam, ma3ndi, ma fi) and reply in clear Arabic or mixed Arabic/English. Never mock spelling.
3. Recipes: use only recipes from the information above and copy their names exactly. Never invent a recipe. For general requests, list up to 5 names. For a meal type, list only matching recipes. When you share a USDA MyPlate recipe, mention its source.
4. When you describe a recipe, mention only ingredients written in the information above. Never add meat, dairy, yogurt, eggs or honey.
5. Prices: give a price only from the grocery prices list, copying the product, store, pack size, SAR price and checked date. Never estimate or give price ranges. If the list says NO_PRICE_MATCH, say Yara has no price for that yet. Questions like "بكم", "كم سعر", "how much is" or "price of" are about prices: answer them from the grocery prices list.
6. If the answer isn't in the information, say "I couldn't find that in Yara's files." (Arabic: «لم أجد ذلك في ملفات يارا.») Then suggest something that is there.
7. Never shame anyone for eating non-vegan food, having a small budget, or changing goals. One plant-based meal still counts.
8. Don't diagnose, prescribe supplements or give medical fasting advice. For pregnancy, diabetes, kidney disease, eating disorders, serious allergies or prescribed diets, give a short safe answer and suggest a doctor or dietitian.
9. Ask at most one follow-up question, and only when needed. Light humor is welcome, sparingly, never when the user is upset.

Remember: answer in the user's language.`;

/* ---------- text helpers (same normalisation as the old price code) ---------- */
const PREFIXES = ['وال', 'بال', 'لل', 'ال', 'و', 'ب'];
// Arabizi and common spellings people type, mapped to words in Yara's files
const ALIASES = { '3ads': 'عدس', '3adas': 'عدس', adas: 'عدس', '7omos': 'حمص', '7ommos': 'حمص', '7ummus': 'حمص', homos: 'حمص', hummu: 'حمص', foul: 'فول', fool: 'فول', ful: 'فول', ruz: 'ارز', roz: 'ارز', '3aish': 'خبز', khobz: 'خبز', tahina: 'طحينه', ta7ina: 'طحينه', shofan: 'شوفان', burghul: 'برغل', bulgur: 'برغل', mash: 'ماش', lobia: 'لوبيا', fasolia: 'فاصوليا', kabsa: 'كبسه', mujaddara: 'مجدره', mjadara: 'مجدره', suhoor: 'سحور', sohoor: 'سحور', iftar: 'افطار', ftoor: 'فطور' };
function norm(text) {
  return String(text || '').toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}
function words(text) {
  const out = new Set();
  for (let w of norm(text).match(/[a-z0-9]+|[\u0600-\u06FF]+/g) || []) {
    if (/^[a-z0-9]/.test(w)) {
      if (ALIASES[w]) out.add(ALIASES[w]);
      if (w.length > 3 && w.endsWith('es') && !w.endsWith('ses')) w = w.slice(0, -2);
      else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
      out.add(w);
      if (ALIASES[w]) out.add(ALIASES[w]);
      continue;
    }
    out.add(w);
    for (const p of PREFIXES) { if (w.startsWith(p) && w.length - p.length >= 2) { out.add(w.slice(p.length)); break; } }
  }
  return out;
}
const isArabic = (s) => /[\u0600-\u06FF]/.test(s || '');

/* ---------- knowledge search (BM25 over the ### sections) ---------- */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'it', 'its', 'me', 'my', 'i', 'you', 'what', 'how', 'can', 'do', 'does', 'some', 'any', 'give', 'please', 'want', 'need', 'about', 'this', 'that', 'be', 'at', 'from', 'by', 'as', 'yara',
  'في', 'من', 'على', 'عن', 'الى', 'الي', 'ما', 'هل', 'ابي', 'ابغي', 'ابغا', 'وش', 'كيف', 'هذا', 'هذي', 'هذه', 'او', 'مع', 'لي', 'انا', 'انت', 'يارا', 'شي', 'عندي', 'ممكن', 'لو', 'كل']);
const tokens = (text) => [...words(text)].filter((w) => w.length > 1 && !STOP.has(w));
let INDEX = null;
function buildIndex() {
  const docs = KNOWLEDGE.map((s) => {
    const tf = new Map();
    const add = (w, n) => tf.set(w, (tf.get(w) || 0) + n);
    tokens(s.title).forEach((w) => add(w, 3));
    for (const w of norm(s.text).match(/[a-z0-9]+|[\u0600-\u06FF]+/g) || []) for (const v of words(w)) if (v.length > 1 && !STOP.has(v)) add(v, 1);
    let len = 0; tf.forEach((n) => { len += n; });
    return { s, tf, len };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
  const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
  INDEX = { docs, df, avg, n: docs.length };
}
function bm25(queryTerms) {
  const { docs, df, avg, n } = INDEX; const k1 = 1.2, b = 0.75;
  return docs.map((d) => {
    let score = 0;
    for (const w of queryTerms) {
      const f = d.tf.get(w); if (!f) continue;
      const idf = Math.log(1 + (n - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
    }
    return score;
  });
}
function retrieve(latest, previous) {
  if (!INDEX) buildIndex();
  const a = bm25(tokens(latest));
  const p = previous ? bm25(tokens(previous)) : null;
  const general = /recipe|وصف|اكل|طبخ/.test(norm(latest));
  const ranked = INDEX.docs.map((d, i) => ({ d, score: (a[i] + (p ? 0.35 * p[i] : 0)) * (general && /^all yara|\(list\)/i.test(d.s.title) ? 1.6 : 1) }))
    .filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, TOP_K);
  let used = 0; const parts = [];
  for (const { d } of ranked) {
    const body = d.s.text.length > SECTION_CHARS ? d.s.text.slice(0, SECTION_CHARS) + '…' : d.s.text;
    const block = '### ' + d.s.title + '\n' + body;
    if (used + block.length > CONTEXT_CHARS && parts.length) break;
    parts.push(block); used += block.length;
  }
  return { context: parts.join('\n\n') || '(nothing relevant found)', titles: ranked.map((x) => x.d.s.title) };
}

/* ---------- prices (a faithful port of dify/price_lookup.py) ---------- */
const UNIT_SIZE = { g: 1, kg: 1000, ml: 1, l: 1000 };
const SKIP = new Set(['dry', 'canned', 'whole', 'fresh', 'the', 'and', 'with', 'of', 'for', 'in', 'at', 'pc']);
const STORES = { Lulu: ['lulu', 'لولو'], Carrefour: ['carrefour', 'كارفور', 'كارفورد'], Panda: ['panda', 'بنده', 'باندا', 'بندا'] };
const CHEAP = new Set(['cheap', 'cheapest', 'budget', 'value', 'protein', 'رخيص', 'ارخص', 'بروتين', 'ميزانيه']);
const PRICE_EN = ['price', 'cost', 'riyal', 'cheap', 'budget', 'expensive', 'bkam'];
const PRICE_AR = ['بكم', 'سعر', 'اسعار', 'بكام', 'ريال', 'رخيص', 'ارخص', 'غالي', 'فلوس', 'تكلف', 'يكلف'];
const ARABIZI = ['b kam', 'si3r', 's3r', 'as3ar'];

function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.filter((r) => r.length >= head.length - 1 && r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}
function baseAmount(row) { const size = parseFloat(row.size || 0); return isNaN(size) ? 0 : size * (UNIT_SIZE[String(row.unit || '').trim().toLowerCase()] || 0); }
function perSar(row) { const protein = parseFloat(row.protein_per_100 || 0), price = parseFloat(row.price_sar); return !price || price <= 0 || isNaN(protein) ? 0 : baseAmount(row) * protein / 100 / price; }
function describe(row) {
  const price = parseFloat(row.price_sar); const unit = String(row.unit || '').trim();
  let text = `${row.name_en} (${row.name_ar}) at ${row.store === 'Lulu' ? 'LuLu' : row.store}: ${row.size} ${unit} for SAR ${price.toFixed(2)}`;
  const amount = baseAmount(row);
  if (amount) text += ` (SAR ${(price / amount * 1000).toFixed(2)} per ${['ml', 'l'].includes(unit.toLowerCase()) ? 'L' : 'kg'})`;
  text += `, checked ${row.checked}`;
  const age = (Date.now() - Date.parse(row.checked + 'T00:00:00Z')) / 86400000;
  if (age > 60) text += ' (older than 60 days)';
  return text;
}
function match(text, rows) {
  const q = words(text); const qn = norm(text);
  const storesHit = Object.keys(STORES).filter((name) => STORES[name].some((k) => qn.includes(k)));
  const scores = new Map();
  for (const r of rows) {
    const keys = new Set([...words(r.name_en), ...words(r.name_ar), ...words(String(r.id || '').replace(/-/g, ' '))]);
    let score = 0; for (const k of keys) if (!SKIP.has(k) && q.has(k)) score++;
    if (score) scores.set(r.id, Math.max(scores.get(r.id) || 0, score));
  }
  return { q, storesHit, scores };
}
function wantsPrice(text) {
  const t = norm(text);
  if ((t.match(/[a-z]+/g) || []).includes('sar')) return true;
  if ([...PRICE_EN, ...PRICE_AR, ...ARABIZI].some((k) => t.includes(k))) return true;
  if (t.includes('how much')) return !['protein', 'gram', 'calorie', 'water'].some((x) => t.includes(x));
  return Object.values(STORES).some((keys) => keys.some((k) => t.includes(k)));
}
function priceLookup(latest, earlier, rows) {
  if (!wantsPrice(latest)) return '';
  let { q, storesHit, scores } = match(latest, rows);
  // Follow-ups such as "their prices" or "and at Panda?" borrow the food from the earlier messages.
  if (!scores.size && earlier) {
    const before = match(earlier, rows);
    if (before.scores.size) { scores = before.scores; q = new Set([...q, ...before.q]); }
    if (!storesHit.length) storesHit = before.storesHit;
  }
  let picked = [];
  if (scores.size) {
    const best = Math.max(...scores.values());
    picked = rows.filter((r) => scores.get(r.id) === best);
    if (storesHit.length) { const here = picked.filter((r) => storesHit.includes(r.store)); if (here.length) picked = here; }
  } else if (storesHit.length) {
    picked = rows.filter((r) => storesHit.includes(r.store)).sort((a, b) => perSar(b) - perSar(a));
  } else if ([...q].some((w) => CHEAP.has(w))) {
    picked = [...rows].sort((a, b) => perSar(b) - perSar(a));
  }
  const lines = [];
  for (const r of picked.slice(0, 10)) { try { if (!isNaN(parseFloat(r.price_sar))) lines.push(describe(r)); } catch (e) { /* skip a broken row */ } }
  if (!lines.length) return 'NO_PRICE_MATCH: Yara has no price for this yet.';
  return 'The user is asking about prices. Answer with these exact prices, keeping every number, pack size, store and date:\n' + lines.join('\n');
}
async function loadPrices(env, ctx) {
  const url = env.PRICES_URL || DEFAULT_PRICES_URL;
  const cache = caches.default; const key = new Request(url);
  let res = await cache.match(key);
  if (!res) {
    res = await fetch(url, { cf: { cacheTtl: 600 } });
    if (!res.ok) throw new Error('prices ' + res.status);
    const copy = new Response(await res.clone().text(), { headers: { 'Cache-Control': 'max-age=600', 'Content-Type': 'text/csv; charset=utf-8' } });
    ctx.waitUntil(cache.put(key, copy));
  }
  return parseCSV(await res.text());
}

/* ---------- a small per-visitor speed limit (best effort, per Cloudflare location) ---------- */
const HITS = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 25;
  const list = (HITS.get(ip) || []).filter((t) => now - t < win);
  list.push(now); HITS.set(ip, list);
  if (HITS.size > 5000) HITS.clear();
  return list.length > max;
}

/* ---------- HTTP ---------- */
function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return { ok, headers: ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : { Vary: 'Origin' } };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const friendly = (ar, key) => ({
  busy: ar ? 'يارا مشغولة شوي، جرّب بعد دقائق 🌱' : 'Yara is a little busy. Try again in a few minutes 🌱',
  resting: ar ? 'يارا ارتاحت لليوم، ارجع لها بكرة 🌙' : 'Yara is resting for today. Come back tomorrow 🌙',
  oops: ar ? 'صار خطأ بسيط، جرّب مرة ثانية.' : 'Something went wrong. Please try again.'
})[key];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const c = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, name: 'Yara chat', model: env.MODEL || DEFAULT_MODEL, sections: KNOWLEDGE.length }, 200, c.headers);
    if (request.method !== 'POST' || url.pathname !== '/chat') return json({ error: 'not found' }, 404, c.headers);
    if (!c.ok) return json({ error: 'This site is not allowed to use Yara.' }, 403, c.headers);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400, c.headers); }
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE * 3) }));
    const last = history[history.length - 1];
    if (!last || last.role !== 'user' || !last.content.trim()) return json({ error: 'bad request' }, 400, c.headers);
    if (last.content.length > MAX_MESSAGE) return json({ error: 'message too long' }, 413, c.headers);
    const ar = isArabic(last.content);
    if (limited(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: friendly(ar, 'busy') }, 429, c.headers);
    if (!env.AI) return json({ error: 'The Workers AI binding called AI is missing.' }, 500, c.headers);

    const earlierUser = history.slice(0, -1).filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join('\n');
    const { context } = retrieve(last.content, earlierUser.split('\n').pop());
    let prices = '';
    try { if (wantsPrice(last.content)) prices = priceLookup(last.content, earlierUser, await loadPrices(env, ctx)); }
    catch (e) { prices = 'NO_PRICE_MATCH: the price list could not be loaded right now.'; }

    const system = SYSTEM_PROMPT.replace('{{CONTEXT}}', context).replace('{{PRICES}}', prices || '(not a price question)')
      + (ar ? '\nThe user wrote in Arabic: reply in Arabic.' : '');
    const earlier = history.slice(0, -1).slice(-HISTORY_TURNS * 2);
    const messages = [{ role: 'system', content: system }, ...earlier, { role: 'user', content: prices ? last.content + '\n\n' + prices : last.content }];
    const stream = body.stream !== false;

    try {
      const out = await env.AI.run(env.MODEL || DEFAULT_MODEL, { messages, max_tokens: 900, temperature: 0.2, stream });
      if (stream) return new Response(out, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...c.headers } });
      return json({ reply: (out && (out.response ?? out.result?.response)) || '' }, 200, c.headers);
    } catch (e) {
      const msg = String(e && e.message || e);
      const daily = /neuron|quota|daily|limit|4006|capacity/i.test(msg);
      return json({ error: friendly(ar, daily ? 'resting' : 'oops') }, daily ? 429 : 502, c.headers);
    }
  }
};

export { retrieve, priceLookup, parseCSV, wantsPrice };
