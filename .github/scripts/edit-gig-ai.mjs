/**
 * edit-gig-ai.mjs
 *
 * Edits or deletes a gig file based on a plain-English instruction.
 * Runs in GitHub Actions via the "Edit gig (AI)" workflow.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

const instruction = process.env.INSTRUCTION?.trim() || '';
const apiKey      = process.env.ANTHROPIC_API_KEY?.trim() || '';

if (!instruction) { console.error('ERROR: instruction is required.'); process.exit(1); }
if (!apiKey)      { console.error('ERROR: ANTHROPIC_API_KEY secret is not set.'); process.exit(1); }

// ── Load all gig files ────────────────────────────────────────────────────────
const gigsDir = join(process.cwd(), 'src', 'content', 'gigs');
const files   = readdirSync(gigsDir).filter(f => f.endsWith('.md')).sort();

if (files.length === 0) {
  console.error('No gig files found.');
  process.exit(1);
}

const gigsContext = files.map(f => {
  const content = readFileSync(join(gigsDir, f), 'utf8');
  return `=== ${f} ===\n${content}`;
}).join('\n\n');

// ── Call Claude API ───────────────────────────────────────────────────────────
console.log(`Instruction: "${instruction}"`);

const prompt = `You manage gig files for a musician's website. Here are all current gig files:

${gigsContext}

Instruction: "${instruction.replace(/"/g, '\\"')}"

Today's date for reference: ${new Date().toISOString().split('T')[0]}

Return ONLY a JSON object:
- Edit:   { "action": "edit",   "file": "<exact filename>", "content": "<complete new file content>", "summary": "<one-line description for git commit>" }
- Delete: { "action": "delete", "file": "<exact filename>", "summary": "<one-line description for git commit>" }
- No match: { "action": "none", "summary": "<explain what you couldn't find>" }

Rules for edits:
- Return the COMPLETE file content, not just the changed parts
- Preserve all existing fields unless the instruction says to remove them
- Valid frontmatter fields: title, date (YYYY-MM-DD), time, venue, city, bands (list), cancelled (boolean), ticket_url, facebook_event_url, notes
- Keep the trailing newline after the closing ---

Return only the JSON object, no markdown fences, no explanation.`;

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
const { action, file, content, summary } = result;

if (action === 'none') {
  console.error(`Nothing to do: ${summary}`);
  process.exit(1);
}

if (!file || !files.includes(file)) {
  console.error(`File not found in gigs directory: "${file}"`);
  process.exit(1);
}

const filePath = join(gigsDir, file);

if (action === 'delete') {
  unlinkSync(filePath);
  console.log(`\n✓ Deleted: src/content/gigs/${file}`);
} else if (action === 'edit') {
  if (!content) {
    console.error('Claude returned an edit action but no content.');
    process.exit(1);
  }
  writeFileSync(filePath, content, 'utf8');
  console.log(`\n✓ Updated: src/content/gigs/${file}`);
  console.log(content);
} else {
  console.error(`Unknown action: "${action}"`);
  process.exit(1);
}

writeFileSync('/tmp/gig-edit-summary.txt', summary || `${action} gig: ${file}`, 'utf8');
