// sheets.js — Google Sheets integration for Viral-AIO
// Uses a single Google Service Account for all client sheets.
// Each user stores their own sheet_id + tab_name in user_settings.
//
// Setup:
//   1. Create a Google Service Account in Google Cloud Console
//   2. Download the JSON key file, set GOOGLE_SERVICE_ACCOUNT_JSON env var to its contents
//   3. Share each client's Google Sheet with the service account email (Editor access)
//   4. Client sets their Sheet URL in Settings — the app extracts the sheet ID

const { google } = require('googleapis');

// ── Auth ──────────────────────────────────────────────────────────────────────

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable not set');

  let creds;
  try { creds = JSON.parse(raw); } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// ── Sheet ID extraction ───────────────────────────────────────────────────────

// Accepts full URL or bare ID
function extractSheetId(input) {
  if (!input) return null;
  // URL pattern: /spreadsheets/d/SHEET_ID/
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Bare ID (no slashes, reasonable length)
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}

// ── Tab management ────────────────────────────────────────────────────────────

// Get all tab names in a sheet
async function getSheetTabs(sheetId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  return res.data.sheets.map(s => s.properties.title);
}

// ── Read existing data ────────────────────────────────────────────────────────

// Read first row (headers) from a tab to understand column layout
async function getHeaders(sheetId, tabName) {
  const sheets = getSheetsClient();
  const range = `'${tabName}'!1:1`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range,
  });
  return (res.data.values?.[0] || []);
}

// Get all data from a tab
async function getTabData(sheetId, tabName) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'`,
  });
  return res.data.values || [];
}

// ── Write captions ────────────────────────────────────────────────────────────

// Export a batch of captions to the correct client sheet tab.
//
// captions: Array of { dropboxLink, caption, platform, date, category }
//   - dropboxLink: string (optional, can be empty)
//   - caption:     string
//   - platform:    e.g. 'TikTok', 'Instagram', 'All'
//   - date:        'YYYY-MM-DD' string for which tab to write to
//   - category:    e.g. 'SFW Trends', 'NSFW Trends', 'Yapping' (optional)
//
// sheetId:  Google Sheet ID
// tabName:  Sheet tab name (e.g. 'Apr 28' or 'May 1')
//           If null, we try to find or create a tab matching the date
//
// columnMap: { dropboxLink: 'A', caption1: 'C', caption2: 'E', platform: 'B' }
//   Defaults to the standard layout seen in Jon's sheets if not provided.
//
// Returns: { written: number, tab: string, errors: string[] }

async function exportCaptionsToSheet({ sheetId, tabName, captions, columnMap, appendMode = true }) {
  if (!sheetId) throw new Error('sheetId is required');
  if (!captions?.length) throw new Error('No captions to export');

  const sheets = getSheetsClient();

  // Default column map matching Jon's sheet structure:
  // Col A = DB/Dropbox link, Col B = Post, Col C = Caption 1, Col D = Caption 2
  const cols = columnMap || {
    dropboxLink: 0,  // A
    post:        1,  // B (platform/post label)
    caption1:    2,  // C
    caption2:    3,  // D
  };

  const tab = tabName || formatDateTab(captions[0]?.date || new Date().toISOString().slice(0, 10));

  // Ensure tab exists — create it if not
  const existingTabs = await getSheetTabs(sheetId);
  if (!existingTabs.includes(tab)) {
    await createTab(sheetId, tab);
  }

  // Build rows — group captions: first caption goes to caption1, second to caption2 on same row
  const rows = [];
  for (let i = 0; i < captions.length; i += 2) {
    const c1 = captions[i];
    const c2 = captions[i + 1];

    const row = Array(Math.max(...Object.values(cols)) + 1).fill('');
    row[cols.dropboxLink] = c1.dropboxLink || '';
    row[cols.post]        = c1.platform || '';
    row[cols.caption1]    = c1.caption || '';
    row[cols.caption2]    = c2?.caption || '';

    rows.push(row);
  }

  // Append or write to sheet
  const range = `'${tab}'!A1`;

  if (appendMode) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  } else {
    // Find next empty row and write there
    const existing = await getTabData(sheetId, tab);
    const nextRow = existing.length + 1;
    const writeRange = `'${tab}'!A${nextRow}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: writeRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }

  return { written: rows.length, tab, captionsWritten: captions.length };
}

// ── Tab naming helpers ────────────────────────────────────────────────────────

// Converts 'YYYY-MM-DD' → 'Apr 28' (matching the sheet tab naming convention)
function formatDateTab(dateStr) {
  const d = new Date(dateStr + 'T12:00:00'); // avoid timezone shift
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Create a new tab in the sheet
async function createTab(sheetId, tabName) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title: tabName },
        },
      }],
    },
  });
}

// ── Validate connection ───────────────────────────────────────────────────────

// Test that we can reach a sheet — returns sheet title on success
async function validateSheetAccess(sheetId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  return {
    title: res.data.properties.title,
    tabs: res.data.sheets.map(s => s.properties.title),
  };
}

module.exports = {
  extractSheetId,
  getSheetTabs,
  getHeaders,
  getTabData,
  exportCaptionsToSheet,
  validateSheetAccess,
  formatDateTab,
};
