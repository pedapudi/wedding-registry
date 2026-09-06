/**
 * Gretl & Sunil wedding registry — live claim backend.
 *
 * This is a CONTAINER-BOUND Apps Script: open the registry Google Sheet, then
 * Extensions ▸ Apps Script, and paste this in. It runs as the Sheet's OWNER, so
 * the Sheet can stay private and writes still work.
 *
 * Deploy: Deploy ▸ New deployment ▸ type "Web app" ▸ Execute as: Me ▸
 *         Who has access: Anyone ▸ Deploy. Authorize when prompted, then copy the
 *         "/exec" Web app URL and paste it into WEBAPP_URL in index.html.
 *         After changing this file, redeploy with Deploy ▸ Manage deployments ▸
 *         edit ▸ New version, which keeps the existing "/exec" URL working.
 *
 * Columns are detected by header name (row 1): "Gift", "Photo", "Price", "Status",
 * "Purchased By", "Date of Purchase", "Notes". Reorder-safe.
 *
 * The shipping address is read from the script property SHIPPING_ADDRESS rather than
 * written here, because this file is committed to a public repository. Set it once in
 * Project Settings ▸ Script properties. Without it, a guest who claims a gift that has
 * to be shipped is told the address will follow, and the claim notification says the
 * property is unset.
 */

// Email notified whenever a gift is claimed. Set to "" to disable. Comma-separate for several.
var NOTIFY_EMAIL = "skpedapudi@gmail.com,gretllam@gmail.com";

// Where a guest's reply to the thank-you message goes. The message itself is sent by the
// account that deployed this script.
var REPLY_TO = "skpedapudi@gmail.com";

// Script property holding the address for gifts the guest ships themselves.
var SHIPPING_ADDRESS_PROPERTY = "SHIPPING_ADDRESS";

/**
 * GET → { "<gift name>": { claimed: bool, status: "..." }, ... }
 * GET ?catalog=1 → { rows: [ { gift, price, status, notes }, ... ] }, which
 * tools/sync-registry.mjs reads to bring index.html back in line with the Sheet.
 */
function doGet(e) {
  var wantsCatalog = e && e.parameter && e.parameter.catalog;
  return json_(wantsCatalog ? { rows: readCatalog_() } : readStatus_());
}

/** POST (body = JSON {name, who, email, buy}) → claims the gift, returns { ok, status } */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return json_({ ok: false, error: "busy" }); }
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {}
    var name  = String(body.name  || "").trim();
    var who   = String(body.who   || "").trim().slice(0, 80);
    var email = String(body.email || "").trim().slice(0, 120);
    var buy   = String(body.buy   || "").trim();
    if (!name) return json_({ ok: false, error: "no name" });

    var ctx = sheet_();
    var sh = ctx.sheet, c = ctx.cols;
    var row = findRow_(sh, c.gift, name);
    if (row < 0) return json_({ ok: false, error: "not found" });

    var cur = c.status > 0 ? String(sh.getRange(row, c.status).getValue()) : "";
    if (CLAIMED_RE_.test(cur)) {
      return json_({ ok: false, error: "already", status: readStatus_() });
    }

    if (c.status > 0) sh.getRange(row, c.status).setValue("Claimed");
    if (c.buyer  > 0) sh.getRange(row, c.buyer).setValue(who || "a guest");
    if (c.date   > 0) sh.getRange(row, c.date).setValue(new Date());
    SpreadsheetApp.flush();

    var address = String(PropertiesService.getScriptProperties()
      .getProperty(SHIPPING_ADDRESS_PROPERTY) || "").trim();
    var shipToUs = needsShipping_(buy);

    notifyCouple_(name, who, email, shipToUs, address);
    if (EMAIL_RE_.test(email)) thankGuest_(name, who, email, shipToUs, address);

    return json_({ ok: true, status: readStatus_() });
  } finally {
    lock.releaseLock();
  }
}

var CLAIMED_RE_ = /claim|purchas|taken|bought|reserved/i;
var EMAIL_RE_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A gift bought through the Amazon registry ships to the address Amazon already holds.
 * Every other gift, including one with no shop link at all, the guest sends themselves
 * and so needs the address. index.html applies the same test to decide whether to require
 * an email address on the claim; keep the two in step.
 */
var AMAZON_REGISTRY_RE_ = /amazon\.[a-z.]+\/wedding\//i;

function needsShipping_(buyUrl) {
  return !AMAZON_REGISTRY_RE_.test(String(buyUrl || ""));
}

