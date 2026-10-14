// Universal AI Chat Exporter — Claude, ChatGPT, Gemini, DeepSeek, Grok -> Markdown.
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
(function () {
  'use strict';

  const host = location.hostname.replace(/^www\./, '');
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const warnings = [];
  const warn = (m) => { console.warn('[chat-exporter] ' + m); warnings.push(m); };
  const txt = (e) => (e.innerText !== undefined ? e.innerText : e.textContent) || '';
  const abs = (u) => { try { return u ? new URL(u, location.origin).href : null; } catch (e) { return null; } };
  // 'md' (default) downloads a Markdown file; 'pdf' opens the print dialog -> Save as PDF.
  // The PDF bookmarklet sets window.__UCE_MODE = 'pdf' before running this script.
  const MODE = window.__UCE_MODE === 'pdf' ? 'pdf' : 'md';
  try { delete window.__UCE_MODE; } catch (e) { window.__UCE_MODE = undefined; }

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

  // ───────────────────────── Output ─────────────────────────
  const fmtTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d.toLocaleString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const slug = (t) => t.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '').toLowerCase().substring(0, 100);
  const yq = (v) => '"' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  function buildMd(conv, site) {
    const fm = ['---', 'title: ' + yq(conv.title), 'source: ' + yq(location.origin + location.pathname),
      'platform: ' + yq(site.name)];
    if (conv.model) fm.push('model: ' + yq(conv.model));
    fm.push('exported: ' + new Date().toISOString().slice(0, 10), '---', '');
    let md = fm.join('\n') + '\n';
    for (const m of conv.messages) {
      const ts = fmtTime(m.ts);
      md += '# ' + (m.role === 'human' ? 'Human' : site.name) + (ts ? ' — ' + ts : '') + '\n\n' +
        m.text + (m.note ? '\n\n' + m.note : '') + '\n\n';
    }
    return md;
  }

  function download(content, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
    try {
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  }

  // ───────────────────────── PDF (print layout) ─────────────────────────
  // Small Markdown -> DOM renderer. It builds nodes with createElement/textContent
  // only (no innerHTML), so it also works on Trusted-Types sites like Gemini.
  function mdToDom(md, d, parent) {
    const el = (t, c) => { const e = d.createElement(t); if (c) e.className = c; return e; };
    const okUrl = (u) => (u && /^(https?:|mailto:)/i.test(u) ? u : null);
    const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*(?!\s)([^*\n]+?)(?<!\s)\*/g;
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
    const startsBlock = (l) => /^\s*(`{3,}|~{3,})/.test(l) || /^#{1,6}\s/.test(l) || /^\s*>/.test(l) || LIST.test(l) || HR.test(l);

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
        last = re.lastIndex;
      }
      if (last < text.length) p.appendChild(d.createTextNode(text.slice(last)));
    }

    const splitRow = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

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
        if (/^\s*\$\$\s*$/.test(line)) { // display math: keep the LaTeX source
          const buf = [];
          i++;
          while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
          i++;
          const pre = el('pre', 'math');
          pre.textContent = buf.join('\n');
          p.appendChild(pre);
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
            if (f && f.nodeName === 'P') { while (f.firstChild) li.insertBefore(f.firstChild, f); li.removeChild(f); if (li.childNodes.length && li.lastChild && li.lastChild.nodeName === 'BR') li.removeChild(li.lastChild); }
            list.appendChild(li); cur = null;
          };
          while (i < lines.length) {
            const l = lines[i], lm = l.match(LIST), ind = l.length - l.trimStart().length;
            if (lm && lm[1].length <= base) {
              if (/\d/.test(lm[2]) !== ordered && lm[1].length === base) break; // different list type -> new list
              flush(); cur = [lm[3]]; i++;
            }
            else if (!l.trim()) {
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
        // paragraph
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

  const PDF_CSS = '@page{size:A4;margin:14mm}*{box-sizing:border-box}html{color-scheme:light}' +
    'body{margin:0;color:#1f1f1f;background:#fff;font:10.5pt/1.55 -apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",Arial,sans-serif;' +
    '-webkit-print-color-adjust:exact;print-color-adjust:exact;overflow-wrap:anywhere}' +
    '.doc-title{font-size:18pt;margin:0 0 4pt}.meta{color:#666;font-size:8.5pt;margin-bottom:14pt;border-bottom:1px solid #ddd;padding-bottom:8pt}' +
    '.turn{margin:0 0 12pt;padding:8pt 10pt;border-radius:6pt;border-left:3pt solid #ccc}' +
    '.turn.human{background:#f3f1ec;border-left-color:#d97757}.turn.ai{border-left-color:#4b6fd6}' +
    '.who{font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.04em;color:#555;margin-bottom:4pt}' +
    '.body>:first-child{margin-top:0}.body>:last-child{margin-bottom:0}' +
    'p{margin:0 0 6pt}h1,h2,h3,h4,h5,h6{margin:10pt 0 4pt;line-height:1.25;break-after:avoid}' +
    'h1{font-size:15pt}h2{font-size:13pt}h3{font-size:11.5pt}h4,h5,h6{font-size:10.5pt}' +
    'ul,ol{margin:0 0 6pt;padding-left:18pt}li{margin:2pt 0}li>p{margin:0 0 3pt}' +
    'code{font:9pt/1.4 ui-monospace,Menlo,Consolas,"Courier New",monospace;background:#eceae4;padding:0 2pt;border-radius:2pt}' +
    'pre{margin:6pt 0;padding:7pt 9pt;background:#f6f6f4;border:1px solid #ddd;border-radius:4pt;white-space:pre-wrap;word-break:break-word;font:8.5pt/1.4 ui-monospace,Menlo,Consolas,monospace}' +
    'pre code{background:none;padding:0;font:inherit}pre[data-lang]::before{content:attr(data-lang);display:block;color:#888;font:bold 7.5pt sans-serif;text-transform:uppercase;margin-bottom:3pt}' +
    'pre.math{background:#fbfaf7;font-style:italic}' +
    'blockquote{margin:6pt 0;padding:2pt 10pt;border-left:3pt solid #ccc;color:#555}' +
    'table{border-collapse:collapse;margin:6pt 0;max-width:100%;font-size:9.5pt}th,td{border:1px solid #ccc;padding:3pt 6pt;text-align:left;vertical-align:top}th{background:#eee}' +
    'img{max-width:100%;height:auto;break-inside:avoid}a{color:#1a5fb4}hr{border:0;border-top:1px solid #ccc;margin:8pt 0}tr{break-inside:avoid}.note{font-style:italic;color:#8a5a00}';

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

    const h = d.createElement('h1');
    h.className = 'doc-title';
    h.textContent = title;
    d.body.appendChild(h);
    const meta = d.createElement('div');
    meta.className = 'meta';
    meta.textContent = site.name + (conv.model ? ' · ' + conv.model : '') + ' · exported ' +
      new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + location.origin + location.pathname;
    d.body.appendChild(meta);

    for (const m of conv.messages) {
      const t = d.createElement('section');
      t.className = 'turn ' + (m.role === 'human' ? 'human' : 'ai');
      const who = d.createElement('div');
      const ts = fmtTime(m.ts);
      who.className = 'who';
      who.textContent = (m.role === 'human' ? 'Human' : site.name) + (ts ? ' — ' + ts : '');
      t.appendChild(who);
      const body = d.createElement('div');
      body.className = 'body';
      mdToDom(m.text, d, body);
      t.appendChild(body);
      if (m.note) {
        const n = d.createElement('p');
        n.className = 'note';
        n.textContent = m.note.replace(/^>\s*/, '').replace(/\*\*/g, '');
        t.appendChild(n);
      }
      d.body.appendChild(t);
    }

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

  // Status box (textContent only — safe on Trusted-Types sites such as Gemini).
  if (typeof window.__uceDispose === 'function') { try { window.__uceDispose(); } catch (e) { /* ignore */ } }
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;background:#2196F3;color:#1a1a1a;' +
    'padding:10px 15px;border-radius:5px;font:12px monospace;box-shadow:0 2px 10px rgba(0,0,0,.3);' +
    'max-width:320px;overflow-wrap:anywhere;cursor:pointer';
  let timer = null, dismissMs = 0;
  const close = () => { clearTimeout(timer); if (box.parentNode) box.parentNode.removeChild(box); };
  window.__uceDispose = close;
  box.addEventListener('click', close);
  // Auto-dismiss pauses while the pointer is over the box (so the links are easy to click).
  box.addEventListener('mouseenter', () => clearTimeout(timer));
  box.addEventListener('mouseleave', () => { if (dismissMs) timer = setTimeout(close, dismissMs); });
  const setStatus = (text, color, autoMs) => {
    box.textContent = text;
    if (color) box.style.background = color;
    clearTimeout(timer);
    dismissMs = autoMs || 0;
    if (autoMs) timer = setTimeout(close, autoMs);
  };
  // Shown after a successful export.
  const addLinks = () => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.3);display:flex;flex-direction:column;gap:5px';
    [['⭐ Star the project — github.com/mrwhoim', 'https://github.com/mrwhoim'],
      ['𝕏 Follow on X — x.com/v_shal_', 'https://x.com/v_shal_']].forEach((l) => {
      const a = document.createElement('a');
      a.href = l[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = l[0];
      a.style.cssText = 'color:#1a1a1a;font-weight:600;text-decoration:underline';
      a.addEventListener('click', (e) => e.stopPropagation());
      wrap.appendChild(a);
    });
    box.appendChild(wrap);
  };
  document.body.appendChild(box);

  // Test hook (used only by the offline converter tests).
  if (window.__UCE_TEST) { window.__UCE_TEST = { toMd, mdToDom }; close(); return; }

  (async () => {
    const site = SITES.find((s) => s.match.test(host));
    if (!site) { setStatus('Unsupported site: ' + host, '#f44336', 8000); return; }
    try {
      setStatus('Exporting ' + site.name + ' chat…');
      const conv = await site.run(setStatus);
      if (!conv.messages.length) {
        throw new Error('No messages found. Open a conversation first (or the page layout changed).');
      }
      if (!conv.title) {
        const f = conv.messages.find((m) => m.role === 'human');
        conv.title = f ? f.text.replace(/\s+/g, ' ').slice(0, 60) : '';
      }
      const base = slug(conv.title) || site.name.toLowerCase() + '_conversation';
      const clean = warnings.length === 0;
      const warnNote = clean ? '' : ' (' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's') + ' — see console)';
      const color = clean ? '#4CAF50' : '#ff9800';
      if (MODE === 'pdf') {
        setStatus((clean ? '✅' : '⚠️') + ' ' + conv.messages.length + ' messages ready' + warnNote +
          '. In the print dialog choose “Save as PDF”.', color);
        addLinks();
        await sleep(200); // let the box paint before the (blocking) print dialog opens
        await printPdf(conv, site);
        dismissMs = 15000;
        timer = setTimeout(close, dismissMs);
      } else {
        const filename = base + '.md';
        download(buildMd(conv, site), filename);
        setStatus((clean ? '✅' : '⚠️') + ' Exported ' + conv.messages.length + ' messages' + warnNote + ': ' + filename,
          color, 12000);
        addLinks();
      }
    } catch (e) {
      console.error('[chat-exporter]', e);
      setStatus('Error: ' + e.message, '#f44336', 9000);
    }
  })();
})();
