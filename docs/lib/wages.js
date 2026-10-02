// Wage ranges, read from what the posting actually says. Precision over recall:
// a missing range is honest, a range scraped out of "we raised $100M" is a lie
// with a number attached.

const SYMBOLS = { $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CAD', 'AUD', 'INR', 'JPY', 'BRL', 'MXN', 'SGD', 'NZD', 'CZK', 'HUF'];

const tidy = (s) =>
  String(s || '')
    .replace(/&nbsp;/g, ' ')
    // &amp; first: feeds double-escape, as in "&amp;mdash;". Decoding it later
    // leaves a literal entity the dash pass can no longer see.
    .replace(/&amp;/g, '&')
    .replace(/&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/gi, '-')
    .replace(/&pound;/g, '£')
    .replace(/&euro;/g, '€')
    .replace(/\s+/g, ' ')
    .trim();

// 68.000 -> 68000 (European thousands) | 1,200 -> 1200 | 45.5 -> 45.5
function toNumber(raw, mult) {
  let n = String(raw).trim();
  if (/^\d{1,3}[.,]\d{3}$/.test(n)) n = n.replace(/[.,]/g, '');
  else if (/^\d+[.,]\d{1,2}$/.test(n)) n = n.replace(',', '.');
  else n = n.replace(/,/g, '');
  let v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (mult === 'k' || mult === 'K') v *= 1_000;
  else if (mult === 'm' || mult === 'M') v *= 1_000_000;
  return v;
}

const AMOUNT_RE =
  /(?<sym>[$£€¥₹])\s?(?<num>\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?<mult>[kKmM])?/g;
const CODE_AMOUNT_RE = new RegExp(`\\b(?<cur>${CURRENCIES.join('|')})\\s?(?<num>\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\s*(?<mult>[kKmM])?`, 'gi');
// "120k-150k" with no currency at all. The currency is left null rather than
// assumed, because a bare range in a London listing is pounds, not dollars.
const BARE_K_RE = /\b(?<num>\d{2,3}(?:[.,]\d)?)\s?(?<mult>[kK])\b(?!\w)/g;
// The low half of "45-60k", where only the top figure carries the k.
const BARE_LOW_RE = /\b(?<num>\d{2,3})(?=\s?[-–—]\s?\d{2,3}\s?[kK]\b)/g;
// A bare pair with no multiplier at all: "Rate 60-80 per hour". Year, version,
// phone and date fragments land here too and are removed by the bounds check.
const BARE_PAIR_RE = /\b(?<lo>\d{2,3})\s?[-–—]\s?(?<hi>\d{2,3})\b(?!\d)/g;

function collect(text) {
  const out = [];
  for (const [re, kind] of [[AMOUNT_RE, 'sym'], [CODE_AMOUNT_RE, 'code']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const v = toNumber(m.groups.num, m.groups.mult);
      if (v === null || v <= 0) continue;
      out.push({
        value: v,
        currency: kind === 'sym' ? SYMBOLS[m.groups.sym] || 'USD' : m.groups.cur.toUpperCase(),
        index: m.index,
        raw: m[0].trim(),
      });
    }
  }
  if (out.length) return out.sort((a, b) => a.index - b.index);

  BARE_K_RE.lastIndex = 0;
  let m;
  while ((m = BARE_K_RE.exec(text))) {
    const v = toNumber(m.groups.num, m.groups.mult);
    if (v === null || v < 8_000) continue;
    out.push({ value: v, currency: null, index: m.index, raw: m[0].trim() });
  }
  BARE_LOW_RE.lastIndex = 0;
  while ((m = BARE_LOW_RE.exec(text))) {
    const v = toNumber(m.groups.num, 'k');
    if (v === null || v < 8_000) continue;
    out.push({ value: v, currency: null, index: m.index, raw: `${m[0]}k` });
  }
  BARE_PAIR_RE.lastIndex = 0;
  while ((m = BARE_PAIR_RE.exec(text))) {
    const lo = toNumber(m.groups.lo, null);
    const hi = toNumber(m.groups.hi, null);
    if (lo === null || hi === null || hi <= lo) continue;
    out.push({ value: lo, currency: null, index: m.index, raw: m.groups.lo });
    out.push({ value: hi, currency: null, index: m.index + m[0].length - m.groups.hi.length, raw: m.groups.hi });
  }
  return out.sort((a, b) => a.index - b.index);
}

const PERIOD_RE = /\b(hourly|per hour|\/ ?h(?:r|our)?\b|per ?hr|an hour|hour)\b/i;
const ANNUAL_RE = /\b(annually|per annum|p\.?a\.?\b|per year|yearly|\/ ?yr\b|\/ ?year\b|a year|bruttojahr|jahr)\b/i;
const DAILY_RE = /\b(per day|\/ ?day\b|daily|day rate|tagessatz|pro tag)\b/i;
const MONTHLY_RE = /\b(per month|monthly|\/ ?mo(?:nth)?\b|monatlich|pro monat)\b/i;

// A figure outside these bands is not a salary: it is revenue, quota, budget,
// contract value, or a feed with a broken field. Dropping it is the honest move.
const BOUNDS = {
  year: [8_000, 1_500_000],
  hour: [3, 800],
  day: [40, 20_000],
  month: [200, 60_000],
};

const SUFFIX = { year: '/yr', hour: '/hr', day: '/day', month: '/mo' };
const TO_ANNUAL = { year: 1, month: 12, day: 260, hour: 1_800 };

function detectPeriod(window) {
  if (DAILY_RE.test(window)) return 'day';
  if (MONTHLY_RE.test(window)) return 'month';
  if (PERIOD_RE.test(window) && !ANNUAL_RE.test(window)) return 'hour';
  if (ANNUAL_RE.test(window)) return 'year';
  return null; // caller decides from magnitude
}

// Values that are unambiguously not annual salary — the period text was absent
// or misleading, so infer it rather than print a 20-million-a-year wage.
function inferPeriod(values) {
  const max = Math.max(...values);
  if (max <= 800) return 'hour';
  if (max <= 20_000) return 'month';
  return 'year';
}

// Context is read from a tight window around the figure. Whole-sentence
// matching produced "$200/hr" out of "over $200B in annualized spend", because
// "40-hour/week" happened to be in the same clause.
const BACK = 70;
const FORWARD = 40;

// Words that mean the number is not pay.
const NOT_PAY = /(revenue|\barr\b|funding|valuation|series [a-e]\b|raised|budget|portfolio|market cap|profit|invest|contract value|\btam\b|quota|\bote\b|deal size|arrangements?|\bpipeline\b|spend|volume|gmv)/i;
// Words that make the number pay.
const PAY_CONTEXT = /(salary|compensation|pay|base|range|remuneration|gehalt|lohn|brutto|hourly|annually|per annum|p\.?a\.?\b|\/ ?(?:yr|year|hr|hour)\b|per (?:year|hour|day|month)|rate\b)/i;

function finalize(min, max, currency, period, raw) {
  // "Rate 60-80 per hour" reads as 60k-80k until the period contradicts it.
  if (period === 'hour' && min >= 1000) {
    min /= 1000;
    max /= 1000;
  }
  const [lo, hi] = BOUNDS[period] || BOUNDS.year;
  if (min < lo || max > hi) return null;
  if (max / min > 6) return null; // we paired two unrelated numbers
  return { min, max, currency, period, raw };
}

export function parseWage(text) {
  const body = tidy(text);
  if (!body) return null;

  const all = collect(body).filter((a) => {
    const after = body.slice(a.index + a.raw.length, a.index + a.raw.length + 2);
    return !/^b\b|^bn\b/i.test(after); // "$200B" is market size, not pay
  });
  if (!all.length) return null;

  const candidates = [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const window = body.slice(Math.max(0, a.index - BACK), a.index + FORWARD);
    if (!PAY_CONTEXT.test(window)) continue;
    if (NOT_PAY.test(window)) continue;

    // Chain with the next figure when it continues the same range in the same
    // currency and sits close enough to be part of the same clause.
    let max = a.value;
    let raw = a.raw;
    let period = detectPeriod(window);
    const nxt = all[i + 1];
    if (nxt && nxt.currency === a.currency && nxt.index - a.index < 60) {
      const nWindow = body.slice(Math.max(0, nxt.index - BACK), nxt.index + FORWARD);
      if (PAY_CONTEXT.test(nWindow) && !NOT_PAY.test(nWindow)) {
        max = Math.max(max, nxt.value);
        raw += ` – ${nxt.raw}`;
        period = period || detectPeriod(nWindow);
      }
    }
    if (!period) period = inferPeriod([a.value, max]);
    candidates.push(finalize(Math.min(a.value, max), max, a.currency, period, raw));
  }

  const valid = candidates.filter(Boolean);
  if (!valid.length) return null;
  // Prefer a two-sided range: "$150k" alone is weaker evidence than "$150k–$190k".
  return valid.sort((x, y) => (y.max - y.min > 0) - (x.max - x.min > 0) || (x.max - x.min) - (y.max - y.min))[0];
}

// -------------------------------------------------------------- fx + format

const RATE_TTL = 6 * 60 * 60 * 1000;
let rateCache = { at: 0, rates: null, date: null };

export async function usdRates() {
  if (Date.now() - rateCache.at < RATE_TTL && rateCache.rates) return rateCache;
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'jobwall/1.0' },
    });
    if (res.ok) {
      const body = await res.json();
      rateCache = { at: Date.now(), rates: { USD: 1, ...body.rates }, date: body.date };
      return rateCache;
    }
  } catch {
    /* fall through to the secondary source */
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const body = await res.json();
      if (body.result === 'success') {
        rateCache = { at: Date.now(), rates: body.rates, date: body.time_last_update_utc };
        return rateCache;
      }
    }
  } catch {
    /* no fx today; ranges are still shown in their own currency */
  }
  return { at: 0, rates: null, date: null };
}

