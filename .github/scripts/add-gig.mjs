/**
 * add-gig.mjs
 *
 * Creates a gig .md file in src/content/gigs/.
 * Runs in GitHub Actions. If FB_URL is provided, fetches the public
 * Facebook event page and extracts structured data.
 *
 * Parsing strategies (in order):
 *   1. JSON-LD <script type="application/ld+json"> — richest data
 *   2. Open Graph <meta property="event:*"> — Facebook's own event tags
 *   3. Open Graph og:title + og:description — last resort for title
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const fbUrl     = process.env.FB_URL?.trim()      || '';
let   title     = process.env.TITLE?.trim()       || '';
let   date      = process.env.DATE?.trim()        || '';
let   time      = process.env.TIME?.trim()        || '';
let   venue     = process.env.VENUE?.trim()       || '';
let   city      = process.env.CITY?.trim()        || '';
const bandsRaw  = process.env.BANDS?.trim()       || '';
const ticketUrl = process.env.TICKET_URL?.trim()  || '';
const notes     = process.env.NOTES?.trim()       || '';

if (!bandsRaw) {
  console.error('ERROR: "bands" input is required.');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToDateAndTime(isoStr) {
  if (!isoStr) return {};
  const datePart = isoStr.split('T')[0];
  const tp = isoStr.match(/T(\d{2}):(\d{2})/);
  let timePart = '';
  if (tp) {
    const h = parseInt(tp[1], 10);
    const min = tp[2];
    if (!(h === 0 && min === '00')) {
      const ampm = h >= 12 ? 'pm' : 'am';
      const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
      timePart = min === '00' ? `${h12}${ampm}` : `${h12}:${min}${ampm}`;
    }
  }
  return { date: datePart, time: timePart };
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseOgTags(html) {
  const tags = {};
  // Match both property="..." content="..." and property='...' content='...'
  const re = /<meta\s[^>]*property=["']([^"']+)["'][^>]*content=["']([^"']*?)["'][^>]*\/?>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    tags[m[1]] = decodeHtml(m[2]);
  }
  // Also match content first, then property
  const re2 = /<meta\s[^>]*content=["']([^"']*?)["'][^>]*property=["']([^"']+)["'][^>]*\/?>/gi;
  while ((m = re2.exec(html)) !== null) {
    tags[m[2]] = decodeHtml(m[1]);
  }
  return tags;
}

// ── Facebook scrape ──────────────────────────────────────────────────────────
if (fbUrl) {
  console.log(`\nFetching: ${fbUrl}`);

  // Try Googlebot UA — Facebook serves richer structured data to known crawlers
  let html = '';
  let finalUrl = fbUrl;
  try {
    const res = await fetch(fbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    });
    finalUrl = res.url;
    console.log(`Status: ${res.status}  Final URL: ${finalUrl}`);
    html = await res.text();
    console.log(`Response length: ${html.length} chars`);

    // Quick sanity check — are we getting a real page?
    const looksLikeLogin = html.includes('login') && html.length < 50_000;
    if (looksLikeLogin) {
      console.warn('⚠ Response looks like a login wall — structured data unlikely.');
    }
  } catch (err) {
    console.warn(`Fetch failed: ${err.message}`);
  }

  if (html.length > 0) {
    // ── Strategy 1: JSON-LD ──────────────────────────────────────────────────
    let event = null;
    const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const found = items.find(d => d['@type'] === 'Event');
        if (found) { event = found; break; }
      } catch { /* malformed JSON-LD, skip */ }
    }

    if (event) {
      console.log('✓ Found JSON-LD Event block');
      if (!title && event.name)       title = event.name;
      if (event.startDate) {
        const { date: d, time: t } = isoToDateAndTime(event.startDate);
        if (!date && d) date = d;
        if (!time && t) time = t;
      }
      if (event.location) {
        const loc = event.location;
        if (!venue && loc.name) venue = loc.name;
        if (!city && loc.address) {
          const addr = loc.address;
          const parts = [addr.addressLocality, addr.addressRegion].filter(Boolean);
          if (parts.length) city = parts.join(', ');
        }
      }
    } else {
      console.warn('No JSON-LD Event block found — trying Open Graph tags…');

      // ── Strategy 2: Open Graph event:* tags ─────────────────────────────
      const og = parseOgTags(html);

      // Debug: show all og/event tags we found
      const relevantKeys = Object.keys(og).filter(k =>
        k.startsWith('og:') || k.startsWith('event:') || k.startsWith('place:')
      );
      if (relevantKeys.length) {
        console.log('OG tags found:', Object.fromEntries(relevantKeys.map(k => [k, og[k]])));
      } else {
        console.warn('No OG tags found either — Facebook may be blocking this request.');
        console.log('HTML snippet (first 800 chars):\n', html.slice(0, 800));
      }

      if (!title && og['og:title'])             title = og['og:title'];
      if (!date && og['event:start_time']) {
        const { date: d, time: t } = isoToDateAndTime(og['event:start_time']);
        if (d) date = d;
        if (!time && t) time = t;
      }
      // Facebook sometimes puts venue in og:description or event:location
      if (!venue && og['event:location'])       venue = og['event:location'];
    }
  }

  if (!title && !date && !venue) {
    console.warn(`
──────────────────────────────────────────────────────────────────
Facebook blocked the scrape (likely returning a login wall).
This is common for short share URLs like /share/...

To add this gig manually, re-run the workflow with these fields
filled in directly (leave the Facebook URL field blank or keep it
for the link):
  • title  — event name
  • date   — YYYY-MM-DD
  • venue  — venue name
  • time, city, ticket_url — as needed
──────────────────────────────────────────────────────────────────
`);
  }
}

// ── Validate ─────────────────────────────────────────────────────────────────
const errors = [];
if (!title) errors.push('title');
if (!date)  errors.push('date (YYYY-MM-DD)');
if (!venue) errors.push('venue');
if (errors.length) {
  console.error(`\nERROR: Missing required fields — please fill these in manually:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`ERROR: date must be YYYY-MM-DD, got: "${date}"`);
  process.exit(1);
}

// ── Build .md file ────────────────────────────────────────────────────────────
const bands = bandsRaw.split(',').map(b => b.trim()).filter(Boolean);

const slug = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 60);

const filename = `${date}-${slug}.md`;

const yaml = [
  '---',
  `title: ${JSON.stringify(title)}`,
  `date: ${date}`,
  ...(time       ? [`time: ${JSON.stringify(time)}`]                    : []),
  `venue: ${JSON.stringify(venue)}`,
  ...(city       ? [`city: ${JSON.stringify(city)}`]                    : []),
  'bands:',
  ...bands.map(b => `  - ${JSON.stringify(b)}`),
  ...(ticketUrl  ? [`ticket_url: ${JSON.stringify(ticketUrl)}`]         : []),
  ...(fbUrl      ? [`facebook_event_url: ${JSON.stringify(fbUrl)}`]     : []),
  ...(notes      ? [`notes: ${JSON.stringify(notes)}`]                  : []),
  '---',
  '',
].join('\n');

const outDir  = join(process.cwd(), 'src', 'content', 'gigs');
const outPath = join(outDir, filename);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, yaml, 'utf8');

console.log(`\n✓ Created: src/content/gigs/${filename}`);
console.log(yaml);

writeFileSync('/tmp/gig-title.txt', title, 'utf8');
