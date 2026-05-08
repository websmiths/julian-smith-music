/**
 * gig-assistant.mjs
 *
 * Unified gig manager: add, edit, or delete a gig from a plain-English instruction.
 * Claude determines intent from the instruction and the list of existing gigs.
 * After updating the site files, optionally syncs to Google Calendar if
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN secrets are set.
 * Runs in GitHub Actions via the "Gig Assistant (AI)" workflow.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';

const instruction = process.env.INSTRUCTION?.trim() || '';
const apiKey      = process.env.ANTHROPIC_API_KEY?.trim() || '';

if (!instruction) { console.error('ERROR: instruction is required.'); process.exit(1); }
if (!apiKey)      { console.error('ERROR: ANTHROPIC_API_KEY secret is not set.'); process.exit(1); }

// ── Load existing gig files ───────────────────────────────────────────────────
const gigsDir = join(process.cwd(), 'src', 'content', 'gigs');
mkdirSync(gigsDir, { recursive: true });
const files = readdirSync(gigsDir).filter(f => f.endsWith('.md')).sort();

const gigsContext = files.length > 0
  ? files.map(f => `=== ${f} ===\n${readFileSync(join(gigsDir, f), 'utf8')}`).join('\n\n')
  : '(no gig files yet)';

// ── Call Claude API ───────────────────────────────────────────────────────────
console.log(`Instruction: "${instruction}"`);

const today = new Date().toISOString().split('T')[0];

const prompt = `You manage gig files for a musician's website. Each gig is a markdown file with YAML frontmatter.

Existing gig files:
${gigsContext}

Instruction: "${instruction.replace(/"/g, '\\"')}"
Today's date: ${today}

Determine what the instruction is asking and return ONLY a JSON object:

**Adding a new gig** (instruction describes an event not in the list):
{
  "action": "create",
  "filename": "<YYYY-MM-DD-slug.md>",
  "content": "<complete file content>",
  "summary": "Add gig: <title>"
}

**Editing an existing gig** (instruction references something in the list):
{
  "action": "edit",
  "file": "<exact existing filename>",
  "content": "<complete new file content>",
  "summary": "Update gig: <what changed>"
}

**Deleting an existing gig**:
{
  "action": "delete",
  "file": "<exact existing filename>",
  "summary": "Remove gig: <title>"
}

**Nothing matched or unclear**:
{
  "action": "none",
  "summary": "<explain what you couldn't determine>"
}

For create/edit/delete, also include:
  "skip_calendar": <boolean> — true if the instruction asks NOT to update Google Calendar
  (e.g. "site only", "don't sync calendar", "no calendar update", "skip calendar"). Default false.

Rules for "create":
- filename format: YYYY-MM-DD-slug.md (slug = lowercased title, hyphens, max 60 chars)
- Required frontmatter fields: title, date (YYYY-MM-DD), venue, bands (array)
- Optional: time, city, ticket_url, facebook_event_url, notes, cancelled (boolean)
- File must end with a blank line after the closing ---

Rules for "edit":
- Return the COMPLETE file content, preserving all existing fields unless the instruction says to remove them
- Same valid frontmatter fields as above

Return only the JSON object — no markdown fences, no explanation.`;

let result;
try {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('Claude API error:', JSON.stringify(data));
    process.exit(1);
  }

  const text = data.content?.[0]?.text?.trim() || '';
  console.log('Claude response:', text);

  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  result = JSON.parse(cleaned);
} catch (err) {
  console.error('Failed to parse Claude response:', err.message);
  process.exit(1);
}

// ── Apply the action ──────────────────────────────────────────────────────────
const { action, summary } = result;

if (action === 'none') {
  console.error(`Nothing to do: ${summary}`);
  process.exit(1);
}

// For delete: read the file before removing it so we can grab calendar_uid
let deletedCalendarUid = null;

if (action === 'create') {
  const { filename, content } = result;
  if (!filename || !content) {
    console.error('Claude returned "create" but missing filename or content.');
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(filename)) {
    console.error(`Invalid filename format from Claude: "${filename}"`);
    process.exit(1);
  }
  writeFileSync(join(gigsDir, filename), content, 'utf8');
  console.log(`\n✓ Created: src/content/gigs/${filename}`);
  console.log(content);

} else if (action === 'edit') {
  const { file, content } = result;
  if (!file || !files.includes(file)) {
    console.error(`File not found: "${file}"`);
    process.exit(1);
  }
  if (!content) {
    console.error('Claude returned "edit" but no content.');
    process.exit(1);
  }
  writeFileSync(join(gigsDir, file), content, 'utf8');
  console.log(`\n✓ Updated: src/content/gigs/${file}`);
  console.log(content);

} else if (action === 'delete') {
  const { file } = result;
  if (!file || !files.includes(file)) {
    console.error(`File not found: "${file}"`);
    process.exit(1);
  }
  const existingContent = readFileSync(join(gigsDir, file), 'utf8');
  const uidMatch = existingContent.match(/^calendar_uid:\s*["']?([^"'\n]+)["']?/m);
  if (uidMatch) deletedCalendarUid = uidMatch[1].trim();
  unlinkSync(join(gigsDir, file));
  console.log(`\n✓ Deleted: src/content/gigs/${file}`);

} else {
  console.error(`Unknown action: "${action}"`);
  process.exit(1);
}

writeFileSync('/tmp/gig-summary.txt', summary || `${action} gig`, 'utf8');

// ── Google Calendar sync ──────────────────────────────────────────────────────
if (result.skip_calendar) {
  console.log('\nSkipping calendar sync (instruction said so).');
  process.exit(0);
}

const gclientId     = process.env.GOOGLE_CLIENT_ID?.trim();
const gclientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const grefreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
const CALENDAR_ID   = '3ebsmths@gmail.com';

if (!gclientId || !gclientSecret || !grefreshToken) {
  console.log('\nGoogle Calendar secrets not set — skipping calendar sync.');
  process.exit(0);
}

// Get OAuth access token
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_id: gclientId,
    client_secret: gclientSecret,
    refresh_token: grefreshToken,
    grant_type: 'refresh_token',
  }),
});
const tokenData = await tokenRes.json();
const accessToken = tokenData.access_token;
if (!accessToken) {
  console.error('Failed to get Google access token:', JSON.stringify(tokenData));
  process.exit(0); // non-fatal — site files are already written
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const raw = fm[1];
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:\\s*(.+)`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '').trim() : null;
  };
  return {
    title:        get('title'),
    date:         get('date'),
    time:         get('time'),
    venue:        get('venue'),
    city:         get('city'),
    calendar_uid: get('calendar_uid'),
  };
}

function parseTime12h(timeStr) {
  if (!timeStr) return null;
  const m = timeStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ampm = m[3].toLowerCase();
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return { h, min };
}

function buildCalendarEvent(gig) {
  const { title, date, time, venue, city } = gig;
  const location = [venue, city].filter(Boolean).join(', ');
  const description = '#site';

  const parsed = parseTime12h(time);
  if (parsed) {
    const pad = n => String(n).padStart(2, '0');
    const startH = parsed.h;
    const endH   = Math.min(parsed.h + 3, 23);
    const min    = pad(parsed.min);
    return {
      summary: title,
      location,
      description,
      start: { dateTime: `${date}T${pad(startH)}:${min}:00`, timeZone: 'Australia/Sydney' },
      end:   { dateTime: `${date}T${pad(endH)}:${min}:00`,   timeZone: 'Australia/Sydney' },
    };
  }

  // All-day
  const next = new Date(date + 'T00:00:00');
  next.setDate(next.getDate() + 1);
  return {
    summary: title,
    location,
    description,
    start: { date },
    end:   { date: next.toISOString().split('T')[0] },
  };
}

function calApiEventId(calendarUid) {
  // iCal UIDs from Google are typically "{eventId}@google.com"
  return calendarUid ? calendarUid.replace(/@google\.com$/, '') : null;
}

async function calRequest(method, path, body) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) console.error(`  Calendar API ${method} ${path} error:`, JSON.stringify(data));
  return { ok: res.ok, data };
}

// ── Sync based on action ──────────────────────────────────────────────────────
if (action === 'create') {
  const { filename, content } = result;
  const gig = parseFrontmatter(content);
  if (!gig.title || !gig.date) {
    console.log('  Skipping calendar: missing title or date.');
    process.exit(0);
  }
  const event = buildCalendarEvent(gig);
  const { ok, data } = await calRequest('POST', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, event);
  if (ok && data.id) {
    const calUid = `${data.id}@google.com`;
    console.log(`  Calendar event created: ${data.id}`);
    // Patch the gig file to include calendar_uid
    const gigPath = join(gigsDir, filename);
    let fileContent = readFileSync(gigPath, 'utf8');
    if (!fileContent.match(/^calendar_uid:/m)) {
      fileContent = fileContent.replace(/^(---\n[\s\S]*?)(---)/m, `$1calendar_uid: "${calUid}"\n$2`);
      writeFileSync(gigPath, fileContent, 'utf8');
      console.log(`  Updated ${filename} with calendar_uid: ${calUid}`);
    }
  }

} else if (action === 'edit') {
  const { file, content } = result;
  const gig = parseFrontmatter(content);
  if (!gig.title || !gig.date) {
    console.log('  Skipping calendar: missing title or date.');
    process.exit(0);
  }
  const event = buildCalendarEvent(gig);
  const eventId = calApiEventId(gig.calendar_uid);

  if (eventId) {
    // Update existing event
    const { ok } = await calRequest('PATCH', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`, event);
    if (ok) console.log(`  Calendar event updated: ${eventId}`);
  } else {
    // No UID stored — create a new event and save the UID
    const { ok, data } = await calRequest('POST', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`, event);
    if (ok && data.id) {
      const calUid = `${data.id}@google.com`;
      console.log(`  Calendar event created: ${data.id}`);
      const gigPath = join(gigsDir, file);
      let fileContent = readFileSync(gigPath, 'utf8');
      if (!fileContent.match(/^calendar_uid:/m)) {
        fileContent = fileContent.replace(/^(---\n[\s\S]*?)(---)/m, `$1calendar_uid: "${calUid}"\n$2`);
        writeFileSync(gigPath, fileContent, 'utf8');
        console.log(`  Updated ${file} with calendar_uid: ${calUid}`);
      }
    }
  }

} else if (action === 'delete') {
  const eventId = calApiEventId(deletedCalendarUid);
  if (eventId) {
    const { ok } = await calRequest('DELETE', `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${eventId}`);
    if (ok) console.log(`  Calendar event deleted: ${eventId}`);
  } else {
    console.log('  No calendar_uid in deleted file — skipping calendar delete.');
  }
}

console.log('\n✓ Calendar sync complete.');
