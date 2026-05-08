/**
 * calendar-sync.mjs
 *
 * Fetches the public Google Calendar iCal feed and syncs new gigs to the site.
 * Only imports events whose DESCRIPTION contains "#site".
 * Deduplicates against existing gig files by calendar UID, then by date+venue fuzzy match.
 * Runs in GitHub Actions via the "Calendar sync" workflow.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const ICAL_URL   = 'https://calendar.google.com/calendar/ical/3ebsmths%40gmail.com/public/basic.ics';
const SITE_TAG   = '#site';
const apiKey     = process.env.ANTHROPIC_API_KEY?.trim() || '';

if (!apiKey) { console.error('ERROR: ANTHROPIC_API_KEY secret is not set.'); process.exit(1); }

// ── Fetch iCal ────────────────────────────────────────────────────────────────
console.log('Fetching calendar…');
const icalRes = await fetch(ICAL_URL);
if (!icalRes.ok) { console.error(`Failed to fetch iCal: ${icalRes.status}`); process.exit(1); }
const ical = await icalRes.text();

// ── Parse iCal ────────────────────────────────────────────────────────────────
function parseIcal(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    const get = (key) => {
      // Handle folded lines (RFC 5545: continuation lines start with whitespace)
      const unfolded = block.replace(/\r?\n[ \t]/g, '');
      const match = unfolded.match(new RegExp(`^${key}[;:][^\r\n]*`, 'm'));
      if (!match) return null;
      return match[0].replace(new RegExp(`^${key}[^:]*:`), '').trim();
    };
    events.push({
      uid:         get('UID'),
      summary:     get('SUMMARY'),
      dtstart:     get('DTSTART'),
      dtend:       get('DTEND'),
      location:    get('LOCATION'),
      description: get('DESCRIPTION'),
      status:      get('STATUS'),
    });
  }
  return events;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function parseIcalDate(dtstart) {
  if (!dtstart) return null;
  // All-day: VALUE=DATE:YYYYMMDD or just YYYYMMDD
  const allDay = dtstart.match(/(?:VALUE=DATE:)?(\d{4})(\d{2})(\d{2})$/);
  if (allDay) return { date: `${allDay[1]}-${allDay[2]}-${allDay[3]}`, time: null, allDay: true };
  // Timed: YYYYMMDDTHHmmss[Z] — trailing Z = UTC, no Z = local (treat as Sydney)
  const timed = dtstart.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
  if (!timed) return null;
  const isUtc = timed[7] === 'Z';
  const iso = `${timed[1]}-${timed[2]}-${timed[3]}T${timed[4]}:${timed[5]}:${timed[6]}${isUtc ? 'Z' : ''}`;
  const base = new Date(iso);
  // Convert to Sydney time
  const sydney = new Date(base.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }));
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${sydney.getFullYear()}-${pad(sydney.getMonth() + 1)}-${pad(sydney.getDate())}`;
  const h = sydney.getHours();
  const m = sydney.getMinutes();
  const time = m === 0 ? `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}` : `${h % 12 || 12}:${pad(m)}${h < 12 ? 'am' : 'pm'}`;
  return { date, time, allDay: false };
}

// ── Rolling window ────────────────────────────────────────────────────────────
const now   = new Date();
const past  = new Date(now); past.setDate(past.getDate() - 7);
const future = new Date(now); future.setMonth(future.getMonth() + 12);
const pastStr   = past.toISOString().split('T')[0];
const futureStr = future.toISOString().split('T')[0];

// ── Load existing gig files ───────────────────────────────────────────────────
const gigsDir = join(process.cwd(), 'src', 'content', 'gigs');
mkdirSync(gigsDir, { recursive: true });
const gigFiles = readdirSync(gigsDir).filter(f => f.endsWith('.md'));

function parseGigFile(filename) {
  const content = readFileSync(join(gigsDir, filename), 'utf8');
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const raw = fm[1];
  const get = (key) => { const m = raw.match(new RegExp(`^${key}:\\s*(.+)`, 'm')); return m ? m[1].replace(/^["']|["']$/g, '').trim() : null; };
  return {
    filename,
    content,
    calendar_uid: get('calendar_uid'),
    date: get('date'),
    venue: get('venue'),
    facebook_event_url: get('facebook_event_url'),
    ticket_url: get('ticket_url'),
    notes: get('notes'),
  };
}

const existingGigs = gigFiles.map(parseGigFile);
const existingUids = new Set(existingGigs.map(g => g.calendar_uid).filter(Boolean));

function normaliseVenue(v) {
  return (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Process events ────────────────────────────────────────────────────────────
const events = parseIcal(ical);
console.log(`Parsed ${events.length} calendar events`);

const toCreate = [];
const toUpdate = [];

for (const ev of events) {
  // Must have #site tag
  const desc = (ev.description || '').replace(/\\n/g, '\n');
  if (!desc.includes(SITE_TAG)) continue;

  const parsed = parseIcalDate(ev.dtstart);
  if (!parsed) continue;
  const { date, time, allDay } = parsed;

  // Rolling window
  if (date < pastStr || date > futureStr) continue;

  // Dedup pass 1: UID match
  if (ev.uid && existingUids.has(ev.uid)) {
    console.log(`  Skipping (UID match): ${ev.summary} on ${date}`);
    continue;
  }

  // Dedup pass 2: fuzzy match on date + venue
  const normLoc = normaliseVenue(ev.location);
  const fuzzyMatch = existingGigs.find(g =>
    g.date === date && normaliseVenue(g.venue) === normLoc && normLoc.length > 2
  );

  if (fuzzyMatch) {
    console.log(`  Fuzzy match: ${ev.summary} on ${date} → ${fuzzyMatch.filename}`);
    toUpdate.push({ ev, date, time, allDay, match: fuzzyMatch });
    continue;
  }

  toCreate.push({ ev, date, time, allDay });
}

console.log(`  ${toCreate.length} to create, ${toUpdate.length} to update`);

// ── Update fuzzy-matched gigs (add calendar_uid, preserve site fields) ────────
for (const { ev, date, time, match } of toUpdate) {
  let content = match.content;
  // Add calendar_uid if missing
  if (!match.calendar_uid) {
    content = content.replace(/^(---\n[\s\S]*?)(---)/m, `$1calendar_uid: "${ev.uid}"\n$2`);
  }
  // Update time only if calendar has one and file doesn't
  if (time && !match.content.match(/^time:/m)) {
    content = content.replace(/^(---\n[\s\S]*?)(---)/m, `$1time: "${time}"\n$2`);
  }
  writeFileSync(join(gigsDir, match.filename), content, 'utf8');
  console.log(`  Updated: ${match.filename}`);
}

// ── Call Claude for new events ────────────────────────────────────────────────
const created = [];

for (const { ev, date, time, allDay } of toCreate) {
  const prompt = `You are processing a Google Calendar event to create a gig listing for a musician's website.

Calendar event:
- Title (SUMMARY): ${ev.summary}
- Date: ${date}
- Time: ${allDay ? 'all-day event (no specific time)' : (time || 'unknown')}
- Location: ${ev.location || 'not specified'}
- Description: ${(ev.description || '').replace(/\\n/g, ' ')}

Return ONLY a JSON object with these fields:
- "is_gig": boolean — true if this looks like a music performance/gig
- "title": event title (string)
- "time": show time like "7:30pm" or null — use null for all-day events or if the time is clearly travel/arrival time rather than show time
- "venue": venue name only, not full address (string)
- "city": city and state like "Lismore, NSW" or null
- "bands": array of performer/band names inferred from the title or location
- "notes": any address or extra detail worth keeping, or null

Return only the JSON object, no markdown, no explanation.`;

  let result;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 512, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) { console.error('Claude API error:', JSON.stringify(data)); continue; }
    const text = data.content?.[0]?.text?.trim() || '';
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    result = JSON.parse(cleaned);
  } catch (err) {
    console.error(`  Failed to parse Claude response for "${ev.summary}":`, err.message);
    continue;
  }

  if (!result.is_gig) {
    console.log(`  Skipping (not a gig): ${ev.summary}`);
    continue;
  }

  const { title, venue, city, bands, notes } = result;
  const showTime = result.time;

  if (!title || !venue) {
    console.log(`  Skipping (missing title or venue): ${ev.summary}`);
    continue;
  }

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const filename = `${date}-${slug}.md`;

  const yaml = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    ...(showTime      ? [`time: ${JSON.stringify(showTime)}`]         : []),
    `venue: ${JSON.stringify(venue)}`,
    ...(city          ? [`city: ${JSON.stringify(city)}`]             : []),
    'bands:',
    ...(bands?.length ? bands.map(b => `  - ${JSON.stringify(b)}`)   : ['  - "TBC"']),
    ...(notes         ? [`notes: ${JSON.stringify(notes)}`]           : []),
    `calendar_uid: ${JSON.stringify(ev.uid)}`,
    '---',
    '',
  ].join('\n');

  writeFileSync(join(gigsDir, filename), yaml, 'utf8');
  console.log(`  Created: src/content/gigs/${filename}`);
  created.push(title);
}

// ── Summary ───────────────────────────────────────────────────────────────────
const updated = toUpdate.length;
const total   = created.length + updated;

if (total === 0) {
  console.log('\nNo changes — all calendar events already in gig list.');
  writeFileSync('/tmp/sync-summary.txt', 'Calendar sync: no new gigs', 'utf8');
} else {
  const msg = `Calendar sync: ${created.length > 0 ? `add ${created.join(', ')}` : ''}${updated > 0 ? `${created.length > 0 ? '; ' : ''}update ${updated} existing` : ''}`;
  console.log(`\n✓ ${msg}`);
  writeFileSync('/tmp/sync-summary.txt', msg, 'utf8');
}
