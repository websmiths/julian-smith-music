/**
 * add-gig.mjs
 *
 * Creates a gig .md file in src/content/gigs/.
 * Runs in GitHub Actions via the "Add gig" workflow_dispatch.
 *
 * All fields are filled in manually. The Facebook event URL (if any)
 * is stored as a link on the gig page — Facebook's API no longer
 * allows reading event data without a full App Review process.
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

if (!bandsRaw) {
  console.error('ERROR: "bands" input is required.');
  process.exit(1);
}

// ── Date parsing — accept several formats ─────────────────────────────────────
// Accepted:  2026-05-15  |  15 May 2026  |  15/05/2026  |  May 15 2026
function parseDate(raw) {
  if (!raw) return '';

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Try native Date parse for formats like "15 May 2026", "May 15 2026"
  const d = new Date(raw);
  if (!isNaN(d)) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // DD/MM/YYYY
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  }

  return raw; // return as-is; validation below will catch it
}

date = parseDate(date);

// ── Validate ─────────────────────────────────────────────────────────────────
const errors = [];
if (!title) errors.push('title');
if (!date)  errors.push('date  (e.g. 15 May 2026  or  2026-05-15  or  15/05/2026)');
if (!venue) errors.push('venue');
if (errors.length) {
  console.error(`\nERROR: Missing required fields:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`ERROR: Could not parse date "${process.env.DATE?.trim()}". Use e.g. 15 May 2026.`);
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

console.log(`✓ Created: src/content/gigs/${filename}`);
console.log(yaml);

writeFileSync('/tmp/gig-title.txt', title, 'utf8');
