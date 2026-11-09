import { createHash } from "node:crypto";

// No site providers, analytics or external resources may load while the OAuth
// response is in the URL. A fixed script moves it into this browser tab only.
const script = `try {
  const q = new URLSearchParams(location.search);
  sessionStorage.setItem('house_discord_callback', JSON.stringify({code:q.get('code'),state:q.get('state'),issuer:q.get('iss'),error:q.get('error')}));
  location.replace('/discord/verify');
} catch { document.body.textContent = 'Browser storage is required to verify Discord. Enable it and start again.'; }`;

export function GET() {
  const hash = createHash("sha256").update(script).digest("base64");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Connecting Discord</title></head><body>Returning to The House…<script>${script}</script><noscript>Enable JavaScript and start verification again.</noscript></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff" },
  });
}
