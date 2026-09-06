# Gretl & Sunil — Wedding Registry

A wedding registry page hosted on GitHub Pages, backed by a Google Sheet.

- **Live page:** https://pedapudi.github.io/wedding-registry/
- `index.html` — the whole site, gift list included
- `registry-assets/` — the product photos (`gift-01.webp` … `gift-40.webp`)
- `apps-script/Code.gs` — the Sheet-side backend that records claims and sends mail
- `tools/sync-registry.mjs` — brings the gift list in `index.html` back in line with the Sheet
- `.github/workflows/sync-registry.yml` — runs that sync daily

## Where each piece of a gift comes from

The Sheet decides which gifts exist, what they cost, and which have been claimed. It records
nothing else, so the display name, vendor, quantity note, category, photo and shop link are
written by hand in the `ITEMS` array in `index.html`.

Each entry's `key` is the gift's exact name in the Sheet's `Gift` column. That is what links a
card to its row, so a `key` that does not match the Sheet character for character breaks
claiming for that gift.

## Claiming

A guest clicking **I'll get this** opens a short form and the claim is written straight to the
Sheet's `Status`, `Purchased By` and `Date of Purchase` columns, so every other guest sees the
gift as claimed. Open pages re-read the Sheet every 60 seconds. To un-claim something, clear
those three cells.

The form asks for a name and an email address. The email address is required for any gift that
is not linked to the Amazon registry, because those gifts the guest ships themselves and the
thank-you message is how they learn where to send it. Gifts bought through the Amazon registry
arrive at the address Amazon already holds, so there the email address is optional.

Two messages go out on each claim: a notification to the addresses in `NOTIFY_EMAIL`, and a
thank-you to the guest carrying the shipping address when the gift needs one. Both are sent by
the account that deployed the web app.

## Keeping the page in line with the Sheet

`.github/workflows/sync-registry.yml` runs `tools/sync-registry.mjs` every day and commits the
result, which republishes the page. Run it on demand from the repository's Actions tab, or
locally:

```
node tools/sync-registry.mjs            # read the Sheet and update index.html
node tools/sync-registry.mjs --dry-run  # report what would change; exit status 2 if out of date
```

The script reads the Sheet through the deployed web app, using the `WEBAPP_URL` already in
`index.html`. It owns `key` and `price` on every entry, appends gifts added to the Sheet, and
drops gifts removed from it. It never touches the hand-written fields.

A gift the sync adds arrives with no photo, no shop link and the placeholder category `More
Gifts`, which the page renders after the named categories so the card cannot go missing. The
commit message and the workflow run summary name every such gift. Filling one in means adding
a photo to `registry-assets/`, then editing that entry's `name`, `vendor`, `qty`, `cat`, `img`
and `buy` in `index.html`.

## Setting up the Sheet-side backend

`apps-script/Code.gs` is a container-bound Apps Script: it lives inside the Sheet and runs as
the Sheet's owner, so the Sheet can stay private and writes still work. Setting it up, or
changing it, has to be done from an account with edit access to the Sheet.

1. Open the registry Google Sheet → **Extensions ▸ Apps Script**.
2. Replace the contents with `apps-script/Code.gs` and **Save**.
3. Under **Project Settings ▸ Script properties**, add `SHIPPING_ADDRESS` and set it to the
   address guests should ship to. It is read from there rather than written into the file
   because this repository is public. Without it, a guest who claims a gift that has to be
   shipped is told the address will follow, and the claim notification says the property is
   unset.
4. **Deploy ▸ New deployment** → gear icon → **Web app**, with **Execute as: Me** and
   **Who has access: Anyone** → **Deploy**, then approve the authorization prompts.
5. Copy the **Web app URL**, which ends in `/exec`, into `WEBAPP_URL` in `index.html`.

After any later edit to `Code.gs`, redeploy with **Deploy ▸ Manage deployments ▸ edit ▸ New
version**. That keeps the existing `/exec` URL working, so `index.html` and the sync workflow
need no change.

## Running without the backend

With `WEBAPP_URL` set to `""`, the page still lists every gift and the claim button falls back
to opening an email to `CLAIM_EMAIL`. Nothing is recorded automatically: mark a gift claimed by
adding `status: "claimed"` to its entry in `ITEMS` and pushing. The daily sync does not write
`status`, so it will not overwrite that.
