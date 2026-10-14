# Universal AI Chat Exporter

Export any conversation from **Claude, ChatGPT, Gemini, DeepSeek and Grok** to a clean **Markdown** or **PDF** file with a single click, using a browser bookmarklet.

No extension to install, no account, no server. It runs entirely inside the tab you are already looking at.

---

## Table of contents

- [Features](#features)
- [Supported sites](#supported-sites)
- [Quick start](#quick-start)
- [Installing the bookmarklet in your browser](#installing-the-bookmarklet-in-your-browser)
  - [Google Chrome](#google-chrome)
  - [Microsoft Edge](#microsoft-edge)
  - [Mozilla Firefox](#mozilla-firefox)
  - [Safari (macOS)](#safari-macos)
  - [Brave, Opera, Vivaldi and other Chromium browsers](#brave-opera-vivaldi-and-other-chromium-browsers)
  - [Mobile browsers](#mobile-browsers)
- [Using it](#using-it)
- [Output format](#output-format)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Privacy and security](#privacy-and-security)
- [Project structure](#project-structure)
- [Building from source](#building-from-source)
- [Adding support for another site](#adding-support-for-another-site)
- [Credits](#credits)
- [License](#license)
- [Support the project](#support-the-project)

---

## Features

- **One bookmarklet for five platforms.** It detects which site you are on and uses the right method.
- **Markdown export** with YAML front matter, ready for Obsidian, Notion imports, note apps, or RAG pipelines.
- **PDF export** with a clean A4 layout. All languages and emoji are supported (Hindi, Chinese, Arabic, and so on).
- **Faithful content.** Code blocks keep their language, and tables, lists, links and math (as LaTeX) are preserved.
- **Follows the visible branch.** If you regenerated a reply, you get the version shown on screen.
- **Claude extras.** Artifacts (final version), created files, widgets and text attachments are included.
- **Auto-loads old messages** on Gemini by scrolling up before exporting.
- **Private by design.** Nothing is uploaded anywhere; see [Privacy and security](#privacy-and-security).

## Supported sites

| Platform | Domain | How the chat is read | Reliability |
|---|---|---|---|
| Claude | `claude.ai` | Site's own internal API (exact Markdown source) | High |
| ChatGPT | `chatgpt.com`, `chat.openai.com` | Internal API, falls back to page scraping | Medium-high |
| DeepSeek | `chat.deepseek.com` | Internal API, falls back to page scraping | Medium |
| Gemini | `gemini.google.com` | Page scraping (auto-scrolls to load history) | Medium |
| Grok | `grok.com` | Page scraping | Medium |

> These sites change their internal APIs and page layouts without notice. If an export stops working on one of them, see [Troubleshooting](#troubleshooting) and [Adding support for another site](#adding-support-for-another-site). Each site has its own small adapter function, so fixes are usually quick.

## Quick start

1. Download this repository (green **Code** button, then **Download ZIP**) or clone it.
2. Pick a bookmarklet:
   - `bookmarklet-md.txt` exports **Markdown**.
   - `bookmarklet-pdf.txt` exports **PDF**.
3. Add it as a bookmark (see the [browser guides](#installing-the-bookmarklet-in-your-browser) below).
4. Open a chat on any supported site and click the bookmark.

**Fastest method (desktop):** open `install-bookmarklet.html` in your browser and drag the **Export Chat → MD** and **Export Chat → PDF** buttons onto your bookmarks bar. If dragging doesn't work in your browser, use the manual steps below.

---

## Installing the bookmarklet in your browser

A bookmarklet is a normal bookmark whose address is JavaScript code instead of a web page. The method is always the same:

1. Create **any** bookmark.
2. Edit it: set the **Name** (for example `Export Chat → MD`) and replace the **URL** with the **entire contents** of `bookmarklet-md.txt` (or `bookmarklet-pdf.txt`).
3. Save.

Do this twice if you want both the Markdown and the PDF version.

> **Copy the whole file.** The code is one very long line that starts with `javascript:`. Open the `.txt` file, press `Ctrl+A` (or `Cmd+A`), then `Ctrl+C` (or `Cmd+C`). If you leave out even the beginning or end, the bookmark will do nothing.
>
> **Do not paste it into the address bar.** Browsers strip the `javascript:` prefix when you paste into the address bar. Paste only into the bookmark's **URL** field.

### Google Chrome

1. Open any web page and press `Ctrl+D` (`Cmd+D` on macOS) to save a bookmark. In the popup, set **Name** to `Export Chat → MD` and click **Done**.
2. Click the three-dot menu (⋮) at the top right, go to **Bookmarks and lists**, then find your new bookmark.
   - Alternatively, press `Ctrl+Shift+O` (`Cmd+Option+B` on macOS) to open the **Bookmark manager**.
3. Right-click the bookmark and choose **Edit** (in the Bookmark manager, use the three dots next to it, then **Edit**).
4. Change the **Name** if you want, and replace the **URL** with the entire contents of `bookmarklet-md.txt`.
5. Click **Save**.
6. Optional: show the bookmarks bar with `Ctrl+Shift+B` so the button is always one click away.
7. Repeat with `bookmarklet-pdf.txt` for the PDF version.

### Microsoft Edge

1. Press `Ctrl+D` on any page and click **Done** to save a favorite.
2. Open the menu (⋯), go to **Favorites**, and find the new entry. Alternatively, press `Ctrl+Shift+O`.
3. Right-click it, choose **Edit** (or **Edit favorite**), and paste the contents of `bookmarklet-md.txt` into the **URL** field.
4. Save. Show the favorites bar with `Ctrl+Shift+B` if you like.

### Mozilla Firefox

1. Press `Ctrl+D` (`Cmd+D` on macOS), set the **Name**, and choose **Bookmarks Toolbar** as the folder. Click **Save**.
2. Show the toolbar if it's hidden: right-click the toolbar area and tick **Bookmarks Toolbar** (or use `Ctrl+Shift+B`).
3. Right-click the new bookmark on the toolbar and choose **Edit Bookmark…**.
4. Replace the **URL** field with the entire contents of `bookmarklet-md.txt` and click **Save**.
   - You can also open **Bookmarks → Manage Bookmarks** (`Ctrl+Shift+O`), select the bookmark, and edit the **Location** field.

### Safari (macOS)

1. Show the Favorites bar: **View → Show Favorites Bar**.
2. Choose **Bookmarks → Add Bookmark…**, set the name, choose **Favorites**, and click **Add**.
3. Open **Bookmarks → Edit Bookmarks** (`Option+Cmd+B`).
4. Right-click the bookmark you just added and choose **Edit Address**.
5. Paste the contents of `bookmarklet-md.txt` and press `Return`.

### Brave, Opera, Vivaldi and other Chromium browsers

These work almost exactly like Chrome:

1. Bookmark any page with `Ctrl+D` (`Cmd+D` on macOS).
2. Open the bookmark manager (`Ctrl+Shift+O` in Brave, Opera and Vivaldi) or the bookmarks panel.
3. Right-click the bookmark, choose **Edit**, and paste the bookmarklet code into the **URL / Address** field.
4. Save.

### Mobile browsers

Mobile support depends heavily on the browser, and this project is **desktop-first**. If you want to try:

- **Chrome for Android:** create a bookmark, edit it, and paste the code as the URL. To run it, type the bookmark's name in the address bar and pick it from the suggestions (tapping it from the bookmarks list does not run it).
- **Safari on iOS:** bookmark any page, edit the bookmark's address to the bookmarklet code, then open it from **Favorites** or the bookmarks list while on the chat page. Downloads and printing on iOS behave differently, so the PDF version may not behave like the desktop one.
- The official Claude, ChatGPT, Gemini, DeepSeek and Grok **apps** are not supported, only their websites in a browser.

---

## Using it

1. Open a **specific conversation** on a supported site (the page should show an actual chat, not the "new chat" screen).
2. Click the bookmark.
3. A small status box appears in the top-right corner:
   - **Blue:** working.
   - **Green ✅:** done.
   - **Orange ⚠️:** done, but with warnings (open the browser console for details).
   - **Red:** an error, with a short explanation.

**Markdown bookmark:** a `.md` file downloads automatically, named after the chat title.

**PDF bookmark:** your browser's print dialog opens with the conversation laid out for print. Choose **Save as PDF** as the destination. For the cleanest page, turn off **Headers and footers** in the print dialog options.

After a successful export, the status box also shows links to the author's GitHub and X profiles. It disappears on its own, or you can click it to close it.

## Output format

### Markdown

```markdown
---
title: "My conversation title"
source: "https://claude.ai/chat/..."
platform: "Claude"
model: "claude-..."
exported: 2026-10-14
---

# Human — Oct 14, 2026, 10:32 AM

How do I reverse a list in Python?

# Claude — Oct 14, 2026, 10:32 AM

You can use `reversed()` or slicing...
```

- Each turn is an H1 heading, so headings inside replies nest underneath it.
- The front matter works as properties in Obsidian and as metadata when chunking for RAG.
- Interrupted or truncated Claude responses are marked with a note.

### PDF

An A4 document with a title and metadata header, shaded Human turns, formatted code blocks with language labels, tables, lists, block quotes and clickable links. Math is printed as its LaTeX source (for example `E=mc^2`).

## How it works

Everything lives in one script, `universal-chat-exporter.js`.

1. **Detect the site** from `location.hostname`.
2. **Fetch the conversation:**
   - **Claude:** a same-origin request to the same internal endpoint the app itself uses, which returns every message's original Markdown. The script follows the current branch from the latest message back to the first.
   - **ChatGPT:** reads the session token from the site, then requests the conversation and walks its message tree (falls back to scraping the page if the request fails).
   - **DeepSeek:** requests the chat history using the token stored by the site (falls back to scraping).
   - **Gemini and Grok:** read the rendered page. A built-in HTML-to-Markdown converter handles headings, lists, tables, code blocks (with language), links, images and math. For Gemini, the script first scrolls to the top repeatedly so that older messages load.
3. **Build the output.**
   - **Markdown mode** assembles the front matter and turns, then downloads a file through a temporary Blob link.
   - **PDF mode** renders the Markdown into a hidden, same-origin frame using a small Markdown-to-DOM renderer, then opens the browser's print dialog. This keeps text selectable and supports every language, and it needs no external PDF library (which sites' security policies would block in a bookmarklet).
4. **Show status** in a small box. The script only uses `textContent` and DOM APIs (never `innerHTML`), so it also works on sites with strict Trusted Types policies, such as Gemini.

The PDF bookmarklet is the same code with `window.__UCE_MODE="pdf";` placed in front.

## Troubleshooting

| Problem | What to try |
|---|---|
| Clicking the bookmark does nothing | The URL probably lost its `javascript:` start or its end. Re-copy the **entire** `.txt` file and paste it into the bookmark's **URL** field (not the address bar). |
| "Open a specific conversation first" | You're on the home or "new chat" page. Open an existing chat so the URL contains the chat ID. |
| "Unsupported site" | You're on a domain that isn't in the [supported list](#supported-sites). |
| Orange box with warnings | The export finished, but a fallback was used (for example scraping instead of the API). Check the console (`F12`, then **Console**) and review the file. |
| Missing or mangled messages on Gemini, Grok or DeepSeek | The site probably changed its layout. See [Adding support for another site](#adding-support-for-another-site), or open an issue with the console output and a small HTML snippet of one message. |
| Long Gemini chats take a while | The script scrolls to load older messages. Wait for the status box to turn green. |
| PDF dialog doesn't appear | Check that your browser isn't blocking printing, then try again. Pop-up blockers don't affect it, since it uses a hidden frame. |
| File doesn't download | Check that your browser isn't blocking downloads from the site (look for an icon in the address bar). |
| `Claude API request failed (401/403)` | Your session expired. Reload the page, sign in again, and retry. |
| The bookmark won't save a very long URL | Some browsers limit bookmark length. Use Chrome, Edge, Firefox or Safari on desktop, which accept it. |

When reporting a bug, please include the site, your browser, the exact status-box message, and anything the console printed.

## Privacy and security

- **Your chats stay on your device.** The script only makes requests to the **same site you're on** (to read your own conversation, using your existing login) and creates the file locally. It sends nothing to any third party, and there is no analytics or tracking.
- **The links shown after export are plain links.** They only open if you click them.
- **A bookmarklet runs with full access to the page you're on.** That is how it can read your chat, and it also means you should **only install bookmarklets from sources you trust**. Never paste bookmarklet code from strangers. This one is open source: read `universal-chat-exporter.js` before you use it, and compare it with the minified `.txt` files if you build them yourself.
- Exported files contain your full conversation, including any sensitive text you typed. Store and share them accordingly.

## Project structure

```
.
├── README.md                     This file
├── universal-chat-exporter.js    Readable, commented source (edit this one)
├── bookmarklet-md.txt            Minified, ready-to-paste Markdown bookmarklet
├── bookmarklet-pdf.txt           Minified, ready-to-paste PDF bookmarklet
└── install-bookmarklet.html      Drag-and-drop install page for desktop browsers
```

Optional: you can serve `install-bookmarklet.html` through **GitHub Pages** so that people can drag the buttons straight from a web page.

## Building from source

If you change `universal-chat-exporter.js`, rebuild the bookmarklets (needs [Node.js](https://nodejs.org)):

```bash
# 1. Minify
npx terser universal-chat-exporter.js -c -m -o min.js

# 2. Wrap as bookmarklets (Markdown and PDF)
node -e 'const fs=require("fs");const m=fs.readFileSync("min.js","utf8").trim();fs.writeFileSync("bookmarklet-md.txt","javascript:"+encodeURIComponent(m));fs.writeFileSync("bookmarklet-pdf.txt","javascript:"+encodeURIComponent("window.__UCE_MODE=\"pdf\";"+m))'
```

You can also paste the readable source into the browser console on a chat page to test quickly without rebuilding.

## Adding support for another site

Each site has a small adapter function in `universal-chat-exporter.js`. An adapter returns:

```js
{
  title: 'Conversation title',            // may be empty
  model: 'optional-model-name',           // optional
  messages: [
    { role: 'human' | 'assistant', text: 'markdown text', ts: 'ISO date (optional)' }
  ]
}
```

To add a site:

1. Write an `async function mysite(setStatus) { ... }` that returns the object above. Use `toMd(element)` to convert rendered HTML into Markdown, `loadAll(selector, setStatus)` if the page lazy-loads history, or `turnsByAssistant(selector)` as a shortcut for sites with obfuscated class names.
2. Add an entry to the `SITES` array:

   ```js
   { name: 'MySite', match: /(^|\.)mysite\.com$/, run: mysite },
   ```

3. Rebuild the bookmarklets (see above) and test on a few chats, including long ones with code blocks and tables.

Pull requests that fix a broken selector or API shape are very welcome.

## Credits

This project was inspired by the Claude-only exporter [`claude-chat-exporter`](https://github.com/agarwalvishal/claude-chat-exporter) by **agarwalvishal**, whose approach of reading the conversation from Claude's internal API instead of scraping the page is reused here for Claude. This version extends the idea to more platforms and adds PDF export.

This is an independent, unofficial tool. It is not affiliated with Anthropic, OpenAI, Google, DeepSeek or xAI.

## License

Add your license here (for example [MIT](https://choosealicense.com/licenses/mit/)) by creating a `LICENSE` file in the repository.

## Support the project

If this saved you time:

- ⭐ **Star the project on GitHub:** [github.com/mrwhoim](https://github.com/mrwhoim)
- 𝕏 **Follow on X:** [x.com/v_shal_](https://x.com/v_shal_)
#