function notifyCouple_(gift, who, email, shipToUs, address) {
  if (!NOTIFY_EMAIL) return;
  var lines = [
    (who ? who : "Someone") + ' claimed "' + gift + '" on the wedding registry.',
    "Email: " + (email || "not given"),
    "Ships to us: " + (shipToUs ? "yes" : "no, it goes through the Amazon registry"),
  ];
  if (shipToUs && !address) {
    lines.push("");
    lines.push("The script property " + SHIPPING_ADDRESS_PROPERTY + " is not set, so the");
    lines.push("thank-you message went out without an address. Set it in the Apps Script");
    lines.push("editor under Project Settings, then send this guest the address by hand.");
  }
  if (shipToUs && address && !EMAIL_RE_.test(email)) {
    lines.push("");
    lines.push("No usable email address was given, so nobody has been told where to ship it.");
  }
  try {
    MailApp.sendEmail(NOTIFY_EMAIL, "Registry: " + gift + " was just claimed", lines.join("\n"));
  } catch (err) {}
}

function thankGuest_(gift, who, email, shipToUs, address) {
  var lines = [who ? "Hi " + who + "," : "Hi,", ""];
  lines.push('Thank you — you claimed "' + gift + '" from our registry, and it is now marked');
  lines.push("off the list so nobody gifts it twice.");
  lines.push("");
  if (!shipToUs) {
    lines.push("This one comes through our Amazon registry, so it will find its way to us");
    lines.push("on its own. There is nothing else for you to do.");
  } else if (address) {
    lines.push("When you order it, please have it sent to:");
    lines.push("");
    lines.push(address);
  } else {
    lines.push("This one comes to us directly. We will follow up shortly with the address");
    lines.push("to send it to.");
  }
  lines.push("");
  lines.push("With love,");
  lines.push("Gretl & Sunil");

  try {
    MailApp.sendEmail({
      to: email,
      replyTo: REPLY_TO,
      subject: 'Thank you — "' + gift + '"',
      body: lines.join("\n"),
    });
  } catch (err) {}
}

function readStatus_() {
  var ctx = sheet_();
  var sh = ctx.sheet, c = ctx.cols;
  var last = sh.getLastRow();
  var out = {};
  if (last < 2) return out;
  var n = last - 1;
  var gifts = sh.getRange(2, c.gift, n, 1).getValues();
  var stats = c.status > 0 ? sh.getRange(2, c.status, n, 1).getValues() : null;
  for (var i = 0; i < n; i++) {
    var name = String(gifts[i][0]).trim();
    if (!name) continue;
    var st = stats ? String(stats[i][0]).trim() : "";
    out[name] = { claimed: CLAIMED_RE_.test(st), status: st };
  }
  return out;
}

/** Every gift row, in Sheet order, as the sync script consumes it. */
function readCatalog_() {
  var ctx = sheet_();
  var sh = ctx.sheet, c = ctx.cols;
  var last = sh.getLastRow();
  var rows = [];
  if (last < 2) return rows;
  var n = last - 1;
  // Display values, not raw ones: a currency-formatted Price cell holds the number 55 and
  // shows "$55", and it is the "$55" the page prints.
  function col(index) {
    return index > 0 ? sh.getRange(2, index, n, 1).getDisplayValues() : null;
  }
  var gifts = col(c.gift), prices = col(c.price), stats = col(c.status), notes = col(c.notes);
  function cell(values, i) { return values ? String(values[i][0]).trim() : ""; }
  for (var i = 0; i < n; i++) {
    var gift = cell(gifts, i);
    if (!gift) continue;
    rows.push({
      gift: gift,
      price: cell(prices, i),
      status: cell(stats, i),
      notes: cell(notes, i),
    });
  }
  return rows;
}

/** Find the data sheet (the tab whose header row contains "Gift") and its columns. */
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets(), sh = sheets[0];
  for (var i = 0; i < sheets.length; i++) {
    var lc = sheets[i].getLastColumn();
    if (lc < 1) continue;
    var hdr = sheets[i].getRange(1, 1, 1, lc).getValues()[0].map(lc_);
    if (hdr.indexOf("gift") >= 0) { sh = sheets[i]; break; }
  }
  var h = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(lc_);
  function f(name) { var i = h.indexOf(name); return i < 0 ? -1 : i + 1; }
  var gift = f("gift"); if (gift < 0) gift = 1;
  return {
    sheet: sh,
    cols: {
      gift: gift,
      price: f("price"),
      status: f("status"),
      buyer: f("purchased by"),
      date: f("date of purchase"),
      notes: f("notes"),
    },
  };
}

function findRow_(sh, giftCol, name) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, giftCol, last - 1, 1).getValues();
  var target = name.trim().toLowerCase();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

function lc_(x) { return String(x).trim().toLowerCase(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
