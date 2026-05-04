/**
 * add-gig.mjs
 *
 * Creates a gig .md file in src/content/gigs/.
 * Runs in GitHub Actions. If FB_URL is provided, fetches the public
 * Facebook event page and extracts structured JSON-LD data.
 * Falls back to manual environment variable inputs.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const fbUrl    = process.env.FB_URL?.trim()     || '';
let   title    = process.env.TITLE?.trim()      || '';
let   date     = process.env.DATE?.trim()       || '';
let   time     = process.env.TIME?.trim()       || '';
let   venue    = process.env.VENUE?.trim()      || '';
let   city     = process.env.CITY?.trim()       || '';
const bandsRaw = process.env.BANDS?.trim()      || '';
const ticketUrl = process.env.TICKET_URL?.trim() || '';
const notes    = process.env.NOTES?.trim()      || '';

if (!bandsRaw) {
  console.error('ERROR: "bands" input is required.');
  process.exit(1);
}

// ── Facebook scrape ──────────────────────────────────────────────────────────
if (fbUrl) {
  console.log(`Fetching Facebook event: ${fbUrl}`);
  try {
    const res = await fetch(fbUrl, {
      headers: {
        // Use Facebook's own external-hit UA so FB serves structured data
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Extract all JSON-LD blocks and find the one with @type: Event
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let event = null;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const found = items.find(d => d['@type'] === 'Event');
        if (found) { event = found; break; }
      } catch { /* malformed JSON-LD block, skip */ }
    }

    if (event) {
      console.log('Extracted event:', JSON.stringify(event, null, 2));

      // Title
      if (!title && event.name) title = event.name;

      // Date + time from startDate (ISO 8601, may include timezone offset)
      if (event.startDate) {
        if (!date) {
          date = event.startDate.split('T')[0]; // "2026-05-15"
        }
        if (!time) {
          const tp = event.startDate.match(/T(\d{2}):(\d{2})/);
          if (tp) {
            const h = parseInt(tp[1], 10);
            const min = tp[2];
            // Skip if midnight (often means no specific time was set)
            if (!(h === 0 && min === '00')) {
              const ampm = h >= 12 ? 'pm' : 'am';
              const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
              time = min === '00' ? `${h12}${ampm}` : `${h12}:${min}${ampm}`;
            }
          }
        }
      }

      // Venue + city
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
      console.warn('No JSON-LD Event block found on this page. Using manual inputs.');
    }
  } catch (err) {
    console.warn(`Could not fetch/parse Facebook event: ${err.message}. Using manual inputs.`);
  }
}

// ── Validate ─────────────────────────────────────────────────────────────────
const errors = [];
if (!title) errors.push('title (not found in Facebook event or manual input)');
if (!date)  errors.push('date  (not found in Facebook event or manual input)');
if (!venue) errors.push('venue (not found in Facebook event or manual input)');
if (errors.length) {
  console.error('ERROR: Missing required fields:\n  ' + errors.join('\n  '));
  process.exit(1);
}

// Validate date format
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
  ...(time       ? [`time: ${JSON.stringify(time)}`]       : []),
  `venue: ${JSON.stringify(venue)}`,
  ...(city       ? [`city: ${JSON.stringify(city)}`]       : []),
  'bands:',
  ...bands.map(b => `  - ${JSON.stringify(b)}`),
  ...(ticketUrl  ? [`ticket_url: ${JSON.stringify(ticketUrl)}`]          : []),
  ...(fbUrl      ? [`facebook_event_url: ${JSON.stringify(fbUrl)}`]      : []),
  ...(notes      ? [`notes: ${JSON.stringify(notes)}`]                   : []),
  '---',
  '',
].join('\n');

const outDir  = join(process.cwd(), 'src', 'content', 'gigs');
const outPath = join(outDir, filename);
mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, yaml, 'utf8');

console.log(`\n✓ Created: src/content/gigs/${filename}`);
console.log(yaml);

// Write title for use in the git commit message
writeFileSync('/tmp/gig-title.txt', title, 'utf8');
