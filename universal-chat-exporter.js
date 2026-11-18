// Universal AI Chat Exporter — Claude, ChatGPT, Gemini, DeepSeek, Grok → Markdown, JSON, PDF.
// Run as a bookmarklet while a conversation is open. Everything happens in your
// browser; nothing is sent anywhere except same-origin requests to the site itself.
//
// Strategy per site:
//   Claude    internal API (exact markdown source)           — most reliable
//   ChatGPT   internal API, falls back to DOM scraping
//   DeepSeek  internal API, falls back to DOM scraping
//   Gemini    DOM scraping (auto-scrolls to load old messages)
//   Grok      DOM scraping
// DOM selectors on these sites change often; if one breaks, only its small
// adapter function below needs updating.
//
// Everything after the conversation is collected is a pure text pipeline:
//   normalizeMarkdown()  cleans the model's own component syntax into portable Markdown
//   summarize()          counts messages / words / tokens for the front matter
//   buildMd() / buildJson()  produce the downloadable files
//   mdToDom() + parseTex()   typeset the same Markdown for print (PDF)
(function () {
  'use strict';

  const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const warnings = [];
  const warn = (m) => {
    try { console.warn('[chat-exporter] ' + m); } catch (e) { /* ignore */ }
    warnings.push(m);
  };
  const txt = (e) => (e.innerText !== undefined ? e.innerText : e.textContent) || '';
  const BASE_ORIGIN = () => (IN_BROWSER && typeof location !== 'undefined' ? location.origin : 'http://localhost');
  const abs = (u) => { try { return u ? new URL(u, BASE_ORIGIN()).href : null; } catch (e) { return null; } };
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  // 'md' (default) downloads a Markdown file; 'pdf' opens the print dialog -> Save as PDF.
  // The PDF bookmarklet sets window.__UCE_MODE = 'pdf' before running this script.
  const MODE = (function () {
    try { return window.__UCE_MODE === 'pdf' ? 'pdf' : 'md'; } catch (e) { return 'md'; }
  })();
  if (IN_BROWSER) {
    try { delete window.__UCE_MODE; } catch (e) { window.__UCE_MODE = undefined; }
  }

  // ───────────────────────── HTML → Markdown ─────────────────────────
  const SKIP = /^(script|style|svg|button|noscript|canvas|nav|template|textarea|input|select)$/;
  const BLOCK = /^(div|section|article|main|header|footer|aside|figure|figcaption|details|summary)$/;
  const fenceFor = (s) => '`'.repeat(Math.max(3, ...(s.match(/`+/g) || []).map((x) => x.length + 1)));
  const wrapInline = (s, m) => {
    const x = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return x[2] ? x[1] + m + x[2] + m + x[3] : s;
  };
  const texOf = (n) => {
    const a = n.querySelector('annotation[encoding="application/x-tex"]');
    return a ? a.textContent.trim() : null;
  };

  function walk(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const tag = n.tagName.toLowerCase();
    if (SKIP.test(tag)) return '';
    const cl = n.classList;

    // Math: Gemini keeps LaTeX in data-math; KaTeX keeps it in an <annotation>.
    if (n.hasAttribute('data-math')) {
      const t = n.getAttribute('data-math');
      return cl.contains('math-block') ? '\n\n$$\n' + t + '\n$$\n\n' : '$' + t + '$';
    }
    if (cl.contains('katex-display')) { const t = texOf(n); return t ? '\n\n$$\n' + t + '\n$$\n\n' : ''; }
    if (cl.contains('katex')) { const t = texOf(n); return t ? '$' + t + '$' : n.textContent; }
    // Code-block wrappers (Gemini / DeepSeek) contain label + buttons: use only the <pre>.
    if (cl.contains('md-code-block') || tag === 'code-block') {
      const p = n.querySelector('pre');
      return p ? walk(p) : '';
    }

    const kids = () => Array.from(n.childNodes).map(walk).join('');

    if (/^h[1-6]$/.test(tag)) {
      return '\n\n' + '#'.repeat(+tag[1]) + ' ' + kids().trim().replace(/\n+/g, ' ') + '\n\n';
    }
    if (BLOCK.test(tag)) return '\n' + kids().trim() + '\n';

    switch (tag) {
      case 'p': return '\n\n' + kids().trim() + '\n\n';
      case 'br': return '  \n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': return wrapInline(kids(), '**');
      case 'em': case 'i': return wrapInline(kids(), '*');
      case 'del': case 's': return wrapInline(kids(), '~~');
      case 'code': {
        const t = n.textContent;
        if (!t) return '';
        return t.includes('`') ? '`` ' + t + ' ``' : '`' + t + '`';
      }
      case 'pre': {
        const code = n.querySelector('code');
        const src = (code || n).textContent.replace(/\n$/, '');
        let lang = ((code && code.className) || n.className || '').match(/language-([\w+#.-]+)/);
        lang = lang ? lang[1] : '';
        if (!lang) {
          const root = n.closest('code-block') || n.parentElement || n;
          const lab = root.querySelector('.code-block-decoration span, .md-code-block-banner span');
          const t = lab ? lab.textContent.trim().split(/\s+/)[0].toLowerCase() : '';
          if (/^[a-z0-9+#.-]{1,20}$/.test(t) && !/^(copy|download|edit)$/.test(t)) lang = t;
        }
        const f = fenceFor(src);
        return '\n\n' + f + lang + '\n' + src + '\n' + f + '\n\n';
      }
      case 'blockquote':
        return '\n\n' + kids().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      case 'a': {
        const t = kids().trim(), h = n.getAttribute('href');
        return h && t && !/^javascript:/i.test(h) ? '[' + t + '](' + n.href + ')' : kids();
      }
      case 'img': {
        const s = n.getAttribute('src') || '';
        if (!s || s.startsWith('data:')) return n.alt ? '[image: ' + n.alt + ']' : '[image]';
        return '![' + (n.alt || '') + '](' + n.src + ')';
      }
      case 'ul': case 'ol': {
        let i = parseInt(n.getAttribute('start') || '1', 10) - 1;
        const items = Array.from(n.children).filter((c) => c.tagName === 'LI').map((li) => {
          const mark = tag === 'ol' ? ++i + '. ' : '- ';
          const body = Array.from(li.childNodes).map(walk).join('').trim()
            .replace(/\n\s*\n/g, '\n').replace(/\n/g, '\n' + ' '.repeat(mark.length));
          return mark + body;
        });
        return '\n\n' + items.join('\n') + '\n\n';
      }
      case 'table': {
        const rows = Array.from(n.querySelectorAll('tr')).map((tr) =>
          Array.from(tr.children).map((c) =>
            walk(c).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r) => '| ' + r.concat(Array(w - r.length).fill('')).join(' | ') + ' |';
        return '\n\n' + line(rows[0]) + '\n| ' + Array(w).fill('---').join(' | ') + ' |\n' +
          rows.slice(1).map(line).join('\n') + '\n\n';
      }
      default: return kids();
    }
  }

  function toMd(root) {
    if (!root) return '';
    return walk(root).replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ───────────────────────── Markdown normalizer ─────────────────────────
  // Every chat UI hands back its own dialect: Svelte widget code, <badge>,
  // <box>, <AsyncImage>, LaTeX written as \[ ... \], half-built tables and
  // H1 headings inside a reply. This turns all of that into plain, portable
  // Markdown that renders the same in Obsidian, GitHub, Notion, an LLM prompt
  // and the PDF renderer below.

  const WIDGET_NOTE = '> _Interactive widget omitted — this turn embedded an app component (quiz, form or chart) that only renders on the original site._';
  const BADGE_ICONS = { success: '✅', danger: '⛔', error: '⛔', warning: '⚠️', info: 'ℹ️', neutral: '•', subtle: '•' };
  const SVELTE_RE = /\{@body|\{#(each|if|key|await)\b|\{:(else|then|catch)\b|\{\/(each|if|key|await)\}/;
  const WRAP_OPEN_RE = /^\s*<(box|card|section|column|row|stack|grid)\b[^>]*>\s*$/i;
  const WRAP_CLOSE_RE = /^\s*<\/(box|card|section|column|row|stack|grid)>\s*$/i;
  const COMPONENT_TAGS = 'box|card|section|row|column|col|stack|grid|text|title|subtitle|label|radio-group|radio|checkbox|button|slider|toggle|tabs|tab|accordion|note|tip|alert|callout|avatar|progress|spacer|icon|image-group';

  // Tracks fenced code blocks: returns the active fence marker, or null.
  function fenceToggle(line, cur) {
    const t = String(line).trim();
    if (!cur) {
      const m = t.match(/^(`{3,}|~{3,})/);
      return m ? m[1] : null;
    }
    const ch = cur[0];
    if (t.length >= cur.length && t.split('').every((c) => c === ch)) return null;
    return cur;
  }

  function stripComponents(md) {
    const src = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');

    // 1. Embedded widget blocks (quizzes, forms, charts). They are template
    //    code without the site's runtime, so each block becomes one note.
    const flags = [];
    let fence = null;
    for (const l of src) {
      fence = fenceToggle(l, fence);
      flags.push(!fence && SVELTE_RE.test(l));
    }
    const regions = [];
    for (let i = 0; i < src.length; i++) {
      if (!flags[i]) continue;
      let last = i;
      for (let j = i + 1; j < src.length; j++) {
        if (flags[j]) last = j;
        else if (j - last > 6) break;
      }
      while (i > 0 && WRAP_OPEN_RE.test(src[i - 1])) i--;
      while (last + 1 < src.length && WRAP_CLOSE_RE.test(src[last + 1])) last++;
      regions.push([i, last]);
      i = last;
    }

    // 2. Everything else: unwrap components, keep their text.
    const out = [];
    let depth = 0, region = 0;
    fence = null;
    for (let i = 0; i < src.length; i++) {
      while (region < regions.length && i > regions[region][1]) region++;
      if (region < regions.length && i >= regions[region][0]) {
        if (i === regions[region][0]) {
          if (out.length && out[out.length - 1].trim() !== '') out.push('');
          out.push(WIDGET_NOTE);
          out.push('');
        }
        continue;
      }
      let line = src[i];
      if (fence) { out.push(line); fence = fenceToggle(line, fence); continue; }
      const fm = line.match(/^\s*(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; out.push(line); continue; }

      // Content nested inside a layout component is indented by 2 spaces per level.
      if (depth > 0) {
        const lead = (line.match(/^ */) || [''])[0].length;
        line = line.slice(Math.min(depth * 2, lead));
      }
      if (WRAP_OPEN_RE.test(line)) { depth++; continue; }
      if (WRAP_CLOSE_RE.test(line)) { depth = Math.max(0, depth - 1); continue; }

      line = line
        .replace(/<AsyncImage\b([^>]*?)\/?>/gi, (m, attrs) => {
          const q = (attrs.match(/(?:query|alt|prompt|title)\s*=\s*"([^"]*)"/i) || [])[1] || '';
          const clean = q.replace(/\s+/g, ' ').trim();
          return '\n\n> 🖼️ _Figure omitted' + (clean ? ': ' + clean : '') + '_\n\n';
        })
        .replace(/<badge\b([^>]*)>([\s\S]*?)<\/badge>/gi, (m, attrs, inner) => {
          const color = ((attrs.match(/color\s*=\s*"([^"]*)"/i) || [])[1] || '').toLowerCase();
          const icon = BADGE_ICONS[color] || '📌';
          const body = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          return body ? '\n\n> **' + icon + ' ' + body + '**\n\n' : '';
        })
        .replace(/<divider\b[^>]*\/?>/gi, '')
        .replace(new RegExp('</?(?:' + COMPONENT_TAGS + ')\\b[^>]*/?>', 'gi'), '')
        .replace(/\{[#@:/][^{}]*\}/g, '');
      out.push(line);
    }
    return out.join('\n');
  }

  // LaTeX delimiters: \[ ... \] is display math, \( ... \) is inline math.
  function convertMath(md) {
    const lines = String(md).split('\n');
    const out = [];
    let fence = null;
    for (const raw of lines) {
      if (fence) { out.push(raw); fence = fenceToggle(raw, fence); continue; }
      const fm = raw.match(/^\s*(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; out.push(raw); continue; }

      let line = raw
        .replace(/\\\[([\s\S]*?)\\\]/g, (m, body) => '\n\n$$\n' + body.trim() + '\n$$\n\n')
        .replace(/\\\(([\s\S]*?)\\\)/g, (m, body) => '$' + body.trim() + '$');
      for (const part of line.split('\n')) {
        const t = part.trim();
        if (t === '\\[') { out.push('$$'); continue; }
        if (t === '\\]') { out.push('$$'); continue; }
        if (t === '\\(' || t === '\\)') continue;
        out.push(part);
      }
    }
    return out.join('\n');
  }

  const DELIM_ROW_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const isPipeRow = (l) => /^\s*\|/.test(l) && (l.match(/\|/g) || []).length >= 2;
  const isStrayPipe = (l) => /^\s*\|\s*$/.test(l);

  function splitCells(row) {
    const s = String(row).trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = [];
    let cur = '', esc = false;
    for (const ch of s) {
      if (esc) { cur += ch; esc = false; continue; }
      if (ch === '\\') { cur += ch; esc = true; continue; }
      if (ch === '|') { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  function alignmentOf(delim) {
    return splitCells(delim).map((c) => {
      const l = c.startsWith(':'), r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
  }

  // Rebuilds every pipe table with a valid delimiter row, a consistent column
  // count and no empty rows. Fixes tables that chat models emit half-finished.
  function repairTables(md) {
    const lines = String(md).split('\n');
    const out = [];
    let fence = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (fence) { out.push(line); fence = fenceToggle(line, fence); continue; }
      const fm = line.match(/^\s*(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; out.push(line); continue; }
      if (!isPipeRow(line)) { out.push(line); continue; }

      let j = i;
      const rows = [];
      while (j < lines.length && (isPipeRow(lines[j]) || isStrayPipe(lines[j]))) rows.push(lines[j++]);
      const hasDelim = rows.length > 1 && DELIM_ROW_RE.test(rows[1]) && rows[1].indexOf('-') !== -1;
      const header = splitCells(rows[0]);
      if (!header.some((c) => c !== '')) { out.push(line); continue; }
      const align = hasDelim ? alignmentOf(rows[1]) : [];
      const body = (hasDelim ? rows.slice(2) : rows.slice(1)).map(splitCells).filter((r) => r.some((c) => c !== ''));
      const width = Math.max(header.length, align.length, ...body.map((r) => r.length), 1);
      const pad = (cells) => cells.concat(Array(Math.max(0, width - cells.length)).fill('')).slice(0, width);
      const cell = (c) => c.replace(/(^|[^\\])\|/g, '$1\\|');
      const fmt = (cells) => '| ' + pad(cells).map(cell).join(' | ') + ' |';
      const delim = '| ' + Array.from({ length: width }, (_, k) => {
        const a = align[k] || '';
        return a === 'right' ? '---:' : a === 'center' ? ':---:' : '---';
      }).join(' | ') + ' |';

      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push(fmt(header), delim);
      body.forEach((r) => out.push(fmt(r)));
      out.push('');
      i = j - 1;
    }
    return out.join('\n');
  }

  // A reply's headings must sit *under* its "Human" / "Assistant" turn heading.
  function demoteHeadings(md) {
    const lines = String(md).split('\n');
    let fence = null;
    const heads = [];
    for (let i = 0; i < lines.length; i++) {
      if (fence) { fence = fenceToggle(lines[i], fence); continue; }
      const fm = lines[i].match(/^\s*(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; continue; }
      const m = lines[i].match(/^(#{1,6})\s+\S/);
      if (m) heads.push([i, m[1].length]);
    }
    if (!heads.length) return String(md);
    const min = Math.min(...heads.map((h) => h[1]));
    const shift = Math.max(0, 2 - min);
    let prev = 1;
    for (const [i, level] of heads) {
      const next = Math.max(2, Math.min(level + shift, prev + 1, 6));
      lines[i] = lines[i].replace(/^\s*#{1,6}/, '#'.repeat(next));
      prev = next;
    }
    return lines.join('\n');
  }

  // Fence-aware whitespace cleanup: no trailing spaces, no runs of blank lines.
  function tidy(md) {
    const lines = String(md).split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    const out = [];
    let fence = null;
    for (const l of lines) {
      if (fence) { out.push(l); fence = fenceToggle(l, fence); continue; }
      const fm = l.match(/^\s*(`{3,}|~{3,})/);
      if (fm) { fence = fm[1]; out.push(l); continue; }
      if (!l && out.length && !out[out.length - 1]) continue;
      out.push(l);
    }
    while (out.length && !out[0]) out.shift();
    while (out.length && !out[out.length - 1]) out.pop();
    return out.join('\n');
  }

  function normalizeMarkdown(md) {
    if (md == null || md === '') return '';
    let t = String(md).replace(/\r\n?/g, '\n')
      .replace(/[\u200b\u2060\ufeff]/g, '')
      .replace(/【\d+(?::\d+)?†[^】]*】/g, '')   // ChatGPT citation markers
      .replace(/\*\*\s*\*\*/g, '');
    t = stripComponents(t);
    t = convertMath(t);
    t = repairTables(t);
    t = demoteHeadings(t);
    return tidy(t);
  }

  // ───────────────────────── Stats & output ─────────────────────────
  const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');
  const fmtTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toLocaleString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const slug = (t) => String(t || '').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '').toLowerCase().substring(0, 100);
  const yq = (v) => '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  function summarize(conv) {
    const msgs = (conv && conv.messages) || [];
    let words = 0, chars = 0, codeBlocks = 0, tables = 0, mathBlocks = 0, links = 0;
    let human = 0, assistant = 0;
    const stamps = [];
    for (const m of msgs) {
      const t = String(m.text || '');
      if (m.role === 'human') human++; else assistant++;
      chars += t.length;
      const prose = t.replace(/```[\s\S]*?```/g, ' ');
      const w = prose.match(/[A-Za-z0-9][A-Za-z0-9'’.‑-]*|[\u0900-\u0DFF]+|[\u4E00-\u9FFF]/g);
      words += w ? w.length : 0;
      codeBlocks += Math.floor((t.match(/^\s*`{3,}/gm) || []).length / 2);
      mathBlocks += Math.floor((t.match(/^\s*\$\$\s*$/gm) || []).length / 2);
      tables += (t.match(/^\s*\|[\s:|-]*-{2,}[\s:|-]*\|\s*$/gm) || []).length;
      links += (t.match(/\[[^\]]*\]\([^)\s]+/g) || []).length;
      const ts = m.ts ? Date.parse(m.ts) : NaN;
      if (!isNaN(ts)) stamps.push(ts);
    }
    const spanMs = stamps.length > 1 ? Math.max(...stamps) - Math.min(...stamps) : 0;
    return {
      messages: msgs.length,
      human: human,
      assistant: assistant,
      words: words,
      characters: chars,
      approxTokens: Math.max(1, Math.round(chars / 4)),
      codeBlocks: codeBlocks,
      tables: tables,
      mathBlocks: mathBlocks,
      links: links,
      readingMinutes: Math.max(1, Math.round(words / 220)),
      spanMinutes: Math.round(spanMs / 60000),
    };
  }

  const sourceUrl = (conv) => conv.source || (IN_BROWSER ? location.origin + location.pathname : '');

  function buildMd(conv, site) {
    const stats = conv.stats || summarize(conv);
    const fm = ['---',
      'title: ' + yq(conv.title),
      'source: ' + yq(sourceUrl(conv)),
      'platform: ' + yq(site.name)];
    if (conv.model) fm.push('model: ' + yq(conv.model));
    fm.push('exported: ' + new Date().toISOString().slice(0, 10),
      'messages: ' + stats.messages,
      'words: ' + stats.words,
      'approx_tokens: ' + stats.approxTokens,
      '---', '');
    let md = fm.join('\n') + '\n';
    md += '> **Export summary** — ' + stats.messages + ' messages (' + stats.human + ' human, ' +
      stats.assistant + ' replies) · ' + fmtNum(stats.words) + ' words · ~' + fmtNum(stats.approxTokens) +
      ' tokens · ' + stats.readingMinutes + ' min read\n\n';
    for (const m of conv.messages) {
      const ts = fmtTime(m.ts);
      md += '# ' + (m.role === 'human' ? 'Human' : site.name) + (ts ? ' — ' + ts : '') + '\n\n' +
        m.text + (m.note ? '\n\n' + m.note : '') + '\n\n';
    }
    return md;
  }

  function buildJson(conv, site) {
    const stats = conv.stats || summarize(conv);
    return JSON.stringify({
      format: 'universal-chat-export',
      version: 2,
      exportedAt: new Date().toISOString(),
      conversation: {
        title: conv.title || '',
        platform: site.name,
        model: conv.model || null,
        source: sourceUrl(conv),
      },
      stats: stats,
      messages: conv.messages.map((m, i) => ({
        index: i + 1,
        role: m.role,
        timestamp: m.ts || null,
        words: (String(m.text || '').match(/\S+/g) || []).length,
        text: m.text,
        note: m.note || null,
      })),
    }, null, 2);
  }

  // ───────────────────────── LaTeX → typeset nodes ─────────────────────────
  // Chat models emit a small, predictable subset of LaTeX. Printing its source
  // (as the old version did) is what made PDFs look unfinished, so it is parsed
  // into a tiny node tree here and rendered as real fractions, roots, aligned
  // rows and matrices. Unknown commands degrade to their bare name.
  const TEX_SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
    eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
    xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
    upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼',
    simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', infty: '∞', partial: '∂', nabla: '∇',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔',
    Leftrightarrow: '⇔', mapsto: '↦', implies: '⇒', iff: '⇔', uparrow: '↑', downarrow: '↓',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
    cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
    neg: '¬', land: '∧', lor: '∨', oplus: '⊕', otimes: '⊗', sum: '∑', prod: '∏', coprod: '∐',
    int: '∫', iint: '∬', oint: '∮', nabla2: '∇²',
    ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
    angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵', degree: '°', prime: '′',
    langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
    lbrace: '{', rbrace: '}', vert: '|', Vert: '‖', mid: '|', backslash: '\\',
    hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ',
  };
  const TEX_SPACES = { ',': 0.17, ':': 0.22, ';': 0.28, ' ': 0.35, quad: 1, qquad: 2, enspace: 0.5, thinspace: 0.17, negthinspace: 0 };

  function parseTex(src) {
    const s = String(src == null ? '' : src).replace(/\r/g, ' ');
    let i = 0;
    const out = [];
    const addText = (v) => {
      if (!v) return;
      const last = out[out.length - 1];
      if (last && last.k === 't') last.v += v;
      else out.push({ k: 't', v: v });
    };
    const skipWs = () => { while (i < s.length && /[ \t\n]/.test(s[i])) i++; };
    function readGroup() {
      let depth = 0;
      const start = ++i;
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') { i++; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) { const body = s.slice(start, i); i++; return body; }
          depth--;
        }
      }
      return s.slice(start);
    }
    function readArg() {
      skipWs();
      if (i >= s.length) return '';
      if (s[i] === '{') return readGroup();
      if (s[i] === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        if (m) { i += m[0].length; return m[0]; }
        i++;
        return '';
      }
      return s[i++];
    }

    while (i < s.length) {
      const c = s[i];
      if (c !== '\\') {
        if (c === '^' || c === '_') {
          i++;
          const arg = parseTex(readArg());
          out.push({ k: c === '^' ? 'sup' : 'sub', body: arg });
          continue;
        }
        if (c === '{') { const g = readGroup(); out.push.apply(out, parseTex(g)); continue; }
        if (c === '}') { i++; continue; }
        if (c === '~') { i++; addText(' '); continue; }
        if (c === '&') { i++; continue; }
        addText(c === '\n' ? ' ' : c);
        i++;
        continue;
      }

      const rest = s.slice(i);
      if (rest[1] === '\\') { i += 2; out.push({ k: 'br' }); continue; }
      const m = /^\\([A-Za-z]+|.)/.exec(rest);
      if (!m) { i++; continue; }
      const name = m[1];
      i += m[0].length;

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const num = parseTex(readArg());
        const den = parseTex(readArg());
        out.push({ k: 'frac', num: num, den: den });
        continue;
      }
      if (name === 'sqrt') {
        skipWs();
        let idx = null;
        if (s[i] === '[') {
          const close = s.indexOf(']', i);
          if (close > i) { idx = parseTex(s.slice(i + 1, close)); i = close + 1; }
        }
        out.push({ k: 'sqrt', body: parseTex(readArg()), idx: idx });
        continue;
      }
      if (name === 'boxed' || name === 'fbox') { out.push({ k: 'box', body: parseTex(readArg()) }); continue; }
      if (name === 'text' || name === 'textrm' || name === 'textup' || name === 'mbox' || name === 'operatorname' ||
          name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'mathbb' ||
          name === 'mathcal' || name === 'mathsf' || name === 'mathtt' || name === 'boldsymbol') {
        out.push({ k: 'up', body: parseTex(readArg()), bold: /bf$|boldsymbol$/.test(name) });
        continue;
      }
      if (name === 'overline' || name === 'underline' || name === 'bar') {
        out.push({ k: 'line', pos: name === 'underline' ? 'under' : 'over', body: parseTex(readArg()) });
        continue;
      }
      if (/^(hat|widehat|vec|dot|ddot|tilde|widetilde)$/.test(name)) {
        const mark = { hat: '\u0302', widehat: '\u0302', vec: '\u20d7', dot: '\u0307', ddot: '\u0308', tilde: '\u0303', widetilde: '\u0303' }[name];
        const body = parseTex(readArg());
        out.push.apply(out, body);
        const last = out[out.length - 1];
        if (last && last.k === 't') last.v = last.v.replace(/([\s\S])$/, '$1' + mark);
        else out.push({ k: 't', v: mark });
        continue;
      }
      if (name === 'begin') {
        const env = readGroup();
        const esc = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tail = s.slice(i);
        const em = tail.match(new RegExp('\\\\end\\s*\\{' + esc + '\\}'));
        const body = em ? tail.slice(0, em.index) : tail;
        i = em ? i + em.index + em[0].length : s.length;
        out.push({ k: 'env', name: env, rows: splitTexRows(body) });
        continue;
      }
      if (name === 'end') { readGroup(); continue; }
      if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|middle)$/.test(name)) {
        skipWs();
        if (s[i] === '.') i++;
        continue;
      }
      if (/^(displaystyle|textstyle|scriptstyle|limits|nolimits|!)$/.test(name)) continue;
      if (Object.prototype.hasOwnProperty.call(TEX_SPACES, name)) { out.push({ k: 'sp', w: TEX_SPACES[name] }); continue; }
      if (name === '|') { addText('‖'); continue; }
      if (name.length === 1) {
        const lit = { '{': '{', '}': '}', '%': '%', '&': '&', '_': '_', '#': '#', '$': '$' }[name];
        addText(lit != null ? lit : (name === ' ' ? ' ' : name));
        continue;
      }
      if (TEX_SYMBOLS[name]) { addText(TEX_SYMBOLS[name]); continue; }
      addText(name);   // unknown command: readable word, never a backslash
    }
    return out;
  }

  function splitTexRows(body) {
    const s = String(body);
    const rows = [];
    let row = [], cell = '', depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        const nx = s[i + 1];
        if (nx === '\\' && depth === 0) { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
        cell += c + (nx || '');
        i++;
        continue;
      }
      if (c === '{') { depth++; cell += c; continue; }
      if (c === '}') { depth = Math.max(0, depth - 1); cell += c; continue; }
      if (c === '&' && depth === 0) { row.push(cell); cell = ''; continue; }
      cell += c;
    }
    row.push(cell);
    rows.push(row);
    return rows
      .map((r) => r.map((c) => parseTex(c)))
      .filter((r) => r.some((cells) => cells.length > 0));
  }

  function renderTex(nodes, d) {
    const out = d.createDocumentFragment();
    const el = (t, c) => { const e = d.createElement(t); if (c) e.className = c; return e; };
    for (const n of nodes || []) {
      switch (n.k) {
        case 't': out.appendChild(d.createTextNode(n.v)); break;
        case 'sp': { const sp = el('span', 'msp'); sp.style.width = (n.w || 0) + 'em'; out.appendChild(sp); break; }
        case 'br': out.appendChild(el('br')); break;
        case 'up': { const sp = el('span', n.bold ? 'mup mbold' : 'mup'); sp.appendChild(renderTex(n.body, d)); out.appendChild(sp); break; }
        case 'sup': { const sp = el('sup'); sp.appendChild(renderTex(n.body, d)); out.appendChild(sp); break; }
        case 'sub': { const sp = el('sub'); sp.appendChild(renderTex(n.body, d)); out.appendChild(sp); break; }
        case 'frac': {
          const f = el('span', 'mfrac');
          const num = el('span', 'mnum'); num.appendChild(renderTex(n.num, d));
          const den = el('span', 'mden'); den.appendChild(renderTex(n.den, d));
          f.appendChild(num); f.appendChild(den); out.appendChild(f);
          break;
        }
        case 'sqrt': {
          const r = el('span', 'msqrt');
          if (n.idx && n.idx.length) { const ix = el('sup'); ix.appendChild(renderTex(n.idx, d)); r.appendChild(ix); }
          const rad = el('span', 'mrad'); rad.textContent = '√'; r.appendChild(rad);
          const roof = el('span', 'mroof'); roof.appendChild(renderTex(n.body, d)); r.appendChild(roof);
          out.appendChild(r);
          break;
        }
        case 'box': { const b = el('span', 'mboxed'); b.appendChild(renderTex(n.body, d)); out.appendChild(b); break; }
        case 'line': {
          const b = el('span', n.pos === 'under' ? 'muline' : 'moline');
          b.appendChild(renderTex(n.body, d)); out.appendChild(b);
          break;
        }
        case 'env': out.appendChild(renderEnv(n, d)); break;
        default: break;
      }
    }
    return out;
  }

  function renderEnv(n, d) {
    const el = (t, c) => { const e = d.createElement(t); if (c) e.className = c; return e; };
    const name = String(n.name || '');
    const kind = /cases/.test(name) ? 'cases'
      : /matrix/.test(name) || /array/.test(name)
        ? (/pmatrix/.test(name) ? 'pmatrix' : /bmatrix/.test(name) ? 'bmatrix' : /vmatrix/.test(name) ? 'vmatrix' : 'matrix')
        : 'aligned';
    const wrap = el('span', 'menv menv-' + kind);
    if (kind === 'cases') { const br = el('span', 'mbrace'); br.textContent = '{'; wrap.appendChild(br); }
    if (kind === 'pmatrix') wrap.appendChild(d.createTextNode('('));
    if (kind === 'bmatrix') wrap.appendChild(d.createTextNode('['));
    if (kind === 'vmatrix') wrap.appendChild(d.createTextNode('|'));
    const tbl = el('span', 'mtable');
    (n.rows || []).forEach((row) => {
      const tr = el('span', 'mrow');
      (row || []).forEach((cells, ci) => {
        const td = el('span', 'mcell' + (ci === 0 && kind === 'aligned' ? ' mcell-r' : ' mcell-l'));
        td.appendChild(renderTex(cells, d));
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    wrap.appendChild(tbl);
    if (kind === 'pmatrix') wrap.appendChild(d.createTextNode(')'));
    if (kind === 'bmatrix') wrap.appendChild(d.createTextNode(']'));
    if (kind === 'vmatrix') wrap.appendChild(d.createTextNode('|'));
    return wrap;
  }

  // ───────────────────────── PDF (print layout) ─────────────────────────
  // Small Markdown -> DOM renderer. It builds nodes with createElement/textContent
  // only (no innerHTML), so it also works on Trusted-Types sites like Gemini.
  function mdToDom(md, d, parent) {
    const el = (t, c) => { const e = d.createElement(t); if (c) e.className = c; return e; };
    const okUrl = (u) => (u && /^(https?:|mailto:)/i.test(u) ? u : null);
    const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*(?!\s)([^*\n]+?)(?<!\s)\*|\$(?!\s)([^$\n]+?)(?<!\s)\$/g;
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
    const startsBlock = (l) => /^\s*(`{3,}|~{3,})/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST.test(l) || HR.test(l) || /^\s*\$\$\s*$/.test(l);

    function inline(text, p) {
      const re = new RegExp(INLINE.source, 'g');
      let last = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > last) p.appendChild(d.createTextNode(text.slice(last, m.index)));
        if (m[1] !== undefined) { const c = el('code'); c.textContent = m[2]; p.appendChild(c); }
        else if (m[4] !== undefined) {
          const u = okUrl(abs(m[4]));
          if (u) { const im = el('img'); im.src = u; im.alt = m[3]; p.appendChild(im); }
          else p.appendChild(d.createTextNode('[image' + (m[3] ? ': ' + m[3] : '') + ']'));
        } else if (m[6] !== undefined) {
          const u = okUrl(abs(m[6]));
          if (u) { const a = el('a'); a.href = u; inline(m[5], a); p.appendChild(a); }
          else inline(m[5], p);
        } else if (m[7] !== undefined) { const b = el('strong'); inline(m[7], b); p.appendChild(b); }
        else if (m[8] !== undefined) { const s = el('del'); inline(m[8], s); p.appendChild(s); }
        else if (m[9] !== undefined) { const e = el('em'); inline(m[9], e); p.appendChild(e); }
        else if (m[10] !== undefined) {
          const sp = el('span', 'math');
          sp.appendChild(renderTex(parseTex(m[10]), d));
          p.appendChild(sp);
        }
        last = re.lastIndex;
      }
      if (last < text.length) p.appendChild(d.createTextNode(text.slice(last)));
    }

    const splitRow = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

    function mathBlock(tex, p) {
      const wrap = el('div', 'mathblock' + (tex.replace(/\s+/g, ' ').length > 90 ? ' mwide' : ''));
      wrap.appendChild(renderTex(parseTex(tex), d));
      p.appendChild(wrap);
    }

    function blocks(lines, p) {
      let i = 0, m;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }

        if ((m = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/))) { // fenced code
          const close = new RegExp('^\\s*' + m[1][0] + '{' + m[1].length + ',}\\s*$');
          const buf = [];
          i++;
          while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
          i++;
          const pre = el('pre'), code = el('code');
          code.textContent = buf.join('\n');
          pre.appendChild(code);
          if (m[2]) pre.setAttribute('data-lang', m[2]);
          p.appendChild(pre);
          continue;
        }
        if ((m = line.match(/^\s*\$\$(.+?)\$\$\s*$/))) { mathBlock(m[1], p); i++; continue; }
        if (/^\s*\$\$\s*$/.test(line)) { // display math block
          const buf = [];
          i++;
          while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
          i++;
          if (buf.length) mathBlock(buf.join('\n'), p);
          continue;
        }
        if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
          const h = el('h' + m[1].length);
          inline(m[2].replace(/\s+#+\s*$/, ''), h);
          p.appendChild(h); i++; continue;
        }
        if (HR.test(line)) { p.appendChild(el('hr')); i++; continue; }
        if (/^\s*>/.test(line)) {
          const buf = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
          const bq = el('blockquote');
          blocks(buf, bq);
          p.appendChild(bq); continue;
        }
        if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
          /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
          const t = el('table'), th = el('thead'), tb = el('tbody'), hr = el('tr');
          splitRow(line).forEach((c) => { const x = el('th'); inline(c, x); hr.appendChild(x); });
          th.appendChild(hr); t.appendChild(th);
          i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
            const tr = el('tr');
            splitRow(lines[i++]).forEach((c) => { const x = el('td'); inline(c, x); tr.appendChild(x); });
            tb.appendChild(tr);
          }
          t.appendChild(tb); p.appendChild(t); continue;
        }
        if ((m = line.match(LIST))) {
          const base = m[1].length, ordered = /\d/.test(m[2]);
          const list = el(ordered ? 'ol' : 'ul');
          if (ordered && parseInt(m[2], 10) !== 1) list.setAttribute('start', parseInt(m[2], 10));
          let cur = null;
          const flush = () => {
            if (!cur) return;
            const li = el('li');
            blocks(cur, li);
            const f = li.firstChild;
            if (f && f.nodeName === 'P') {
              while (f.firstChild) li.insertBefore(f.firstChild, f);
              li.removeChild(f);
              if (li.childNodes.length && li.lastChild && li.lastChild.nodeName === 'BR') li.removeChild(li.lastChild);
            }
            list.appendChild(li); cur = null;
          };
          while (i < lines.length) {
            const l = lines[i], lm = l.match(LIST), ind = l.length - l.trimStart().length;
            if (lm && lm[1].length <= base) {
              if (/\d/.test(lm[2]) !== ordered && lm[1].length === base) break;
              flush(); cur = [lm[3]]; i++;
            } else if (!l.trim()) {
              let j = i + 1;
              while (j < lines.length && !lines[j].trim()) j++;
              if (j < lines.length && (lines[j].length - lines[j].trimStart().length > base || LIST.test(lines[j]))) { if (cur) cur.push(''); i++; }
              else break;
            } else if (ind > base && cur) { cur.push(l.slice(Math.min(ind, base + 2))); i++; }
            else break;
          }
          flush();
          p.appendChild(list); continue;
        }
        const para = el('p');
        let first = true;
        while (i < lines.length && lines[i].trim() && (first || !startsBlock(lines[i]))) {
          if (!first) para.appendChild(el('br'));
          inline(lines[i].replace(/\s+$/, ''), para);
          first = false; i++;
        }
        p.appendChild(para);
      }
    }
    blocks(String(md).replace(/\r\n?/g, '\n').split('\n'), parent);
  }

  // Test / console hooks. Everything up to here is DOM-free, so the pipeline
  // can be exercised under Node; the browser-only code below never runs there.
  const api = {
    normalizeMarkdown: normalizeMarkdown,
    stripComponents: stripComponents,
    convertMath: convertMath,
    repairTables: repairTables,
    demoteHeadings: demoteHeadings,
    summarize: summarize,
    buildMd: buildMd,
    buildJson: buildJson,
    parseTex: parseTex,
    renderTex: renderTex,
    mdToDom: mdToDom,
    toMd: toMd,
    slug: slug,
    MODE: MODE,
  };
  if (typeof globalThis !== 'undefined') globalThis.__UCE = api;
  if (!IN_BROWSER) return;

  const PDF_CSS = '@page{size:A4;margin:16mm 15mm 18mm}' +
    '*{box-sizing:border-box}html{color-scheme:light}' +
    'body{margin:0;color:#16181d;background:#fff;font:10.5pt/1.62 "Segoe UI",-apple-system,Roboto,"Noto Sans","Noto Sans Devanagari",Arial,sans-serif;' +
    '-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-wrap:break-word}' +
    '.cover{padding-bottom:12pt;border-bottom:2.5pt solid #c2410c;margin-bottom:16pt}' +
    '.kicker{font:700 7.5pt/1 "Segoe UI",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#c2410c;margin-bottom:7pt}' +
    '.doc-title{font-size:20.5pt;line-height:1.2;margin:0 0 11pt;font-weight:700;letter-spacing:-.01em;color:#0e1015}' +
    '.meta-grid{display:flex;flex-wrap:wrap;gap:7pt 22pt;margin:0 0 9pt}' +
    '.meta-grid div{display:flex;flex-direction:column;gap:1.5pt;min-width:64pt}' +
    '.meta-grid span{font:700 6.8pt/1 "Segoe UI",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#8a8f98}' +
    '.meta-grid strong{font-size:9.4pt;font-weight:600;color:#2a2d34}' +
    '.source{font-size:7.8pt;color:#8a8f98;text-decoration:none;word-break:break-all}' +
    '.turn{margin:0 0 14pt;padding:0 0 0 10pt;border-left:2.5pt solid #d9dbe0;break-inside:auto}' +
    '.turn.human{border-left-color:#c2410c}.turn.ai{border-left-color:#2563eb}' +
    '.turn-head{display:flex;align-items:baseline;gap:7pt;margin-bottom:5pt;break-after:avoid}' +
    '.who{font:700 8pt/1 "Segoe UI",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#3d4149}' +
    '.turn.human .who{color:#9a3412}.turn.ai .who{color:#1e40af}' +
    '.ts{font-size:7.6pt;color:#9aa0a8}' +
    '.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}' +
    'p{margin:0 0 6.5pt;orphans:3;widows:3;text-align:left}' +
    'h2,h3,h4,h5,h6{margin:12pt 0 5pt;line-height:1.28;font-weight:650;break-after:avoid;break-inside:avoid;color:#0e1015}' +
    'h2{font-size:13.4pt;padding-bottom:3pt;border-bottom:.6pt solid #e6e8ec}' +
    'h3{font-size:11.8pt}h4{font-size:10.8pt}h5,h6{font-size:10.2pt}' +
    'ul,ol{margin:0 0 7pt;padding-left:17pt}li{margin:2.5pt 0}li>p{margin:0 0 3pt}' +
    'code{font:8.8pt/1.4 "Cascadia Mono",ui-monospace,Menlo,Consolas,monospace;background:#f1f0ec;padding:.5pt 3pt;border-radius:3pt;color:#8a2f0c}' +
    'pre{margin:7pt 0;padding:8pt 10pt;background:#faf9f6;border:.6pt solid #e3e1da;border-left:2.5pt solid #d6d3c9;border-radius:4pt;' +
    'white-space:pre-wrap;word-break:break-word;font:8.6pt/1.45 "Cascadia Mono",ui-monospace,Menlo,Consolas,monospace;color:#24262b}' +
    'pre code{background:none;padding:0;font:inherit;color:inherit}' +
    'pre[data-lang]::before{content:attr(data-lang);display:block;font:700 6.8pt/1 "Segoe UI",sans-serif;letter-spacing:.12em;' +
    'text-transform:uppercase;color:#9aa0a8;margin-bottom:5pt}' +
    'blockquote{margin:7pt 0;padding:6pt 10pt;background:#f8f6f2;border-left:2.5pt solid #c2410c;border-radius:0 4pt 4pt 0;color:#3a3d44;break-inside:avoid}' +
    'blockquote p:last-child{margin-bottom:0}blockquote strong{color:#8a2f0c}' +
    'table{border-collapse:collapse;width:100%;margin:7pt 0;font-size:9.2pt;break-inside:auto}' +
    'thead{display:table-header-group}tr{break-inside:avoid}' +
    'th,td{border:.6pt solid #dcdee3;padding:3.5pt 7pt;text-align:left;vertical-align:top}' +
    'th{background:#f2f1ed;font-weight:650;font-size:8.6pt;letter-spacing:.02em}' +
    'tbody tr:nth-child(even) td{background:#fbfbfa}' +
    'img{max-width:100%;height:auto;break-inside:avoid;border-radius:3pt}' +
    'a{color:#1d4ed8;text-decoration:none;border-bottom:.4pt dotted #9db2e6}' +
    'hr{border:0;border-top:.6pt solid #e0e2e7;margin:10pt 0}' +
    '.note{font-style:italic;color:#9a6a00;font-size:9pt;margin-top:5pt;padding-left:8pt;border-left:2pt solid #f0c060}' +
    '.math{font-family:"Cambria Math","Latin Modern Math","STIX Two Math",Cambria,serif;font-size:1.04em;white-space:nowrap}' +
    '.mathblock{margin:8pt 0;text-align:center;font-family:"Cambria Math","Latin Modern Math","STIX Two Math",Cambria,serif;' +
    'font-size:11pt;break-inside:avoid;white-space:nowrap}' +
    '.mathblock.mwide{text-align:left;white-space:normal;font-size:9.8pt;line-height:1.5}' +
    '.mfrac{display:inline-block;vertical-align:-.45em;text-align:center;margin:0 .18em}' +
    '.mnum,.mden{display:block;padding:0 .22em;line-height:1.18}' +
    '.mnum{border-bottom:.6pt solid currentColor;padding-bottom:.1em}' +
    '.mden{padding-top:.1em}' +
    '.msqrt{display:inline-block;white-space:nowrap}' +
    '.msqrt>.mrad{font-size:1.05em;padding-right:.04em}' +
    '.msqrt>.mroof{border-top:.6pt solid currentColor;padding:.12em .15em 0}' +
    '.msqrt>sup{font-size:.62em}' +
    '.mboxed{display:inline-block;padding:.12em .34em;border:.8pt solid currentColor;border-radius:2pt}' +
    '.moline{border-top:.6pt solid currentColor;padding-top:.08em}' +
    '.muline{border-bottom:.6pt solid currentColor;padding-bottom:.08em}' +
    '.mup{font-family:inherit;font-style:normal;font-size:.96em}.mbold{font-weight:700}' +
    '.msp{display:inline-block}' +
    '.mtable{display:inline-table;border-collapse:collapse;vertical-align:middle;margin:0 .15em}' +
    '.mrow{display:table-row}' +
    '.mcell{display:table-cell;padding:.06em .3em;line-height:1.4}' +
    '.mcell-r{text-align:right}.mcell-l{text-align:left}' +
    '.menv-cases>.mbrace{font-size:2.2em;line-height:1;vertical-align:middle;margin-right:-.1em}' +
    'sup,sub{font-size:.66em;line-height:0}' +
    '.doc-foot{margin-top:18pt;padding-top:8pt;border-top:.6pt solid #e0e2e7;font-size:7.6pt;color:#9aa0a8;display:flex;justify-content:space-between;gap:10pt}';

  // Renders the conversation into a hidden same-origin iframe and opens the print
  // dialog (choose "Save as PDF"). Text stays selectable and every script/emoji works.
  async function printPdf(conv, site) {
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(fr);
    const w = fr.contentWindow, d = fr.contentDocument;
    if (!w || !d) { fr.remove(); throw new Error('Could not create a print frame (blocked by the page).'); }
    const title = conv.title || site.name + ' conversation';
    d.title = title;
    const st = d.createElement('style');
    st.textContent = PDF_CSS;
    d.head.appendChild(st);

    const stats = conv.stats || summarize(conv);
    const el = (t, c) => { const e = d.createElement(t); if (c) e.className = c; return e; };

    // Cover block: title, provenance, and the numbers a reader wants up front.
    const cover = el('header', 'cover');
    const kicker = el('div', 'kicker');
    kicker.textContent = site.name + ' conversation';
    cover.appendChild(kicker);
    const h1 = el('h1', 'doc-title');
    h1.textContent = title;
    cover.appendChild(h1);

    const grid = el('div', 'meta-grid');
    const cells = [
      ['Platform', site.name],
      ['Model', conv.model || '—'],
      ['Messages', fmtNum(stats.messages)],
      ['Words', fmtNum(stats.words)],
      ['Tokens (≈)', '~' + fmtNum(stats.approxTokens)],
      ['Read time', stats.readingMinutes + ' min'],
    ];
    cells.forEach((pair) => {
      const cell = el('div');
      const k = el('span'); k.textContent = pair[0];
      const v = el('strong'); v.textContent = pair[1];
      cell.appendChild(k); cell.appendChild(v);
      grid.appendChild(cell);
    });
    cover.appendChild(grid);
    const src = el('a', 'source');
    src.href = sourceUrl(conv) || '#';
    src.textContent = sourceUrl(conv) || '';
    cover.appendChild(src);
    d.body.appendChild(cover);

    for (const m of conv.messages) {
      const t = el('section', 'turn ' + (m.role === 'human' ? 'human' : 'ai'));
      const head = el('div', 'turn-head');
      const who = el('span', 'who');
      who.textContent = m.role === 'human' ? 'Human' : site.name;
      head.appendChild(who);
      const ts = fmtTime(m.ts);
      if (ts) { const s2 = el('span', 'ts'); s2.textContent = ts; head.appendChild(s2); }
      t.appendChild(head);
      const body = el('div', 'body');
      mdToDom(m.text, d, body);
      t.appendChild(body);
      if (m.note) {
        const n = el('p', 'note');
        n.textContent = m.note.replace(/^>\s*/, '').replace(/\*\*/g, '');
        t.appendChild(n);
      }
      d.body.appendChild(t);
    }

    const foot = el('footer', 'doc-foot');
    const left = el('span');
    left.textContent = 'Exported from ' + site.name + ' on ' +
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const right = el('span');
    right.textContent = stats.messages + ' messages · ' + fmtNum(stats.words) + ' words';
    foot.appendChild(left); foot.appendChild(right);
    d.body.appendChild(foot);

    // Wait (max 5s) for images, then print.
    await Promise.race([
      Promise.all(Array.from(d.images).map((im) => (im.complete ? 1 : new Promise((r) => { im.onload = im.onerror = r; })))),
      sleep(5000),
    ]);
    const prevTitle = document.title;
    document.title = title; // browsers use the page title as the default PDF filename
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      document.title = prevTitle;
      setTimeout(() => { if (fr.parentNode) fr.parentNode.removeChild(fr); }, 500);
    };
    w.addEventListener('afterprint', restore);
    setTimeout(restore, 180000);
    w.focus();
    w.print();
  }

  // ───────────────────────── DOM helpers ─────────────────────────
  // Scroll the chat to the top repeatedly so lazy-loaded history is rendered.
  async function loadAll(sel, setStatus) {
    const first = document.querySelector(sel);
    if (!first) return;
    let sc = first.parentElement;
    while (sc && sc !== document.documentElement &&
      !(sc.scrollHeight > sc.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) {
      sc = sc.parentElement;
    }
    sc = sc && sc !== document.documentElement ? sc : document.scrollingElement;
    let last = -1, stable = 0;
    for (let i = 0; i < 80 && stable < 3; i++) {
      sc.scrollTop = 0;
      await sleep(700);
      const n = document.querySelectorAll(sel).length;
      setStatus('Loading older messages… (' + n + ' found)');
      if (n === last) stable++; else { stable = 0; last = n; }
    }
    sc.scrollTop = sc.scrollHeight;
    await sleep(300);
  }

  // Heuristic for sites with obfuscated class names: find the message list by
  // locating the lowest ancestor of the assistant blocks that also has a
  // non-assistant sibling with text (the user turns).
  function turnsByAssistant(sel, userTextFn) {
    const isA = (k) => k.matches(sel) || !!k.querySelector(sel);
    const first = document.querySelector(sel);
    if (!first) return [];
    let p = first.parentElement;
    while (p && p !== document.body &&
      !Array.from(p.children).some((k) => !isA(k) && txt(k).trim())) {
      p = p.parentElement;
    }
    if (!p) return [];
    const out = [];
    for (const k of Array.from(p.children)) {
      if (isA(k)) {
        const blocks = Array.from(k.matches(sel) ? [k] : k.querySelectorAll(sel))
          .filter((b) => !b.closest('.ds-think-content, [class*="think"]'));
        const text = blocks.map(toMd).filter(Boolean).join('\n\n');
        if (text) out.push({ role: 'assistant', text });
      } else if (txt(k).trim()) {
        out.push({ role: 'human', text: userTextFn ? userTextFn(k) : toMd(k) });
      }
    }
    return out;
  }

  function cleanTitle(t, suffixRe) {
    t = (t || '').replace(suffixRe, '').trim();
    return t && !/^(new chat|chat|conversation|google gemini|gemini|grok|deepseek)$/i.test(t) ? t : '';
  }

  // ───────────────────────── Site adapters ─────────────────────────
  async function claude() {
    const id = (location.pathname.match(UUID_RE) || [])[0];
    const org = (document.cookie.match(/lastActiveOrg=([^;]+)/) || [])[1];
    if (!id) throw new Error('Open a specific Claude conversation first.');
    if (!org) throw new Error("Couldn't read your Claude session (lastActiveOrg cookie missing) — are you signed in?");
    const r = await fetch('/api/organizations/' + org + '/chat_conversations/' + id +
      '?tree=true&rendering_mode=messages&render_all_tools=true', { credentials: 'include' });
    if (!r.ok) {
      throw new Error('Claude API request failed (HTTP ' + r.status + ')' +
        (r.status === 401 || r.status === 403 ? ' — your session may have expired; reload and sign in.' : '.'));
    }
    const d = await r.json();
    if (!d || !Array.isArray(d.chat_messages)) throw new Error('Unexpected Claude API response (endpoint may have changed).');

    // Follow the visible branch: leaf -> parents, reversed.
    const by = new Map(d.chat_messages.map((m) => [m.uuid, m]));
    let ordered = null;
    if (d.current_leaf_message_uuid && by.has(d.current_leaf_message_uuid)) {
      const path = [], seen = new Set();
      let cur = by.get(d.current_leaf_message_uuid);
      while (cur && !seen.has(cur.uuid)) {
        seen.add(cur.uuid); path.push(cur);
        cur = cur.parent_message_uuid ? by.get(cur.parent_message_uuid) : null;
      }
      ordered = path.reverse();
    }
    if (!ordered) {
      warn('Could not resolve the current branch; using index order.');
      ordered = d.chat_messages.slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    }

    // Artifacts: fold create/update/rewrite into a final state, render once.
    const arts = new Map();
    for (const m of ordered) for (const b of m.content || []) {
      if (b.type !== 'tool_use' || b.name !== 'artifacts') continue;
      const i = b.input || {}, id2 = i.id || '_';
      const a = arts.get(id2) || { content: '' };
      arts.set(id2, a);
      if (i.command === 'update') {
        if (typeof i.old_str === 'string' && typeof i.new_str === 'string') {
          if (a.content.indexOf(i.old_str) === -1) warn('Artifact "' + (a.title || id2) + '": an update could not be applied.');
          else a.content = a.content.replace(i.old_str, () => i.new_str);
        }
      } else if (typeof i.content === 'string') a.content = i.content;
      ['title', 'type', 'language'].forEach((k) => { if (i[k]) a[k] = i[k]; });
      a.last = i.version_uuid;
    }
    const ART_LANG = { 'application/vnd.ant.react': 'jsx', 'text/html': 'html', 'image/svg+xml': 'svg',
      'application/vnd.ant.mermaid': 'mermaid', 'text/markdown': 'markdown' };
    const fenced = (label, src, lang) => {
      const f = fenceFor(src);
      return '**' + label + '**\n\n' + f + (lang || '') + '\n' + src + '\n' + f;
    };
    const tool = (b) => {
      const i = b.input || {};
      if (b.name === 'artifacts') {
        const a = arts.get(i.id || '_');
        if (!a || i.version_uuid !== a.last || !a.content) return '';
        return fenced('Artifact: ' + (a.title || 'untitled'), a.content, ART_LANG[a.type] || a.language || '');
      }
      if (b.name === 'create_file' && i.file_text) {
        const f = String(i.path || 'file').split('/').pop();
        return fenced('File: ' + f, i.file_text, f.includes('.') ? f.split('.').pop() : '');
      }
      if (/show_widget$/.test(b.name || '') && i.widget_code) return fenced('Widget: ' + (i.title || 'untitled'), i.widget_code, 'html');
      return '';
    };
    const attach = (m) => {
      const out = [];
      (m.files || []).forEach((f) => {
        const n = f.file_name || 'file';
        const u = abs(f.preview_url || (f.preview_asset && f.preview_asset.url) || (f.document_asset && f.document_asset.url));
        out.push(f.file_kind === 'image' && u ? '**Attachment: ' + n + '**\n\n![' + n + '](' + u + ')'
          : '**Attachment: ' + n + (f.file_kind ? ' · ' + f.file_kind : '') + '**');
      });
      (m.attachments || []).forEach((a) => {
        const lines = ['**Attachment: ' + (a.file_name || a.name || 'attachment') + '**'];
        if (typeof a.extracted_content === 'string' && a.extracted_content.trim()) {
          lines.push('');
          a.extracted_content.trim().split('\n').forEach((l) => lines.push(l));
        }
        out.push(lines.map((l) => (l ? '> ' + l : '>')).join('\n'));
      });
      return out.join('\n\n');
    };

    const messages = [];
    for (const m of ordered) {
      const parts = [];
      for (const b of m.content || []) {
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text.trim());
        else if (b.type === 'tool_use') parts.push(tool(b));
      }
      const text = [attach(m)].concat(parts).filter(Boolean).join('\n\n').trim();
      if (!text) continue;
      let note = '';
      if (m.truncated) note = '> **Truncated:** this message was truncated in the source data.';
      else if (m.stop_reason === 'user_canceled') note = '> **Interrupted:** this response was stopped before Claude finished.';
      messages.push({ role: m.sender === 'human' ? 'human' : 'assistant', text, ts: m.created_at, note });
    }
    return { title: (d.name || '').trim() === 'New conversation' ? '' : (d.name || '').trim(), model: d.model, messages };
  }

  async function chatgpt() {
    const id = (location.pathname.match(UUID_RE) || [])[0];
    if (!id) throw new Error('Open a specific ChatGPT conversation first.');
    try {
      const s = await (await fetch('/api/auth/session', { credentials: 'include' })).json();
      if (!s || !s.accessToken) throw new Error('no access token');
      const headers = { Authorization: 'Bearer ' + s.accessToken };
      const did = (document.cookie.match(/oai-did=([^;]+)/) || [])[1];
      if (did) headers['oai-device-id'] = did;
      const r = await fetch('/backend-api/conversation/' + id, { credentials: 'include', headers });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (!d.mapping) throw new Error('unexpected response');

      const path = [], seen = new Set();
      let cur = d.current_node;
      while (cur && d.mapping[cur] && !seen.has(cur)) { seen.add(cur); path.push(d.mapping[cur]); cur = d.mapping[cur].parent; }
      path.reverse();

      const messages = [];
      let model = '';
      for (const node of path) {
        const m = node.message;
        if (!m || !m.author) continue;
        const role = m.author.role;
        if (role !== 'user' && role !== 'assistant') continue;
        if (m.metadata && m.metadata.is_visually_hidden_from_conversation) continue;
        if (m.recipient && m.recipient !== 'all') continue; // tool calls
        const c = m.content || {};
        if (c.content_type !== 'text' && c.content_type !== 'multimodal_text') continue;
        let text = (c.parts || []).map((p) => {
          if (typeof p === 'string') return p;
          if (p && p.content_type === 'image_asset_pointer') return '[image]';
          return '';
        }).filter(Boolean).join('\n\n');
        text = text.replace(/\ue200[^\ue201]*\ue201/g, '').trim(); // strip citation markers
        if (!text) continue;
        if (role === 'assistant' && m.metadata && m.metadata.model_slug) model = m.metadata.model_slug;
        const prev = messages[messages.length - 1];
        const r2 = role === 'user' ? 'human' : 'assistant';
        if (prev && prev.role === r2 && r2 === 'assistant') prev.text += '\n\n' + text;
        else messages.push({ role: r2, text, ts: m.create_time ? new Date(m.create_time * 1000).toISOString() : null });
      }
      if (!messages.length) throw new Error('no messages parsed');
      return { title: d.title || '', model, messages };
    } catch (e) {
      warn('ChatGPT API route failed (' + e.message + '); falling back to page scraping.');
    }
    const messages = Array.from(document.querySelectorAll('[data-message-author-role]')).map((el) => {
      const role = el.getAttribute('data-message-author-role') === 'user' ? 'human' : 'assistant';
      const body = role === 'human' ? (el.querySelector('.whitespace-pre-wrap') || el) : (el.querySelector('.markdown') || el);
      return { role, text: role === 'human' ? txt(body).trim() : toMd(body) };
    }).filter((m) => m.text);
    return { title: cleanTitle(document.title, /\s*[|-]\s*ChatGPT\s*$/i), messages };
  }

  async function gemini(setStatus) {
    await loadAll('user-query, model-response', setStatus);
    const messages = [];
    document.querySelectorAll('user-query, model-response').forEach((el) => {
      if (el.tagName.toLowerCase() === 'user-query') {
        const q = el.querySelector('.query-text') || el;
        const text = txt(q).replace(/^You said\s*/i, '').trim();
        if (text) messages.push({ role: 'human', text });
      } else {
        let blocks = Array.from(el.querySelectorAll('message-content')).filter((b) => !b.closest('model-thoughts'));
        if (!blocks.length) blocks = [el];
        const text = blocks.map(toMd).filter(Boolean).join('\n\n').replace(/^Gemini said\s*/i, '');
        if (text) messages.push({ role: 'assistant', text });
      }
    });
    return { title: cleanTitle(document.title, /\s*[|-]\s*Google Gemini\s*$/i), messages };
  }

  async function deepseek() {
    const id = (location.pathname.match(/\/s\/([0-9a-f-]{20,})/i) || [])[1];
    try {
      if (!id) throw new Error('no session id in URL');
      let tok = '';
      try { tok = JSON.parse(localStorage.getItem('userToken')).value; } catch (e) { /* ignore */ }
      if (!tok) throw new Error('no token');
      const r = await fetch('/api/v0/chat/history_messages?chat_session_id=' + id,
        { credentials: 'include', headers: { Authorization: 'Bearer ' + tok } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const biz = j && j.data && j.data.biz_data;
      const list = biz && biz.chat_messages;
      if (!Array.isArray(list)) throw new Error('unexpected response');
      const messages = [];
      for (const m of list) {
        const role = /user/i.test(m.role || '') ? 'human' : 'assistant';
        let text = '';
        if (Array.isArray(m.fragments) && m.fragments.length) {
          text = m.fragments.filter((f) => !/THINK|SEARCH/i.test(f.type || '')).map((f) => f.content || '').join('\n\n');
        } else text = m.content || '';
        text = String(text).trim();
        const ts = m.inserted_at ? new Date(m.inserted_at * (m.inserted_at < 1e12 ? 1000 : 1)).toISOString() : null;
        if (text) messages.push({ role, text, ts });
      }
      if (!messages.length) throw new Error('no messages parsed');
      return { title: (biz.chat_session && biz.chat_session.title) || '', messages };
    } catch (e) {
      warn('DeepSeek API route failed (' + e.message + '); falling back to page scraping.');
    }
    const messages = turnsByAssistant('.ds-markdown');
    return { title: cleanTitle(document.title, /\s*[|-]\s*DeepSeek\s*$/i), messages };
  }

  async function grok() {
    const nodes = Array.from(document.querySelectorAll('[id^="response-"]'));
    let messages = nodes.map((el) => {
      const isUser = /\bitems-end\b/.test(el.className);
      const body = isUser
        ? (el.querySelector('.message-bubble') || el)
        : (el.querySelector('.response-content-markdown') || el.querySelector('.message-bubble') || el);
      return { role: isUser ? 'human' : 'assistant', text: isUser ? txt(body).trim() : toMd(body) };
    }).filter((m) => m.text);
    if (!messages.length) {
      warn('Grok message selectors not found; trying a generic heuristic.');
      messages = turnsByAssistant('.response-content-markdown');
    }
    return { title: cleanTitle(document.title, /\s*[|-]\s*Grok\s*$/i), messages };
  }

  const SITES = [
    { name: 'Claude', match: /(^|\.)claude\.ai$/, run: claude },
    { name: 'ChatGPT', match: /(^|\.)(chatgpt\.com|chat\.openai\.com)$/, run: chatgpt },
    { name: 'Gemini', match: /^gemini\.google\.com$/, run: gemini },
    { name: 'DeepSeek', match: /(^|\.)deepseek\.com$/, run: deepseek },
    { name: 'Grok', match: /(^|\.)grok\.com$|^x\.com$/, run: grok },
  ];

  // ───────────────────────── Download & UI ─────────────────────────
  function download(content, filename, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime || 'text/markdown;charset=utf-8' }));
    try {
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('Clipboard unavailable'));
    });
  }

  // Status card (textContent only — safe on Trusted-Types sites such as Gemini).
  if (typeof window.__uceDispose === 'function') { try { window.__uceDispose(); } catch (e) { /* ignore */ } }
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483647;width:306px;background:#0f172a;color:#e6e9f2;' +
    'border:1px solid #2a3550;border-radius:11px;font:12px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;' +
    'box-shadow:0 14px 38px rgba(0,0,0,.4);padding:13px 15px;overflow-wrap:anywhere';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight:700;font-size:12.5px;letter-spacing:.01em;margin-bottom:3px';
  const metaEl = document.createElement('div');
  metaEl.style.cssText = 'color:#9aa6bd;font-size:11px;margin-bottom:0';
  const bar = document.createElement('div');
  bar.style.cssText = 'height:3px;border-radius:2px;background:#26304a;margin:9px 0 0;overflow:hidden;display:none';
  const barFill = document.createElement('div');
  barFill.style.cssText = 'height:100%;width:38%;background:#3b82f6;border-radius:2px;transition:width .3s';
  bar.appendChild(barFill);
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:none;flex-wrap:wrap;gap:6px;margin-top:10px';
  const footEl = document.createElement('div');
  footEl.style.cssText = 'display:none;margin-top:10px;padding-top:9px;border-top:1px solid #223050;gap:4px;flex-direction:column';
  box.appendChild(titleEl); box.appendChild(metaEl); box.appendChild(bar); box.appendChild(btnRow); box.appendChild(footEl);

  let timer = null, dismissMs = 0;
  const close = () => { clearTimeout(timer); if (box.parentNode) box.parentNode.removeChild(box); };
  window.__uceDispose = close;
  box.addEventListener('click', (e) => { if (e.target === box || e.target === titleEl || e.target === metaEl) close(); });
  box.addEventListener('mouseenter', () => clearTimeout(timer));
  box.addEventListener('mouseleave', () => { if (dismissMs) timer = setTimeout(close, dismissMs); });

  const TONES = { working: '#1d4ed8', ok: '#15803d', warn: '#b45309', error: '#b91c1c' };
  function setStatus(text, tone, autoMs) {
    const parts = String(text).split(' — ');
    titleEl.textContent = parts[0];
    metaEl.textContent = parts.slice(1).join(' — ');
    metaEl.style.display = parts.length > 1 ? 'block' : 'none';
    const colour = TONES[tone] || TONES.working;
    box.style.borderColor = colour;
    titleEl.style.color = '#f4f6fb';
    barFill.style.background = colour;
    bar.style.display = tone === 'working' ? 'block' : 'none';
    if (tone !== 'working') { btnRow.style.display = 'none'; footEl.style.display = 'none'; }
    clearTimeout(timer);
    dismissMs = autoMs || 0;
    if (autoMs) timer = setTimeout(close, autoMs);
  }

  function addButton(label, primary, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:600 11px/1 -apple-system,"Segoe UI",Roboto,sans-serif;padding:7px 10px;border-radius:7px;cursor:pointer;' +
      (primary
        ? 'background:#2563eb;border:1px solid #3b82f6;color:#fff'
        : 'background:#182338;border:1px solid #2f3d5c;color:#dbe3f3');
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    btnRow.appendChild(b);
    return b;
  }

  function showLinks() {
    footEl.style.display = 'flex';
    if (footEl.childNodes.length) return;
    [['⭐ Star the project — github.com/mrwhoim', 'https://github.com/mrwhoim'],
      ['𝕏 Follow on X — x.com/v_shal_', 'https://x.com/v_shal_']].forEach((l) => {
      const a = document.createElement('a');
      a.href = l[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = l[0];
      a.style.cssText = 'color:#8fb4ff;font-size:11px;text-decoration:none';
      a.addEventListener('click', (e) => e.stopPropagation());
      footEl.appendChild(a);
    });
  }

  // Post-export toolbar: every format stays one click away, whichever
  // bookmarklet was used to start the export.
  function showActions(conv, site, base) {
    btnRow.textContent = '';
    btnRow.style.display = 'flex';
    const flash = (msg) => { metaEl.textContent = msg; metaEl.style.display = 'block'; };
    addButton('Markdown', true, () => {
      download(buildMd(conv, site), base + '.md');
      flash('Saved ' + base + '.md');
    });
    addButton('JSON', false, () => {
      download(buildJson(conv, site), base + '.json', 'application/json;charset=utf-8');
      flash('Saved ' + base + '.json');
    });
    addButton('PDF', false, () => {
      flash('Opening the print dialog…');
      printPdf(conv, site).catch((e) => flash('PDF failed: ' + e.message));
    });
    addButton('Copy', false, () => {
      copyText(buildMd(conv, site)).then(() => flash('Markdown copied to the clipboard.'),
        () => flash('Clipboard blocked — use the Markdown button instead.'));
    });
    showLinks();
  }

  document.body.appendChild(box);
  setStatus('Exporter ready', 'working');
  bar.style.display = 'none';

  // ───────────────────────── Entry point ─────────────────────────
  async function run() {
    const host = location.hostname.replace(/^www\./, '');
    const site = SITES.find((s) => s.match.test(host));
    if (!site) { setStatus('This page is not a supported chat site — ' + host, 'error', 9000); return; }
    try {
      setStatus('Reading the conversation — ' + site.name, 'working');
      bar.style.display = 'block';
      barFill.style.width = '38%';
      const conv = await site.run(setStatus);
      barFill.style.width = '82%';
      if (!conv.messages.length) {
        throw new Error('No messages found. Open a conversation first (or the page layout changed).');
      }
      if (!conv.title) {
        const f = conv.messages.find((m) => m.role === 'human');
        conv.title = f ? f.text.replace(/\s+/g, ' ').slice(0, 60) : '';
      }
      // Clean every turn once, so Markdown, JSON, clipboard and PDF agree.
      conv.messages = conv.messages
        .map((m) => Object.assign({}, m, { text: normalizeMarkdown(m.text) }))
        .filter((m) => m.text);
      conv.source = location.origin + location.pathname;
      conv.stats = summarize(conv);

      const base = slug(conv.title) || site.name.toLowerCase() + '-conversation';
      const size = fmtNum(conv.stats.words) + ' words · ~' + fmtNum(conv.stats.approxTokens) + ' tokens';
      const warnNote = warnings.length
        ? ' (' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's') + ' — see console)'
        : '';

      if (MODE === 'pdf') {
        setStatus('✅ ' + conv.stats.messages + ' messages ready' + warnNote + ' — choose “Save as PDF”',
          'ok', 0);
        barFill.style.width = '100%';
        bar.style.display = 'none';
        showActions(conv, site, base);
        await sleep(220); // let the card paint before the (blocking) print dialog opens
        await printPdf(conv, site);
        dismissMs = 20000;
        timer = setTimeout(close, dismissMs);
      } else {
        download(buildMd(conv, site), base + '.md');
        setStatus('✅ Exported ' + conv.stats.messages + ' messages — ' + base + '.md · ' + size + warnNote, 'ok', 0);
        barFill.style.width = '100%';
        bar.style.display = 'none';
        showActions(conv, site, base);
        dismissMs = 20000;
        timer = setTimeout(close, dismissMs);
      }
    } catch (e) {
      console.error('[chat-exporter]', e);
      setStatus('Export failed — ' + e.message, 'error', 11000);
    }
  }

  window.__UCE = api;
  if (window.__UCE_TEST || window.__UCE_NO_RUN) { window.__UCE_TEST = { toMd: toMd, mdToDom: mdToDom, normalizeMarkdown: normalizeMarkdown }; return; }
  run();
})();
