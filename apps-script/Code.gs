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
 *
 * Columns are detected by header name (row 1): "Gift", "Status",
 * "Purchased By", "Date of Purchase". Reorder-safe.
 */

// Email notified whenever a gift is claimed. Set to "" to disable. Comma-separate for several.
var NOTIFY_EMAIL = "skpedapudi@gmail.com";

/** GET → returns { "<gift name>": { claimed: bool, status: "..." }, ... } */
function doGet(e) {
  return json_(readStatus_());
}

/** POST (body = JSON {name, who}) → claims the gift, returns { ok, status } */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return json_({ ok: false, error: "busy" }); }
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {}
    var name = String(body.name || "").trim();
    var who  = String(body.who  || "").trim().slice(0, 80);
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

    if (NOTIFY_EMAIL) {
      try {
        MailApp.sendEmail(NOTIFY_EMAIL,
          "Registry: " + name + " was just claimed",
          (who ? who : "Someone") + ' claimed "' + name + '" on the wedding registry.');
      } catch (err) {}
    }
    return json_({ ok: true, status: readStatus_() });
  } finally {
    lock.releaseLock();
  }
}

var CLAIMED_RE_ = /claim|purchas|taken|bought|reserved/i;

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
  return { sheet: sh, cols: { gift: gift, status: f("status"), buyer: f("purchased by"), date: f("date of purchase") } };
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
