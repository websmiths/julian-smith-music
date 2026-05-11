#!/usr/bin/env node
/**
 * One-time helper to get a Google OAuth refresh token.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-google-refresh-token.mjs
 *
 * Make sure http://localhost:8765 is listed as an Authorized Redirect URI
 * on your OAuth Client in Google Cloud Console → Credentials.
 */

import http from 'http';
import { exec } from 'child_process';

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT          = 8765;
const REDIRECT_URI  = `http://localhost:${PORT}`;
const SCOPE         = 'https://www.googleapis.com/auth/calendar';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.');
  process.exit(1);
}

const authUrl = `https://accounts.google.com/o/oauth2/auth?` + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400); res.end('No code in callback.'); return;
  }

  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<h2>Auth complete — you can close this tab.</h2>');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });
    const data = await tokenRes.json();
    console.log('\n=== Token response ===');
    console.log(JSON.stringify(data, null, 2));
    if (data.refresh_token) {
      console.log('\n✓ Your refresh token (save as GOOGLE_REFRESH_TOKEN in GitHub Secrets):');
      console.log('\n' + data.refresh_token + '\n');
    } else {
      console.log('\n⚠ No refresh_token in response — revoke access in your Google account and try again.');
    }
  } catch (err) {
    console.error('Token exchange failed:', err);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log('Opening browser to authenticate…');
  exec(`open "${authUrl}"`);
});
