/**
 * gig-assistant.mjs
 *
 * Unified gig manager: add, edit, or delete a gig from a plain-English instruction.
 * Claude determines intent from the instruction and the list of existing gigs.
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
  unlinkSync(join(gigsDir, file));
  console.log(`\n✓ Deleted: src/content/gigs/${file}`);

} else {
  console.error(`Unknown action: "${action}"`);
  process.exit(1);
}

writeFileSync('/tmp/gig-summary.txt', summary || `${action} gig`, 'utf8');
