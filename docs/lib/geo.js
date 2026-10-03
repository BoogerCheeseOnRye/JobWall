// Where is this job, actually?
//
// Feeds are wildly inconsistent. One says "USA", another "Sarasota, FL",
// another just "Remote", and a fourth says "London". Before this, the page
// printed whatever string arrived, so a Seattle reader had no way to tell a
// Berlin posting from a Bellevue one — and 85 jobs literally labelled "USA"
// were indistinguishable from jobs with no location at all.
//
// The rule here is conservative: only claim a country when the text clearly
// says so. A city we have never heard of is left `known: false` rather than
// guessed, because quietly filing an unknown posting as "somewhere foreign"
// would hide a US job from someone who needs it. Absence of evidence is not
// evidence of absence.

// US postal abbreviations. Dotted pairs first so "IN"/"OR"/"OK" cannot match
// inside a longer word; the word-boundary test covers the rest.
export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_NAMES = Object.entries(US_STATES)
  .map(([abbr, name]) => [name, abbr])
  .filter(([name]) => name !== 'District of Columbia');

// Names so Seattle-flavoured they are not worth a region check. Bellevue and
// Auburn exist elsewhere, so those only count once we already know it is WA.
const SEATTLE_STRONG = new Set([
  'seattle', 'bellevue', 'redmond', 'kirkland', 'sammamish', 'issaquah',
  'bothell', 'renton', 'tacoma', 'puyallup', 'edmonds', 'lynnwood', 'sea tac',
  'seatac', 'burien', 'shoreline', 'tukwila', 'kent', 'auburn', 'federal way',
  'everett', 'bellevue wa',
]);
const SEATTLE_WA_ONLY = new Set(['auburn', 'kent', 'tacoma', 'federal way', 'renton', 'puyallup']);

// Only enough geography to recognise the obvious ones. Anything not listed here
// stays unknown rather than being misfiled.
const NON_US = [
  ['uk', 'United Kingdom'], ['united kingdom', 'United Kingdom'], ['england', 'United Kingdom'],
  ['scotland', 'United Kingdom'], ['wales', 'United Kingdom'], ['ireland', 'Ireland'],
  ['london', 'United Kingdom'], ['manchester', 'United Kingdom'], ['cambridge', 'United Kingdom'],
  ['germany', 'Germany'], ['deutschland', 'Germany'], ['berlin', 'Germany'], ['munich', 'Germany'],
  ['hamburg', 'Germany'], ['cologne', 'Germany'], ['frankfurt', 'Germany'],
  ['netherlands', 'Netherlands'], ['amsterdam', 'Netherlands'], ['nederland', 'Netherlands'],
  ['france', 'France'], ['paris', 'France'], ['spain', 'Spain'], ['madrid', 'Spain'],
  ['barcelona', 'Spain'], ['portugal', 'Portugal'], ['lisbon', 'Portugal'], ['italy', 'Italy'],
  ['sweden', 'Sweden'], ['switzerland', 'Switzerland'], ['zurich', 'Switzerland'],
  ['zürich', 'Switzerland'], ['geneva', 'Switzerland'], ['austria', 'Austria'],
  ['poland', 'Poland'], ['czech', 'Czechia'], ['norway', 'Norway'], ['denmark', 'Denmark'],
  ['finland', 'Finland'], ['canada', 'Canada'], ['toronto', 'Canada'], ['montreal', 'Canada'],
  ['australia', 'Australia'], ['sydney', 'Australia'], ['new zealand', 'New Zealand'],
  ['india', 'India'], ['bangalore', 'India'], ['bengaluru', 'India'], ['brazil', 'Brazil'],
  ['mexico', 'Mexico'], ['argentina', 'Argentina'], ['chile', 'Chile'], ['colombia', 'Colombia'],
  ['latam', 'Latin America'], ['europe', 'Europe'], ['emea', 'Europe/EMEA'],
  ['apac', 'Asia-Pacific'], ['asia', 'Asia'],
];

const REMOTE_ONLY = /^(remote|anywhere|worldwide|global|homeoffice|home office|remote work|any location|no location|multiple locations|usa remote|us remote)$/i;
const US_WORDS = /\b(usa|u\.s\.a|united states|us-based|us based|united states of america)\b/i;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * @returns {{label:string, country:string|null, countryName:string|null,
 *            region:string|null, regionName:string|null, city:string|null,
 *            metro:string|null, remoteOnly:boolean, known:boolean}}
 */
