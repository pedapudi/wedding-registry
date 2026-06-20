# Gretl & Sunil — Wedding Registry

A static wedding registry page, generated from our Google Sheet and hosted on GitHub Pages.

- **Live page:** https://pedapudi.github.io/wedding-registry/
- `index.html` — the whole site (self-contained; data lives in the `ITEMS` array near the bottom)
- `registry-assets/` — the product photos (`gift-01.webp` … `gift-34.webp`)

## Marking a gift as taken

This is a static site, so status is whatever is committed in `index.html` — it does **not**
update automatically when someone clicks "I'll get this." To mark a gift claimed:

1. Edit `index.html`, find the gift in the `ITEMS` array, and add `status: "claimed"` to it, e.g.
   `{ name: "Nashi", vendor: "Studio Arhoj", price: "$55", status: "claimed", ... }`
2. Commit and push. GitHub Pages redeploys in ~1 minute.

The card greys out with a strikethrough and the "X of 34 available" counter drops automatically.
