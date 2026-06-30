# Installation guide (without the Chrome Web Store)

You can install this extension manually in under a minute. No store account, no
payment, works on **Chrome, Edge, Brave, Opera, and Arc** (any Chromium browser).

> Prefer to just see what it does first? Try the
> [live demo](https://temuulennibno.github.io/mongolian-grammar-checker/) — no
> install needed.

---

## Option A — Install from a release (recommended)

1. Go to the [**Releases**](https://github.com/temuulennibno/mongolian-grammar-checker/releases)
   page and download the latest **`mongolian-spell-checker-vX.Y.Z.zip`**.
2. **Unzip it.** You should get a folder containing `manifest.json` at its top
   level. Remember where this folder is (e.g. your Downloads).
3. Open your browser's extensions page:
   - Chrome / Brave / Opera: `chrome://extensions`
   - Edge: `edge://extensions`
4. Turn on **Developer mode** (toggle in the top-right on Chrome, left sidebar on Edge).
5. Click **Load unpacked** and select the **unzipped folder** (the one with
   `manifest.json` in it).
6. Done. Pin the **Үг** icon to your toolbar and open any page with a text box.

## Option B — Install from source

```bash
git clone https://github.com/temuulennibno/mongolian-spell-checker.git
cd mongolian-grammar-checker
npm install
npm run prepare-dist     # builds dist/sw.js and dist/content.js
```

Then follow steps 3–6 above, selecting the **project folder** itself.

---

## How to use it

- **Inline checking**: focus any text field (textarea, input, or a rich editor
  like Gmail), type Mongolian, and misspelled words get a **red highlight**.
  Click a highlighted word to see suggestions and apply a fix.
- **Popup checker**: click the toolbar icon and paste text to check it.
- **Right-click**: select Mongolian text on a page → **Монгол алдаа шалгах**.

The first check on a page takes about a second while the dictionary loads, then
it is instant. Everything runs **offline** — no text ever leaves your browser.

---

## Notes & troubleshooting

- **"Disable developer-mode extensions" popup**: Chrome shows this for any
  unpacked extension. It is harmless — click away or ignore it. (Only Web Store
  installs avoid this prompt.)
- **It doesn't run on some pages**: content scripts can't run on
  `chrome://` pages, the Chrome Web Store, or other extensions' pages. Use a
  normal website.
- **Updating**: download the newer release zip, unzip over the old folder (or to
  a new one), then click the **↻ reload** icon on the extension card. If you
  installed from source, `git pull && npm run prepare-dist` then reload.
- **`.crx` files**: modern Chrome blocks installing standalone `.crx` files for
  security, so the **Load unpacked** method above is the supported way to
  sideload.
- **Scope**: this checks **spelling/typos**, not grammar. Colloquial words that
  aren't in the formal dictionary will be flagged.
