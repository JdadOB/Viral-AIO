// sheets-routes.js — API routes for Google Sheets integration
// Mount this in server.js with: require('./sheets-routes')(app, { requireAuth, requireManager, db, getUserSetting, setUserSetting, userRole, logActivity });

const { extractSheetId, validateSheetAccess, exportCaptionsToSheet, getSheetTabs, formatDateTab } = require('./sheets');

module.exports = function mountSheetsRoutes(app, { requireAuth, requireManager, db, getUserSetting, setUserSetting, userRole, logActivity }) {

  // ── Get sheet config for a user ─────────────────────────────────────────────
  // GET /api/sheets/config
  // Returns the sheet ID and column map stored for req.scopedUserId
  app.get('/api/sheets/config', requireAuth, (req, res) => {
    const uid = req.scopedUserId;
    const sheetId  = getUserSetting(uid, 'sheets_sheet_id')  || '';
    const tabMode  = getUserSetting(uid, 'sheets_tab_mode')  || 'date'; // 'date' | 'manual'
    const manualTab = getUserSetting(uid, 'sheets_manual_tab') || '';
    const colMap   = (() => {
      try { return JSON.parse(getUserSetting(uid, 'sheets_col_map') || 'null'); } catch { return null; }
    })();
    res.json({ sheetId, tabMode, manualTab, colMap });
  });

  // ── Save sheet config ────────────────────────────────────────────────────────
  // POST /api/sheets/config
  // Body: { sheetUrl, tabMode, manualTab, colMap }
  app.post('/api/sheets/config', requireManager, (req, res) => {
    const uid = req.scopedUserId;
    const { sheetUrl, tabMode, manualTab, colMap } = req.body;

    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl required' });

    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) return res.status(400).json({ error: 'Could not extract Sheet ID from URL. Paste the full Google Sheets URL.' });

    setUserSetting(uid, 'sheets_sheet_id', sheetId);
    setUserSetting(uid, 'sheets_tab_mode', tabMode || 'date');
    if (manualTab) setUserSetting(uid, 'sheets_manual_tab', manualTab);
    if (colMap)    setUserSetting(uid, 'sheets_col_map', JSON.stringify(colMap));

    logActivity(req.user.id, req.user.name, userRole(req.user), 'sheets_config_saved', { sheetId, scopedUserId: uid });
    res.json({ success: true, sheetId });
  });

  // ── Validate/test sheet connection ───────────────────────────────────────────
  // POST /api/sheets/validate
  // Body: { sheetUrl }
  app.post('/api/sheets/validate', requireManager, async (req, res) => {
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl required' });

    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) return res.status(400).json({ error: 'Invalid Sheet URL' });

    try {
      const info = await validateSheetAccess(sheetId);
      res.json({ success: true, title: info.title, tabs: info.tabs });
    } catch (err) {
      // Give helpful error messages
      if (err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) {
        return res.status(403).json({ error: `Permission denied. Share the sheet with the service account email and try again.` });
      }
      if (err.message.includes('404') || err.message.includes('NOT_FOUND')) {
        return res.status(404).json({ error: 'Sheet not found. Check the URL and try again.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ── Get tabs for a sheet ─────────────────────────────────────────────────────
  // GET /api/sheets/tabs?sheetId=xxx
  app.get('/api/sheets/tabs', requireManager, async (req, res) => {
    const { sheetId } = req.query;
    if (!sheetId) return res.status(400).json({ error: 'sheetId required' });
    try {
      const tabs = await getSheetTabs(sheetId);
      res.json({ tabs });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Export captions to sheet ─────────────────────────────────────────────────
  // POST /api/sheets/export
  // Body: {
  //   captions: [{ caption, dropboxLink?, platform?, category? }],
  //   date:     'YYYY-MM-DD'  (which tab to write to — defaults to today)
  //   tabName:  string        (override tab name directly)
  // }
  app.post('/api/sheets/export', requireManager, async (req, res) => {
    const uid = req.scopedUserId;
    const { captions, date, tabName } = req.body;

    if (!Array.isArray(captions) || !captions.length) {
      return res.status(400).json({ error: 'captions[] array required' });
    }

    const sheetId = getUserSetting(uid, 'sheets_sheet_id');
    if (!sheetId) {
      return res.status(400).json({ error: 'No Google Sheet configured. Go to Settings → Google Sheets to set up.' });
    }

    const tabMode    = getUserSetting(uid, 'sheets_tab_mode') || 'date';
    const manualTab  = getUserSetting(uid, 'sheets_manual_tab') || '';
    const colMapRaw  = getUserSetting(uid, 'sheets_col_map');
    const colMap     = colMapRaw ? (() => { try { return JSON.parse(colMapRaw); } catch { return null; } })() : null;

    // Resolve tab name
    const resolvedTab = tabName
      || (tabMode === 'manual' ? manualTab : null)
      || formatDateTab(date || new Date().toISOString().slice(0, 10));

    try {
      const result = await exportCaptionsToSheet({
        sheetId,
        tabName: resolvedTab,
        captions,
        columnMap: colMap,
        appendMode: true,
      });

      logActivity(req.user.id, req.user.name, userRole(req.user), 'sheets_export', {
        captionsWritten: result.captionsWritten,
        tab: result.tab,
        sheetId,
        scopedUserId: uid,
      });

      res.json({
        success: true,
        written: result.captionsWritten,
        tab: result.tab,
        message: `${result.captionsWritten} captions exported to "${result.tab}"`,
      });
    } catch (err) {
      if (err.message.includes('403') || err.message.includes('PERMISSION_DENIED')) {
        return res.status(403).json({ error: 'Permission denied — make sure the sheet is shared with the service account.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ── Export agent output (Writer / Bulk) directly ─────────────────────────────
  // POST /api/sheets/export-output
  // Body: { outputId, date?, tabName? }
  // Pulls a saved agent_output by ID, parses the captions out, exports to sheet
  app.post('/api/sheets/export-output', requireManager, async (req, res) => {
    const uid = req.scopedUserId;
    const { outputId, date, tabName } = req.body;

    if (!outputId) return res.status(400).json({ error: 'outputId required' });

    const sheetId = getUserSetting(uid, 'sheets_sheet_id');
    if (!sheetId) {
      return res.status(400).json({ error: 'No Google Sheet configured. Go to Settings → Google Sheets to set up.' });
    }

    // Load the saved output
    const output = db.prepare('SELECT * FROM agent_outputs WHERE id = ? AND user_id = ?').get(outputId, uid);
    if (!output) return res.status(404).json({ error: 'Output not found' });

    // Parse captions from the reviewed output (Captain-reviewed text)
    const text = output.reviewed_output || output.raw_output;
    const captions = parseCaptionsFromOutput(text, output.agent);

    if (!captions.length) {
      return res.status(400).json({ error: 'No captions could be parsed from this output' });
    }

    const tabMode   = getUserSetting(uid, 'sheets_tab_mode') || 'date';
    const manualTab = getUserSetting(uid, 'sheets_manual_tab') || '';
    const colMapRaw = getUserSetting(uid, 'sheets_col_map');
    const colMap    = colMapRaw ? (() => { try { return JSON.parse(colMapRaw); } catch { return null; } })() : null;

    const resolvedTab = tabName
      || (tabMode === 'manual' ? manualTab : null)
      || formatDateTab(date || new Date().toISOString().slice(0, 10));

    try {
      const result = await exportCaptionsToSheet({
        sheetId,
        tabName: resolvedTab,
        captions,
        columnMap: colMap,
        appendMode: true,
      });

      logActivity(req.user.id, req.user.name, userRole(req.user), 'sheets_export_output', {
        outputId,
        agent: output.agent,
        captionsWritten: result.captionsWritten,
        tab: result.tab,
      });

      res.json({
        success: true,
        written: result.captionsWritten,
        tab: result.tab,
        message: `${result.captionsWritten} captions exported to "${result.tab}"`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};

// ── Caption parser ────────────────────────────────────────────────────────────
// Extracts individual captions from agent output text.
// The Writer formats as:
//   ### CAPTION 1 — [style]
//   [caption body]
//   **Hashtags:** [hashtags]

function parseCaptionsFromOutput(text, agent) {
  if (!text) return [];

  const captions = [];

  // Match caption blocks: ### CAPTION N — style\n...body...\n**Hashtags:** ...
  const captionBlockRe = /###\s*CAPTION\s*\d+[^\n]*\n([\s\S]*?)(?=###\s*CAPTION|\s*$)/gi;
  let match;

  while ((match = captionBlockRe.exec(text)) !== null) {
    const block = match[1].trim();

    // Split off hashtags
    const hashtagMatch = block.match(/\*\*Hashtags:\*\*\s*([\s\S]*?)$/i);
    const hashtags = hashtagMatch ? hashtagMatch[1].trim() : '';
    const body = block.replace(/\*\*Hashtags:\*\*[\s\S]*$/i, '').trim();

    const fullCaption = hashtags ? `${body}\n\n${hashtags}` : body;
    if (fullCaption) {
      captions.push({
        caption: fullCaption,
        dropboxLink: '',
        platform: '',
        category: '',
      });
    }
  }

  // Fallback: if no ### CAPTION blocks found, split by double newlines and treat each as a caption
  if (!captions.length && text.trim()) {
    const chunks = text.split(/\n{2,}/).filter(c => c.trim().length > 20);
    return chunks.slice(0, 10).map(c => ({
      caption: c.trim(),
      dropboxLink: '',
      platform: '',
      category: '',
    }));
  }

  return captions;
}
