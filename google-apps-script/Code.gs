/**
 * Pure Protection lead intake — Google Apps Script
 *
 * Writes each verified lead from the Netlify site into a Google Sheet in your Drive.
 * Paste this whole file into the Apps Script editor (Extensions > Apps Script from the Sheet).
 *
 * Script Properties (Project Settings > Script Properties):
 *   SHARED_SECRET   same long random string you put in Netlify  (required)
 *   NOTIFY_EMAIL    email to alert on each new lead            (optional)
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * (Access is "Anyone" so Netlify can reach it; the SHARED_SECRET is what keeps everyone else out.)
 */

var SHEET_NAME = 'Leads';
var HEADERS = ['Received (PT)', 'First Name', 'Last Name', 'Email', 'Phone', 'VIN', 'Model', 'Mileage', 'Consent', 'Status', 'Notes'];
var MAX_PER_IP_PER_HOUR = 5;

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty('SHARED_SECRET');

    if (!secret || !safeEquals_(String(body.secret || ''), secret)) {
      return out_({ ok: false, error: 'unauthorized' });
    }

    // Shared rate limit by IP (hashed — raw IPs are not stored)
    var ipKey = 'ip_' + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(body.ip || 'unknown'))).slice(0, 40);
    var cache = CacheService.getScriptCache();
    var count = Number(cache.get(ipKey) || 0);
    if (count >= MAX_PER_IP_PER_HOUR) return out_({ ok: false, error: 'rate_limited' });
    cache.put(ipKey, String(count + 1), 3600);

    var lead = body.lead || {};
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(String(lead.vin || '')) || !lead.email) {
      return out_({ ok: false, error: 'invalid' });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet_();
      sheet.appendRow([
        Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss'),
        clean_(lead.firstName),
        clean_(lead.lastName),
        clean_(lead.email),
        clean_(lead.phone),
        clean_(lead.vin),
        clean_(lead.model),
        Number(lead.mileage) || '',
        lead.consent === true ? 'Yes' : 'No',
        'New',
        ''
      ]);
    } finally {
      lock.releaseLock();
    }

    notify_(props.getProperty('NOTIFY_EMAIL'), lead);
    return out_({ ok: true });
  } catch (err) {
    console.error(err);
    return out_({ ok: false, error: 'server_error' });
  }
}

// Visiting the URL in a browser shows nothing useful — on purpose.
function doGet() {
  return out_({ ok: true, service: 'lead-intake' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('F:F').setNumberFormat('@'); // keep VIN as text
  }
  return sheet;
}

// Blocks spreadsheet formula injection (values starting with = + - @) and trims length
function clean_(v) {
  var s = String(v == null ? '' : v).slice(0, 200);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function notify_(to, lead) {
  if (!to) return;
  try {
    MailApp.sendEmail({
      to: to,
      subject: 'New Pure Protection quote request: ' + clean_(lead.firstName) + ' ' + clean_(lead.lastName),
      body: [
        'A new quote request just came in.',
        '',
        'Name: ' + lead.firstName + ' ' + lead.lastName,
        'Email: ' + lead.email,
        'Phone: ' + (lead.phone || '—'),
        'Model: ' + lead.model,
        'VIN: ' + lead.vin,
        'Mileage: ' + Number(lead.mileage).toLocaleString(),
        '',
        'Open the Leads sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      ].join('\n')
    });
  } catch (err) {
    console.error('Notify failed', err);
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the header row and approve permissions. */
function setup() {
  getSheet_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHARED_SECRET')) {
    var s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SHARED_SECRET', s);
    console.log('Generated SHARED_SECRET (copy this into Netlify): ' + s);
  } else {
    console.log('SHARED_SECRET already set (Project Settings > Script Properties).');
  }
}
