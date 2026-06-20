# Gretl & Sunil — Wedding Registry

A wedding registry page, generated from our Google Sheet and hosted on GitHub Pages.

- **Live page:** https://pedapudi.github.io/wedding-registry/
- `index.html` — the whole site (self-contained; data lives in the `ITEMS` array near the bottom)
- `registry-assets/` — the product photos (`gift-01.webp` … `gift-34.webp`)
- `apps-script/Code.gs` — optional live-claiming backend (see below)

## Two ways to track what's been claimed

### A) Static (default) — mark by hand
The site works on its own. To mark a gift claimed, edit `index.html`, find the gift in the
`ITEMS` array, add `status: "claimed"`, then commit & push (redeploys in ~1 min):

```
{ name: "Nashi", vendor: "Studio Arhoj", price: "$55", status: "claimed", ... }
```

The "I'll get this" button just opens an email so guests can tell you.

### B) Live — guests claim it themselves (recommended)
Wire the page to the Google Sheet so a guest clicking "I'll get this" writes **Claimed** to
the Sheet and every other guest instantly sees it as claimed. One-time setup:

1. Open the registry **Google Sheet** → **Extensions ▸ Apps Script**.
2. Delete the starter code, paste in `apps-script/Code.gs`, **Save**.
3. **Deploy ▸ New deployment** → gear icon → **Web app**. Set **Execute as: Me**,
   **Who has access: Anyone** → **Deploy**. Approve the authorization prompts.
   - ⚠️ Must be done by someone with **edit access** to the Sheet (e.g. Gretl, the owner),
     because the script writes to it. It then runs as that account, so the Sheet can go
     back to **private** afterward.
4. Copy the **Web app URL** (ends in `/exec`).
5. In `index.html`, set `const WEBAPP_URL = "https://script.google.com/macros/s/.../exec";`
   Commit & push.

That's it — claims now flow into the Sheet's `Status` / `Purchased By` / `Date of Purchase`
columns, you get an email on each claim (`NOTIFY_EMAIL` in `Code.gs`), and the page polls the
Sheet every 60s so open tabs stay current. To un-claim something, just clear those cells in
the Sheet.