const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹' };

export function compact(value, currency = 'USD') {
  const sym = currency ? SYM[currency] || `${currency} ` : '';
  if (!Number.isFinite(value)) return '';
  if (value >= 1_000_000) return `${sym}${(value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0)}M`;
  if (value >= 10_000) return `${sym}${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${sym}${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return `${sym}${Math.round(value).toLocaleString()}`;
  return `${sym}${value.toFixed(value % 1 ? 2 : 0)}`;
}

export function formatWage(wage, rates = null) {
  if (!wage) return null;
  const suffix = SUFFIX[wage.period] || '/yr';
  const same = wage.min === wage.max;
  const label = `${compact(wage.min, wage.currency)}${same ? '' : `–${compact(wage.max, wage.currency)}`}${suffix}`;
  const out = { label, currency: wage.currency, period: wage.period };
  if (rates?.rates?.[wage.currency] && wage.currency !== 'USD') {
    const r = rates.rates[wage.currency];
    out.usd = { min: wage.min / r, max: wage.max / r, period: wage.period };
    out.usdLabel = `${compact(out.usd.min)}${same ? '' : `–${compact(out.usd.max)}`}${suffix}`;
  }
  return out;
}

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

// Aggregate across a set of openings. Hourly, daily and monthly figures are
// normalised to annual-equivalent before comparison, and the headline band is the
// interquartile range — raw min/max is dominated by one outlier posting.
export function wageStats(jobs, rates = null) {
  const stated = jobs.filter((j) => j.wage);
  if (!stated.length) return { openings: jobs.length, stating: 0, annual: null, hourly: null };

  const toAnnual = (w) => w.min * TO_ANNUAL[w.period];
  const annual = stated.map((j) => j.wage).filter((w) => w.period === 'year');
  const hourly = stated.map((j) => j.wage).filter((w) => w.period === 'hour');

  const summarise = (list, isHourly) => {
    if (!list.length) return null;
    const usd = [];
    for (const w of list) {
      const r = rates?.rates?.[w.currency];
      if (!r) continue;
      const v = isHourly ? w.min / r : toAnnual(w) / r;
      const v2 = isHourly ? w.max / r : toAnnual(w) / r;
      usd.push(Math.min(v, v2), Math.max(v, v2));
    }
    usd.sort((a, b) => a - b);
    const round = isHourly ? Math.round : (n) => n;
    const native = list.map((w) => w.min).concat(list.map((w) => w.max));
    return {
      count: list.length,
      period: isHourly ? 'hour' : 'year',
      currency: list[0].currency,
      singleCurrency: new Set(list.map((w) => w.currency)).size === 1,
      currencies: [...new Set(list.map((w) => w.currency))],
      usdMin: usd.length ? round(quantile(usd, 0.25)) : null,
      usdMax: usd.length ? round(quantile(usd, 0.75)) : null,
      usdMedian: usd.length ? round(quantile(usd, 0.5)) : null,
      observedMin: Math.min(...native),
      observedMax: Math.max(...native),
    };
  };

  return { openings: jobs.length, stating: stated.length, annual: summarise(annual, false), hourly: summarise(hourly, true) };
}

export function describeWageStats(stats) {
  if (!stats || !stats.stating) return null;
  const parts = [];
  const band = (min, max, suffix) =>
    `${compact(min)}${max > min ? `–${compact(max)}` : ''}${suffix}`;
  const a = stats.annual;
  if (a && a.usdMin !== null) parts.push(band(a.usdMin, a.usdMax, '/yr'));
  const h = stats.hourly;
  if (h && h.usdMin !== null) {
    // Hourly postings are rare; annualise so the two bands are comparable.
    parts.push(`${band(h.usdMin, h.usdMax, '/hr')} (~${compact(h.usdMedian * 1_800)}/yr)`);
  }
  return parts.join(' · ') || null;
}
