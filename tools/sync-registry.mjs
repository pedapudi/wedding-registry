#!/usr/bin/env node
// Rewrite the gift list in index.html from the registry Google Sheet.
//
//   node tools/sync-registry.mjs              read the Sheet and write index.html
//   node tools/sync-registry.mjs --dry-run    report what would change, write nothing
//   node tools/sync-registry.mjs --catalog f  read the catalog from file f instead of the web
//
// The Sheet owns which gifts exist and what they cost. Everything else about a card —
// display name, vendor, quantity note, category, photo and shop link — is written by hand
// in index.html and is never overwritten here, because the Sheet does not record it.
//
// Exit status is 0 when the file already matches the Sheet or was updated, 1 on failure,
// and 2 under --dry-run when the file is out of date.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "index.html");

const START = "  // --- gift list: generated from the Sheet ---\n";
const END = "\n  // --- end gift list ---";

// Written in this order, one gift per line. A `status` written by hand, which is how the page
// marks a gift claimed when the Sheet-side backend is switched off, is carried through after
// these; the sync neither sets nor clears it.
const FIELDS = ["key", "name", "vendor", "price", "qty", "cat", "img", "buy"];

// Category for a gift that appeared in the Sheet with nothing written about it yet.
// index.html renders any category it does not know about after the ordered ones.
const CATEGORY_FOR_NEW_GIFTS = "More Gifts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const catalogFlag = args.indexOf("--catalog");
const catalogFile = catalogFlag < 0 ? null : args[catalogFlag + 1];
if (catalogFlag >= 0 && !catalogFile) {
  console.error("--catalog needs a file to read the catalog from");
  process.exit(1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

async function main() {
  const page = await readFile(PAGE, "utf8");
  const rows = catalogFile
    ? JSON.parse(await readFile(catalogFile, "utf8")).rows
    : await fetchCatalog(page);
  if (!Array.isArray(rows)) throw new Error("catalog response has no rows array");

  const region = locateRegion(page);
  const items = parseItems(page.slice(region.start, region.end));
  const { merged, report } = reconcile(items, rows);
  const next = page.slice(0, region.start) + serialize(merged) + page.slice(region.end);

  for (const line of report) console.log(line);
  if (next === page) {
    console.log(`No change: ${merged.length} gifts, matching the Sheet.`);
    return;
  }
  if (dryRun) {
    console.log("index.html is out of date. Run without --dry-run to update it.");
    process.exit(2);
  }
  await writeFile(PAGE, next);
  console.log(`Updated index.html: ${merged.length} gifts.`);
}

/** The web app URL lives in index.html, so the endpoint has exactly one home. */
async function fetchCatalog(page) {
  const found = page.match(/const WEBAPP_URL = "([^"]+)"/);
  if (!found || !/^https:\/\//.test(found[1])) {
    throw new Error("index.html has no https WEBAPP_URL to read the Sheet through");
  }
  const url = found[1] + (found[1].includes("?") ? "&" : "?") + "catalog=1";
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`catalog request failed: ${response.status}`);
  return (await response.json()).rows;
}

function locateRegion(page) {
  const start = page.indexOf(START);
  const end = page.indexOf(END, start);
  if (start < 0 || end < 0) throw new Error("index.html has no generated gift list block");
  return { start: start + START.length, end };
}

function parseItems(source) {
  const open = source.indexOf("[");
  const close = source.lastIndexOf("]");
  if (open < 0 || close < 0) throw new Error("the gift list block holds no array");
  // The block is a plain array of object literals written by this script or by hand.
  return new Function(`return ${source.slice(open, close + 1)}`)();
}

/**
 * "$42 each, 2 requested" → price "$42", the rest "each, 2 requested".
 *
 * A Price cell holding a plain number arrives without its currency format, as "55" rather
 * than "$55", so a bare number is read as dollars. Whole dollars print without cents.
 */
function splitPrice(cell) {
  const text = String(cell ?? "").trim();
  const found = text.match(/^\$?\s*(\d+(?:\.\d{1,2})?)\s*(.*)$/);
  if (!found) return { price: "", rest: text };
  const amount = found[1].replace(/\.0{1,2}$/, "");
  return { price: "$" + amount, rest: found[2].replace(/^[,\s]+/, "").trim() };
}

function reconcile(items, rows) {
  const byKey = new Map(items.map(it => [it.key, it]));
  const inSheet = new Set();
  const report = [];
  const kept = [];
  const added = [];

  for (const row of rows) {
    const key = String(row.gift || "").trim();
    if (!key) continue;
    inSheet.add(key);
    const { price, rest } = splitPrice(row.price);
    if (!price && String(row.price || "").trim()) {
      report.push(`Unreadable price for "${key}": ${row.price}`);
    }
    const existing = byKey.get(key);
    if (existing) {
      if (existing.price !== price) {
        report.push(`Repriced "${key}": ${existing.price || "no price"} to ${price || "no price"}`);
        existing.price = price;
      }
      kept.push(existing);
    } else {
      report.push(`Added "${key}" — it needs a photo, a shop link and a category.`);
      added.push({
        key,
        name: key,
        vendor: "",
        price,
        qty: rest,
        cat: CATEGORY_FOR_NEW_GIFTS,
        img: "",
        buy: "",
      });
    }
  }

  // Existing gifts keep the order they were written in; the page groups by category, so
  // Sheet order buys nothing and reordering would churn the diff on every run.
  const merged = items.filter(it => inSheet.has(it.key)).concat(added);
  for (const it of items) {
    if (!inSheet.has(it.key)) report.push(`Removed "${it.key}" — it is no longer in the Sheet.`);
  }
  if (kept.length + added.length !== merged.length) throw new Error("reconcile lost a gift");
  return { merged, report };
}

function serialize(items) {
  const lines = ["  const ITEMS = ["];
  let previousCategory = null;
  for (const it of items) {
    if (previousCategory !== null && it.cat !== previousCategory) lines.push("");
    previousCategory = it.cat;
    const fields = FIELDS.map(name => `${name}: ${JSON.stringify(it[name] ?? "")}`);
    if (it.status) fields.push(`status: ${JSON.stringify(it.status)}`);
    lines.push(`    { ${fields.join(", ")} },`);
  }
  lines.push("  ];");
  return lines.join("\n");
}
