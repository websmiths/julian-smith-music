/**
 * add-gig-ai.mjs
 *
 * Creates a gig .md file from a free-text description using the Claude API.
 * Runs in GitHub Actions via the "Add gig (AI)" workflow.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const description  = process.env.DESCRIPTION?.trim()       || '';
const apiKey       = process.env.ANTHROPIC_API_KEY?.trim() || '';

if (!description) { console.error('ERROR: description is required.'); process.exit(1); }
if (!apiKey)      { console.error('ERROR: ANTHROPIC_API_KEY secret is not set. Add it in: repo → Settings → Secrets and variables → Actions.'); process.exit(1); }

// ── Call Claude API ───────────────────────────────────────────────────────────
console.log(`Parsing: "${description}"`);

const prompt = `Extract gig details from this event description and return ONLY a JSON object with these fields:
- "title": descriptive event name (string, required)
- "date": date as YYYY-MM-DD (string, required)
- "time": start time like "7:30pm" or "3pm" (string or null if not mentioned)
- "venue": venue name (string, required)
- "city": city and state/region like "Lismore, NSW" or "Brisbane, QLD" (string or null if not mentioned)
- "bands": array of band/artist names (string[], required — infer from the description)
- "ticket_url": ticket purchase URL if mentioned (string or null)
- "facebook_event_url": Facebook event URL if mentioned (string or null)
- "notes": any other relevant details not captured above (string or null)

Description: "${description.replace(/"/g, '\\"')}"

Today's date for reference: ${new Date().toISOString().split('T')[0]}

Return only the JSON object, no markdown, no explanation.`;

let extracted;
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
      max_tokens: 512,
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

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  extracted = JSON.parse(cleaned);
} catch (err) {
  console.error('Failed to parse Claude response:', err.message);
  process.exit(1);
}

// ── Validate ─────────────────────────────────────────────────────────────────
const { title, date, time, venue, city, bands, ticket_url, facebook_event_url, notes } = extracted;
const errors = [];
if (!title) errors.push('title');
if (!date)  errors.push('date');
if (!venue) errors.push('venue');
if (!bands?.length) errors.push('bands');
if (errors.length) {
  console.error(`Claude couldn't extract: ${errors.join(', ')}. Try adding more detail to the description.`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`Unexpected date format from Claude: "${date}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

// ── Build .md file ────────────────────────────────────────────────────────────
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
  ...(time             ? [`time: ${JSON.stringify(time)}`]                        : []),
  `venue: ${JSON.stringify(venue)}`,
  ...(city             ? [`city: ${JSON.stringify(city)}`]                        : []),
  'bands:',
  ...bands.map(b => `  - ${JSON.stringify(b)}`),
  ...(ticket_url       ? [`ticket_url: ${JSON.stringify(ticket_url)}`]            : []),
  ...(facebook_event_url ? [`facebook_event_url: ${JSON.stringify(facebook_event_url)}`] : []),
  ...(notes            ? [`notes: ${JSON.stringify(notes)}`]                      : []),
  '---',
  '',
].join('\n');

const outDir  = join(process.cwd(), 'src', 'content', 'gigs');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, filename), yaml, 'utf8');

console.log(`\n✓ Created: src/content/gigs/${filename}`);
console.log(yaml);

writeFileSync('/tmp/gig-title.txt', title, 'utf8');
