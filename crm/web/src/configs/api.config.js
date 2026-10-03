import { api, toQueryString, BASE_URL } from '../helpers/api.helper';

/**
 * The API's version prefix, written once.
 *
 * Every path below is built from it, so moving the whole client to /api/v2
 * is this one line rather than sixty edits with one inevitably missed.
 */
const apiPath = '/api/v1';

export const apiService = {
  dashboard: {
    get: (params = {}) => api.get(`${apiPath}/dashboard${toQueryString(params)}`),
  },
  auth: {
    // Two requests, and only the second one comes back with a session. See
    // api/v1/auth.js: login proves the password and returns a pending
    // ticket, verify proves the secret code and sets the cookie.
    login: ({ username, password }) => api.post(`${apiPath}/auth/login`, { username, password }),
    verify: ({ ticket, code }) => api.post(`${apiPath}/auth/login/verify`, { ticket, code }),
    logout: () => api.post(`${apiPath}/auth/logout`),
  },
  // A company is keyed by its NORMALIZED name, not an id — a company that
  // exists only in the deals has no tb_companies row to have an id yet,
  // and the page still has to be able to open and rename it.
  companies: {
    // Passed through whole. An allowlist here silently drops any filter
    // added later, which is exactly how the master sheet's checkboxes
    // ended up doing nothing.
    list: (params = {}) => api.get(`${apiPath}/companies${toQueryString(params)}`),
    names: () => api.get(`${apiPath}/companies/names`),
    get: (key) => api.get(`${apiPath}/companies/${encodeURIComponent(key)}`),
    update: (key, fields) => api.patch(`${apiPath}/companies/${encodeURIComponent(key)}`, fields),
    addHandlers: (key, handlers) =>
      api.post(`${apiPath}/companies/${encodeURIComponent(key)}/handlers`, { handlers }),
  },
  // ===============================
  // * THE MONTHLY REVIEW. NO MONTH PARAM, ANYWHERE.
  // ===============================
  // The server decides the period from the business timezone. A month sent
  // from the browser would be a second definition of "now", and the one
  // that is wrong half the night.
  // What Diane says at sign-in. One request, four counts: four calls
  // would be four round trips before she opens her mouth.
  briefing: {
    get: () => api.get(`${apiPath}/briefing`),
  },
  monthlyReview: {
    list: (params = {}) => api.get(`${apiPath}/monthly-review${toQueryString(params)}`),
    pending: () => api.get(`${apiPath}/monthly-review/pending`),
    // One door, and it takes a list. A selection of one is one answer.
    answer: (dealIds, answer) => api.post(`${apiPath}/monthly-review/answer`, { dealIds, answer }),
    // NO CLEAR. The way back from a misclick is History's undo.
  },
  concerns: {
    list: ({ status, from, to, group, q, page, pageSize } = {}) =>
      api.get(`${apiPath}/concerns${toQueryString({ status, from, to, group, q, page, pageSize })}`),
    forPerson: (group, personId) =>
      api.get(`${apiPath}/concerns/person${toQueryString({ group, personId })}`),
    updateStatus: (id, status) => api.patch(`${apiPath}/concerns/${id}`, { status }),
  },
  expenses: {
    list: (params = {}) => api.get(`${apiPath}/expenses${toQueryString(params)}`),
    // Dropdowns and the rate suggestion in one call, so opening the page or
    // the add form is not five round trips.
    options: () => api.get(`${apiPath}/expenses/options`),
    create: (fields) => api.post(`${apiPath}/expenses`, fields),
    update: (id, fields) => api.patch(`${apiPath}/expenses/${id}`, fields),
    remove: (id) => api.delete(`${apiPath}/expenses/${id}`),
    // The month as a sheet, fetched with progress rather than navigating
    // away. Resolves { blob, filename }.
    download: (params = {}, onProgress) => (
      api.download(`${apiPath}/expenses/download${toQueryString(params)}`, onProgress)
    ),
    // What the export modal offers: columns, palettes and the groups this
    // month's expenses actually carry.
    exportOptions: () => api.get(`${apiPath}/expenses/export/options`),
    // TWO HALVES, and the first writes nothing. Its own routes, never the
    // master sheet's: one parser must not be able to read the other's file.
    importPreview: (file, onProgress) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload(`${apiPath}/expenses/import/preview`, formData, onProgress);
    },
    importCommit: (accepted) => api.post(`${apiPath}/expenses/import/commit`, { accepted }),
  },
  // People whose every deal is stopped. Read only: a deal added back takes them off.
  deadPeople: {
    list: (params = {}) => api.get(`${apiPath}/dead-people${toQueryString(params)}`),
    get: (personId) => api.get(`${apiPath}/dead-people/${encodeURIComponent(personId)}`),
  },
  people: {
    list: (params = {}) => api.get(`${apiPath}/people${toQueryString(params)}`),
    get: (personId) => api.get(`${apiPath}/people/${encodeURIComponent(personId)}`),
    update: (personId, fields) => api.patch(`${apiPath}/people/${encodeURIComponent(personId)}`, fields),
    addDeal: (personId, deal) =>
      api.post(`${apiPath}/people/${encodeURIComponent(personId)}/deals`, deal),
    // Built from the uploaded document, never a hardcoded list — a role
    // the boss invents next month appears in the filter by itself.
    filters: () => api.get(`${apiPath}/people/filters`),
    duplicates: () => api.get(`${apiPath}/people/duplicates`),
    // The chatbox's own navigation, namespaced so it can't be confused
    // with the People page's listing (a different shape entirely).
    groups: () => api.get(`${apiPath}/people/lookup/groups`),
    inGroup: (group) => api.get(`${apiPath}/people/lookup/search${toQueryString({ group })}`),
    search: (q) => api.get(`${apiPath}/people/lookup/search${toQueryString({ q })}`),
  },
  messages: {
    threads: () => api.get(`${apiPath}/messages/threads`),
    thread: (group, personId) => api.get(`${apiPath}/messages/thread${toQueryString({ group, personId })}`),
    send: (groupName, personId, body) => api.post(`${apiPath}/messages`, { groupName, personId, body }),
    unread: () => api.get(`${apiPath}/messages/unread`),
    markRead: (group, personId) => api.post(`${apiPath}/messages/thread/read`, { group, personId }),
  },
  // Export replaced the Calculator page. A preset is a filter plus a
  // grouping — the boss's four workbooks survive as presets rather than
  // as a separate pipeline.
  // The edit history, and the undo behind it. Every cell in the CRM is
  // editable in place, so a mistyped figure is one keystroke away — this
  // is the way back.
  history: {
    list: (params = {}) => api.get(`${apiPath}/master-sheet/changes${toQueryString(params)}`),
    revert: (id) => api.post(`${apiPath}/master-sheet/changes/${id}/revert`),
  },
  exports: {
    // The eight xlsx SHAPES. Served since the route was written and unused
    // here until Diane's export panel: the modal reaches its templates
    // through its own tabs. Her panel may draw anything and must know
    // nothing, so it asks.
    templates: () => api.get(`${apiPath}/export/templates`),
    count: (params = {}) => api.get(`${apiPath}/export/count${toQueryString(params)}`),
    // Diane's card, REBUILT from its query. Her card survives a reload and
    // refreshes when the sheet changes by being rebuilt rather than
    // remembered: a stored count is a count that has stopped being true.
    card: (params = {}) => api.get(`${apiPath}/export/card${toQueryString(params)}`),
    rows: (params = {}) => api.get(`${apiPath}/export/rows${toQueryString(params)}`),
    // Which columns the two master-sheet layouts can carry, and which they
    // can never drop. Served so adding one is a change in buildWorkbook and
    // nothing here.
    // Per template: the payout sheets name the same field differently, so
    // the picker has to offer the header that document's reader knows.
    columns: (template) => api.get(`${apiPath}/export/columns${template ? `?template=${template}` : ''}`),
    // Both halves of one control, from one request: the designs and the
    // five colours they can be printed in.
    breakdownDesigns: () => api.get(`${apiPath}/export/breakdown-designs`),
    // A real download, not a fetch — the browser's own save flow, with
    // cookie auth carried the way any same-origin link carries it. Still
    // used for a plain link; the modal uses xlsx() below so it can show
    // progress rather than navigating away from itself.
    xlsxUrl: (params = {}) => `${BASE_URL}${apiPath}/export/xlsx${toQueryString(params)}`,
    // The same file, fetched with progress. Resolves { blob, filename }.
    xlsx: (params = {}, onProgress) => (
      api.download(`${apiPath}/export/xlsx${toQueryString(params)}`, onProgress)
    ),
  },
  settings: {
    get: () => api.get(`${apiPath}/settings`),
    // Every location the DEALS carry, with whether each is classed local.
    // Derived server side, so the list can never go stale.
    locations: () => api.get(`${apiPath}/settings/locations`),
    // The rates we set ourselves, and which source is actually in use.
    rates: () => api.get(`${apiPath}/settings/rates`),
    setRate: (code, perUsd) => api.put(`${apiPath}/settings/rates/${encodeURIComponent(code)}`, { perUsd }),
    clearRate: (code) => api.delete(`${apiPath}/settings/rates/${encodeURIComponent(code)}`),
    update: (fields) => api.patch(`${apiPath}/settings`, fields),
    burnMonth: (confirm) => api.post(`${apiPath}/settings/burn-month`, { confirm }),
    // NO `resetMasterSheet`. The Danger zone is one button ("Burn now
    // clears the deals as well"), so nothing has called it since. The route
    // is still on the server; see docs/todo.md.
  },
  logs: {
    list: ({ source, level, page, pageSize } = {}) =>
      api.get(`${apiPath}/logs${toQueryString({ source, level, page, pageSize })}`),
    count: ({ source, level } = {}) => api.get(`${apiPath}/logs/count${toQueryString({ source, level })}`),
    // Deletes one batch per call — see useLogs.js's clear(), which loops this.
    clearBatch: ({ source, level } = {}) => api.delete(`${apiPath}/logs${toQueryString({ source, level })}`),
  },
  // The CRM's own master sheet — the final, admin-polished version whatbot
  // pulls every 5 minutes and answers from. Nothing to do with `calculator`
  // below: that stays an independent consumer of its own uploaded sheet.
  masterSheet: {
    // PASSED THROUGH WHOLE, never an allowlist of names.
    //
    // This used to destructure six params, so the five added later
    // (status, shouldBePaid, paid, missingPerson, missingCompany) were
    // dropped here and every one of those filters silently did nothing.
    // Nothing failed and nothing logged: the request simply went without
    // them. An allowlist that has to be edited each time a filter is added
    // is a bug waiting for the next filter.
    //
    // toQueryString already omits undefined, so a cleared filter still
    // sends nothing.
    list: (params = {}) => api.get(`${apiPath}/master-sheet${toQueryString(params)}`),
    // What this person's OTHER deals already know about them: phone,
    // address, banking. `exclude` is the row being edited, which cannot
    // fill itself. Read only; nothing is written until the form is saved.
    personFill: (personId, exclude) => api.get(`${apiPath}/master-sheet/person-fill${toQueryString({ personId, exclude })}`),
    // One row in the shape Diane's deal card draws, for the modal a chip
    // in her list opens. The server builds it with her own `dealCard`, so
    // there is one definition of that shape rather than two.
    card: (id) => api.get(`${apiPath}/master-sheet/${id}/card`),
    create: (fields) => api.post(`${apiPath}/master-sheet`, fields),
    // `roll` is the month roll's batch id: the server logs it as one automatic change.
    update: (id, fields, { roll } = {}) => api.patch(`${apiPath}/master-sheet/${id}${roll ? `?roll=${encodeURIComponent(roll)}` : ''}`, fields),
    remove: (id) => api.delete(`${apiPath}/master-sheet/${id}`),
    // STOP IS NOT DELETE. The row stays and moves to the Archive; the
    // server dates it, because a backdated stop rewrites a paid month.
    // Deal Status is a NAME for review_monthly and end_note, neither of
    // which is hand editable, so it has its own door rather than riding on
    // the row PATCH. See configs/dealStatus.js.
    dealStatus: (id, status) => api.patch(`${apiPath}/master-sheet/${id}/deal-status`, { status }),
    stop: (id) => api.post(`${apiPath}/master-sheet/${id}/stop`),
    resume: (id) => api.post(`${apiPath}/master-sheet/${id}/resume`),
    // `via` records which document the decision was made in front of:
    // 'admin' from the table's own bulk select, 'import' from the diff's
    // delete tabs. History shows the difference.
    bulkDelete: ({ ids, via }) => api.post(`${apiPath}/master-sheet/bulk-delete`, { ids, via }),
    // One value onto many rows, from the export modal's warnings panel.
    bulkUpdate: (ids, fields) => api.post(`${apiPath}/master-sheet/bulk-update`, { ids, fields }),
    // Deals still on last month's preset; the boot screen rolls each one.
    presetRollCheck: () => api.get(`${apiPath}/master-sheet/preset-roll`),
    // Work parked for a later month. Safe to call on every sign in: the
    // QUEUE decides what runs, not the caller, so a second tab or a second
    // device finds nothing left to do. Must run AFTER the preset roll.
    runScheduled: () => api.post(`${apiPath}/scheduled-actions/run`, {}),
    scheduledActions: () => api.get(`${apiPath}/scheduled-actions`),
    // A real download, not a fetch — the browser's own save flow, built
    // fresh server-side on each request (no stored copy to go stale).
    downloadUrl: () => `${BASE_URL}${apiPath}/master-sheet/download`,
    // history is [{ role: 'user' | 'assistant', content }], the whole
    // conversation so far — the backend is stateless (see masterSheet.js).
    // `context` is Diane's selected workspace ('master-sheet' | 'expensing'
    // | 'cash' | 'bank'). The backend gives her only that workspace's
    // tools for the turn, so it decides what she can touch, not just how
    // she words things — see crm/api/v1/agent/contexts.js.
    /**
     * One turn, streamed.
     *
     * `fetch` rather than EventSource: EventSource can only GET, and the
     * history goes in the body. The response is still `text/event-stream`,
     * so it is parsed the same way, just read off the body reader.
     *
     * `onEvent` fires for every server event: `tool` (she started one),
     * `token` (more of the reply), `done` (the canonical result), `error`.
     * Resolves with the `done` payload so callers that only want the final
     * answer can ignore the rest.
     */
    agentTurn: async (history, context, onEvent) => {
      // BASE_URL like every other call: a relative path silently hits the
      // Vite dev server instead of the API whenever VITE_API_URL is set.
      const res = await fetch(`${BASE_URL}${apiPath}/master-sheet/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ history, context }),
      });

      // A failure BEFORE the stream opened is still ordinary JSON, so it is
      // thrown the way every other call's failure is.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body.error || body.message || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line, and a chunk can split
        // one in half — so only whole frames are taken and the remainder
        // stays in the buffer for the next read.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'error') {
            const err = new Error(event.message || 'Diane could not answer');
            err.status = event.status;
            throw err;
          }
          if (event.type === 'done') result = event;
          onEvent?.(event);
        }
      }

      if (!result) throw new Error('The answer ended early');
      return result;
    },
    // Real OpenAI TTS, once OPENAI_TTS_API_KEY is set server-side — see
    // useOpenaiSpeech.js for the fallback-to-SpeechSynthesis logic.
    // The messy human-made sheet, uploaded straight into the CRM — parsed
    // into master_sheet_rows on arrival. Replaces whatbot's upload-folder
    // route as the way a new sheet enters the system.
    upload: (file, onProgress) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.upload(`${apiPath}/master-sheet/import`, formData, onProgress);
    },
    // THE UPLOAD IN TWO HALVES. `preview` parses and compares and writes
    // nothing; `commit` writes only the rows that came back accepted. The
    // parsed rows travel out and back rather than being cached on the
    // server, which would be state to expire for a payload the browser is
    // holding anyway to draw the diff.
    // `defaults` is what the admin typed into the diff for columns the
    // file does not carry. Sent WITH the file so the whole parse re-runs:
    // a default that changes a group changes the row's identity, and a
    // diff patched client-side would promise something the write does not
    // do.
    importPreview: (file, onProgress, fills) => {
      const formData = new FormData();
      formData.append('file', file);
      if (fills?.defaults && Object.keys(fills.defaults).length > 0) {
        formData.append('defaults', JSON.stringify(fills.defaults));
      }
      if (fills?.overrides && Object.keys(fills.overrides).length > 0) {
        formData.append('overrides', JSON.stringify(fills.overrides));
      }
      return api.upload(`${apiPath}/master-sheet/import/preview`, formData, onProgress);
    },
    importCommit: (payload) => api.post(`${apiPath}/master-sheet/import/commit`, payload),
    speechStatus: () => api.get(`${apiPath}/master-sheet/speech/status`),
    // Whether Diane can think at all. See hooks/useAiStatus.js.
    aiStatus: () => api.get(`${apiPath}/master-sheet/ai/status`),
    speech: (text) => api.postForBlob(`${apiPath}/master-sheet/speech`, { text }),
    // Voice INPUT — a recorded clip in, the words out. Runs on the same
    // key/base URL as the chat model (Groq serves /audio/transcriptions,
    // unlike /audio/speech above, which is why this needs no extra key).
    transcribeStatus: () => api.get(`${apiPath}/master-sheet/transcribe/status`),
    transcribe: (blob) => {
      const formData = new FormData();
      // The filename carries the extension the server maps to a decoder,
      // and the blob's own type is what the browser actually recorded —
      // so it's derived here rather than hardcoded to webm.
      const ext = (blob.type.split(';')[0].split('/')[1] || 'webm').replace('x-', '');
      formData.append('audio', blob, `speech.${ext}`);
      return api.upload(`${apiPath}/master-sheet/transcribe`, formData);
    },
  },
};
