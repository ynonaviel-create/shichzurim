/* צילומי מסך של האתר לקובץ, דרך כרום ללא-ראש ב-CDP (בלי להתקין כלום; node ≥ 22).
   הרצה: node tools/cdp-shots.mjs <תיקיית פלט>   — דורש שרת מקומי על 8766 (preview shichzurim-alt).
   למה לא --screenshot: מצלם לפני שהאתר מסיים לרנדר, ורוחב 375 לא נאכף. פרטים: זיכרון headless-chrome-screenshots. */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
const S = process.argv[2], B = 'http://localhost:8766/';
const CH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
rmSync(S + '/prof-cdp', { recursive: true, force: true });
const chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9333', '--user-data-dir=' + S + '/prof-cdp', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://127.0.0.1:9333/json'); const t = (await r.json()).find((x) => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; } } catch {}
    await sleep(300);
  }
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function viewport(mobile) {
  if (mobile) await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${S}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}
async function go(url) { await send('Page.navigate', { url }); await sleep(1800); }
async function prime() {
  await go(B + '#/');
  await ev("localStorage.setItem('shichzurim.seenIntro.v2','1'); localStorage.setItem('shichzurim.tourDone.v4','1'); localStorage.removeItem('shichzurim.whatsNew.v6'); 1");
}
await connect();
await send('Page.enable'); await send('Runtime.enable');
await viewport(false);
await prime();
/* ── באנר „מה חדש” ── */
await go(B + '?whatsnew=1&v=c1#/'); await shot('wn-desktop-dark');
await go(B + '?whatsnew=1&theme=light&v=c2#/'); await shot('wn-desktop-light');
await viewport(true); await go(B + '?whatsnew=1&v=c3#/'); await shot('wn-mobile-dark');
await viewport(false);
/* ── סיור v5 — צעד אחרי צעד ── */
await go(B + '?tour=v5&v=c4#/'); await sleep(1500);
for (let i = 1; i <= 8; i++) {
  await sleep(600);
  await shot('tour-v5-step' + i);
  if (i < 8) { await ev("document.querySelector('.tour-nav .btn.primary')?.click(); 1"); await sleep(2200); }
}
await ev("document.querySelector('.tour-nav .btn.primary')?.click(); 1");
await go(B + '?tour=v5&theme=light&step=2&v=c5#/'); await sleep(2500); await shot('tour-v5-light-step3');
await viewport(true); await go(B + '?tour=v5&step=1&v=c6#/'); await sleep(2500); await shot('tour-v5-mobile-step2');
await go(B + '?tour=v5&step=6&v=c7#/'); await sleep(3000); await shot('tour-v5-mobile-step7');
chrome.kill(); process.exit(0);