export function geoOf(rawLocation, { remote = false } = {}) {
  const label = clean(rawLocation);
  const text = label.replace(/[–—]/g, '-');

  const out = {
    label: label || (remote ? 'Remote' : ''),
    country: null,
    countryName: null,
    region: null,
    regionName: null,
    city: null,
    metro: null,
    remoteOnly: false,
    known: false,
  };

  const low = text.toLowerCase();

  // "Remote" and friends say nothing about geography, so they stay unknown on
  // purpose — a remote role is open to a Seattle resident. The flag is still
  // recorded, because "Remote - Seattle, WA" is remote *and* local, and a
  // Seattle-only view should not lose it.
  const remoteOnly =
    !text || REMOTE_ONLY.test(text) || (/\b(remote|anywhere|worldwide)\b/i.test(text) && !US_WORDS.test(text));
  out.remoteOnly = remoteOnly;
  if (!text) return out;

  // City part, for "Sarasota, FL" and friends.
  const comma = text.split(',')[0].trim();
  if (comma && !/^(usa|us|uk|eu|worldwide|remote)$/i.test(comma)) out.city = comma;

  // Strongest US signal: "City, ST".
  const abbr = text.match(/,\s*([A-Za-z]{2})\s*(?:-\s*\d{5})?\s*$/);
  if (abbr) {
    const code = abbr[1].toUpperCase();
    if (US_STATES[code]) {
      out.country = 'US';
      out.countryName = 'United States';
      out.region = code;
      out.regionName = US_STATES[code];
      out.known = true;
    }
  }
  // "Seattle WA" with no comma: a bare trailing two-letter code, which needs a
  // word boundary so it cannot bite the tail of "Miami" and friends.
  if (!out.known) {
    const glued = text.match(/\b([A-Za-z]{2})\b\s*(?:\d{5})?\s*$/);
    if (glued && US_STATES[glued[1].toUpperCase()] && !US_WORDS.test(text)) {
      out.country = 'US';
      out.countryName = 'United States';
      out.region = glued[1].toUpperCase();
      out.regionName = US_STATES[out.region];
      out.known = true;
    }
  }
  // Full state name: "Washington", "British Columbia" must not match, so we
  // only accept a name standing on its own.
  if (!out.known) {
    const named = STATE_NAMES.find(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(text));
    if (named && !/\b(columbia|ontario|quebec)\b/i.test(text)) {
      out.country = 'US';
      out.countryName = 'United States';
      out.region = named[1];
      out.regionName = US_STATES[named[1]];
      out.known = true;
    }
  }
  // Bare country words.
  if (!out.known && US_WORDS.test(text)) {
    out.country = 'US';
    out.countryName = 'United States';
    out.known = true;
  }

  if (out.country === 'US') {
    const probe = `${out.city || ''} ${label}`.toLowerCase();
    for (const name of SEATTLE_STRONG) {
      if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(probe)) continue;
      if (SEATTLE_WA_ONLY.has(name) && out.region && out.region !== 'WA') continue;
      out.metro = 'seattle';
      break;
    }
    return out;
  }

  if (!out.known) {
    for (const [needle, name] of NON_US) {
      if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(low)) {
        out.countryName = name;
        out.known = true;
        return out;
      }
    }
  }
  return out;
}

/** True when the posting is reachable from Seattle: US-based, remote, or simply unstated. */
export function reachableFromUS(geo) {
  if (!geo) return true;
  if (geo.country === 'US') return true;
  if (geo.remoteOnly) return true;
  return !geo.known; // never block on a guess
}

// Callers filter arrays of jobs, but a geo object is the thing that matters.
// Accepting either keeps a mistake here from silently passing every row
// through. A geo carries `known`; a job carries `location`.
export const jobGeo = (j) => {
  if (!j) return geoOf('');
  if (j.geo) return j.geo;
  if (typeof j === 'object' && 'known' in j) return j;
  return geoOf(j.location, { remote: !!j.remote });
};

export const SCOPES = {
  us: {
    id: 'us',
    label: 'US + remote',
    hint: 'US postings and anything remote. Drops the ones we can see are elsewhere.',
    test: (j) => reachableFromUS(jobGeo(j)),
  },
  seattle: {
    id: 'seattle',
    label: 'Seattle area',
    hint: 'Seattle metro: Seattle, Bellevue, Redmond, Kirkland, Tacoma and the eastside — plus remote roles.',
    test: (j) => {
      const g = jobGeo(j);
      return !!g.metro || !!g.remoteOnly;
    },
  },
  worldwide: { id: 'worldwide', label: 'Worldwide', hint: 'Every opening the feeds carry.', test: () => true },
};

export const DEFAULT_SCOPE = 'us';
