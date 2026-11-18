#!/usr/bin/env node
// Builds the two bookmarklets and the drag-and-drop install page from
// universal-chat-exporter.js. Run `node build.mjs` after editing the source.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, 'universal-chat-exporter.js');

function minify(code) {
  const dir = mkdtempSync(join(tmpdir(), 'uce-'));
  try {
    const inFile = join(dir, 'in.js');
    const outFile = join(dir, 'out.js');
    writeFileSync(inFile, code, 'utf8');
    execSync(`npx --yes terser "${inFile}" -c -m -o "${outFile}"`, { stdio: 'inherit', cwd: root });
    const out = readFileSync(outFile, 'utf8').trim();
    if (!out) throw new Error('terser produced an empty file');
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const source = readFileSync(SRC, 'utf8');
const min = minify(source);

// Bookmarklets are percent-encoded so browsers keep the whole one-liner intact.
const md = 'javascript:' + encodeURIComponent(min);
const pdf = 'javascript:' + encodeURIComponent('window.__UCE_MODE="pdf";' + min);

writeFileSync(join(root, 'bookmarklet-md.txt'), md, 'utf8');
writeFileSync(join(root, 'bookmarklet-pdf.txt'), pdf, 'utf8');

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Universal AI Chat Exporter</title>
<style>
:root{--bg:#fff;--fg:#1f1f1f;--mut:#666;--card:#f6f5f1;--acc:#c2410c;--bd:#e2e0d8}
@media(prefers-color-scheme:dark){:root{--bg:#17181b;--fg:#eceef2;--mut:#a2a8b3;--card:#22242a;--acc:#f97316;--bd:#363a43}}
body{background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:680px;margin:44px auto;padding:0 20px}
h1{font-size:1.55rem;margin:0 0 6px;letter-spacing:-.01em}
p.lead{color:var(--mut);margin:0 0 22px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:20px;margin:18px 0}
.card h2{font-size:.95rem;text-transform:uppercase;letter-spacing:.09em;margin:0 0 12px;color:var(--mut)}
.row{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:10px 0}
a.bm{display:inline-block;background:var(--acc);color:#fff;font-weight:650;padding:11px 20px;border-radius:9px;text-decoration:none;cursor:grab}
a.bm.alt{background:transparent;color:var(--fg);border:1px solid var(--bd);cursor:grab}
button{font:inherit;padding:8px 13px;border-radius:9px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);cursor:pointer}
button:hover{border-color:var(--acc)}
small,li{color:var(--mut)}li{margin:5px 0}code{background:var(--card);padding:1px 5px;border-radius:4px;font-size:.9em}
.foot{font-size:.85rem;color:var(--mut);margin-top:26px}
</style></head><body>
<h1>Universal AI Chat Exporter</h1>
<p class="lead">Export the open chat on <b>Claude, ChatGPT, Gemini, DeepSeek and Grok</b> as Markdown, JSON or PDF.</p>

<div class="card">
  <h2>Install</h2>
  <ol>
    <li>Show your bookmarks bar (<code>Ctrl/Cmd + Shift + B</code>).</li>
    <li>Drag a button below onto the bar. Either one exports everything — the toolbar lets you pick the format afterwards.</li>
  </ol>
  <div class="row"><a class="bm" href="${md}">Export Chat</a><a class="bm alt" href="${pdf}">Export Chat → PDF</a></div>
  <div class="row"><button data-k="md">Copy Markdown bookmarklet</button><button data-k="pdf">Copy PDF bookmarklet</button></div>
  <p><small id="s">Dragging not working (mobile, or a locked-down browser)? Use the copy button, then paste the code into a bookmark's URL field.</small></p>
</div>

<div class="card">
  <h2>Use</h2>
  <ol>
    <li>Open a specific conversation on a supported site.</li>
    <li>Click the bookmark. A small card appears in the top-right corner.</li>
    <li><b>Markdown</b> downloads a <code>.md</code> file straight away; the card then offers <b>JSON</b>, <b>PDF</b> and <b>Copy</b>.</li>
    <li>For PDF, choose <code>Save as PDF</code> in the print dialog and turn off “Headers and footers” for the cleanest pages.</li>
  </ol>
  <p><small>Everything runs in your browser. Nothing is uploaded. Gemini chats auto-scroll to load older messages, so give long ones a few seconds.</small></p>
</div>

<p class="foot">Open source, no account, no extension. Built with love for people who keep their chats.</p>

<script>var B={md:"${md}",pdf:"${pdf}"};
document.querySelectorAll("button[data-k]").forEach(function(b){b.onclick=function(){navigator.clipboard.writeText(B[b.dataset.k]).then(function(){b.textContent="Copied!"},function(){b.textContent="Copy failed — select the .txt file instead"})}});</script>
</body></html>
`;
writeFileSync(join(root, 'install-bookmarklet.html'), page, 'utf8');

const kb = (p) => Math.round(statSync(join(root, p)).size / 1024) + ' KB';
console.log('source   ' + kb('universal-chat-exporter.js'));
console.log('md       ' + kb('bookmarklet-md.txt'));
console.log('pdf      ' + kb('bookmarklet-pdf.txt'));
console.log('install  ' + kb('install-bookmarklet.html'));
