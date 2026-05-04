/**
 * add-gig.mjs
 *
 * Creates a gig .md file in src/content/gigs/.
 *
 * If FB_URL is set and FB_APP_ID + FB_APP_SECRET are configured as
 * GitHub repository secrets, the script calls the Facebook Graph API
 * to auto-fill title, date, time, venue and city.
 *
 * One-time setup (takes ~5 min):
 *   1. Go to https://developers.facebook.com → My Apps → Create App
 *   2. Choose "Other" type, then "Business" — give it any name
 *   3. App Settings > Basic — copy App ID and App Secret
 *   4. In your GitHub repo: Settings > Secrets and variables > Actions
 *      Add secrets: FB_APP_ID  and  FB_APP_SECRET
 *
 * After that, paste any public Facebook event URL and the fields
 * fill in automatically.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const fbUrl     = process.env.FB_URL?.trim()        || '';
let   title     = process.env.TITLE?.trim()         || '';
let   date      = process.env.DATE?.trim()          || '';
let   time      = process.env.TIME?.trim()          || '';
let   venue     = process.env.VENUE?.trim()         || '';
let   city      = process.env.CITY?.trim()          || '';
const bandsRaw  = process.env.BANDS?.trim()         || '';
const ticketUrl = process.env.TICKET_URL?.trim()    || '';
const notes     = process.env.NOTES?.trim()         || '';
const fbAppId   = process.env.FB_APP_ID?.trim()     || '';
const fbAppSecret = process.env.FB_APP_SECRET?.trim() || '';

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

/** Extract a numeric Facebook event ID from any FB event URL */
function extractEventId(url) {
  const m = url.match(/\/events\/(\d+)/);
  return m ? m[1] : null;
}

/** Resolve a short/share FB URL to its final destination */
async function resolveUrl(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'curl/8.0' },
    });
    return res.url;
  } catch {
    return url;
  }
}

// ── Facebook Graph API ────────────────────────────────────────────────────────
if (fbUrl) {
  console.log(`\nFacebook URL: ${fbUrl}`);

  if (!fbAppId || !fbAppSecret) {
    console.warn(`
──────────────────────────────────────────────────────────────────
FB_APP_ID / FB_APP_SECRET not configured — cannot call Graph API.

One-time setup (≈ 5 minutes):
  1. https://developers.facebook.com → My Apps → Create App
  2. Type: "Other" → "Business" (any app name is fine)
  3. App Settings > Basic → copy App ID and App Secret
  4. GitHub repo → Settings → Secrets and variables → Actions
     Add: FB_APP_ID   (the App ID number)
          FB_APP_SECRET  (the App Secret string)

Until then, fill in title / date / venue manually in the workflow.
──────────────────────────────────────────────────────────────────
`);
  } else {
    // Resolve short/share URLs to get the actual events/ID URL
    let resolvedUrl = fbUrl;
    if (!extractEventId(fbUrl)) {
      console.log('Resolving short URL…');
      resolvedUrl = await resolveUrl(fbUrl);
      console.log(`Resolved to: ${resolvedUrl}`);
    }

    const eventId = extractEventId(resolvedUrl);
    if (!eventId) {
      console.warn(`Could not extract a numeric event ID from: ${resolvedUrl}`);
      console.warn('Make sure the URL is a Facebook event (facebook.com/events/XXXXXXXXX)');
    } else {
      console.log(`Event ID: ${eventId}`);
      const apiUrl = `https://graph.facebook.com/v21.0/${eventId}` +
        `?fields=name,start_time,end_time,place,description` +
        `&access_token=${fbAppId}|${fbAppSecret}`;

      try {
        const res  = await fetch(apiUrl);
        const data = await res.json();

        if (data.error) {
          console.error(`Graph API error: ${data.error.message}`);
          console.error('The event may be private, or the App ID/Secret may be wrong.');
        } else {
          console.log('Graph API response:', JSON.stringify(data, null, 2));

          if (!title && data.name)       title = data.name;
          if (data.start_time) {
            const { date: d, time: t } = isoToDateAndTime(data.start_time);
            if (!date && d) date = d;
            if (!time && t) time = t;
          }
          if (data.place) {
            if (!venue && data.place.name) venue = data.place.name;
            if (!city && data.place.location) {
              const loc = data.place.location;
              const parts = [loc.city, loc.state].filter(Boolean);
              if (parts.length) city = parts.join(', ');
            }
          }
        }
      } catch (err) {
        console.warn(`Graph API request failed: ${err.message}`);
      }
    }
  }
}

// ── Validate ─────────────────────────────────────────────────────────────────
const errors = [];
if (!title) errors.push('title');
if (!date)  errors.push('date (YYYY-MM-DD)');
if (!venue) errors.push('venue');
if (errors.length) {
  console.error(`\nERROR: Missing required fields — fill these in manually in the workflow:\n  ${errors.join('\n  ')}`);
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
  ...(time       ? [`time: ${JSON.stringify(time)}`]                : []),
  `venue: ${JSON.stringify(venue)}`,
  ...(city       ? [`city: ${JSON.stringify(city)}`]               : []),
  'bands:',
  ...bands.map(b => `  - ${JSON.stringify(b)}`),
  ...(ticketUrl  ? [`ticket_url: ${JSON.stringify(ticketUrl)}`]    : []),
  ...(fbUrl      ? [`facebook_event_url: ${JSON.stringify(fbUrl)}`]: []),
  ...(notes      ? [`notes: ${JSON.stringify(notes)}`]             : []),
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
