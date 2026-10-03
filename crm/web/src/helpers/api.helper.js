export const BASE_URL = import.meta.env.VITE_API_URL || '';

// Every list endpoint builds a "?a=b&c=d" from a handful of optional
// filters the same way — one function instead of a URLSearchParams block
// repeated per call site in api.config.js.
export function toQueryString(params = {}) {
  const qp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') qp.set(key, value);
  }
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: 'include', // send the httpOnly session cookie
    ...options,
    // merged last: options.headers is undefined on every call site here, and
    // spreading it before this would silently wipe out Content-Type below
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    // Carried through so callers can tell WHICH failure this was. Diane
    // replaces most errors with an in-character excuse, but a rate limit
    // has a real, actionable message ("frees up in about 3m30s") that she
    // was discarding in favour of "I didn't quite catch that" — telling
    // the admin their perfectly clear question was the problem.
    err.status = res.status;
    // A 409 from a create carries the rows that made it a duplicate, so
    // the page can offer "open that one" instead of only saying no.
    if (Array.isArray(body.matches)) err.matches = body.matches;
    // The secret code step says when the pending ticket is gone, so the
    // login card drops back to username and password rather than asking
    // for a code into a ticket that no longer exists.
    if (body.restart) err.restart = true;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// express.json()'s strict mode rejects a bare "null" body, so only
// stringify when there's an actual body to send
const jsonBody = (body) => (body != null ? JSON.stringify(body) : undefined);

// A multipart upload can't go through request() — that function always
// forces `Content-Type: application/json`, which breaks a FormData body:
// the browser needs to set its own Content-Type (with the multipart
// boundary) when the body is a FormData. And it needs real progress, which
// `fetch` has no clean event for on the upload side — only XHR exposes
// `upload.onprogress`, so this uses XHR instead of `request()`'s fetch,
// deliberately, just for this one call.
function uploadRequest(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${path}`);
    xhr.withCredentials = true; // send the httpOnly session cookie, same as credentials: 'include'

    xhr.upload.onprogress = (e) => {
      // lengthComputable can be false (chunked transfer, some proxies) —
      // no percentage to report then, caller stays on its own fallback state
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Request failed: ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

/**
 * A file download that REPORTS ITSELF, instead of navigating away.
 *
 * `window.location.href = url` hands the whole thing to the browser: the
 * page cannot know it started, cannot know it finished, and shows nothing
 * while the server works. An export that builds five workbooks and zips
 * them takes seconds, and with the modal closed behind it the screen just
 * sat there looking broken.
 *
 * XHR rather than fetch, for the same reason uploadRequest uses it: only
 * XHR gives progress events without hand-rolling a stream reader.
 *
 * TWO PHASES, because they are genuinely different waits. Nothing is
 * measurable while the server builds, so that one is honest about being
 * indeterminate rather than showing a bar creeping to 90% and stopping.
 *
 *   'building'     request sent, no bytes back yet
 *   'downloading'  bytes arriving, with a real percentage
 *
 * The FILENAME comes from the server's own Content-Disposition. Rebuilding
 * it here would be a second implementation of exportFileName that drifts
 * the first time either changes.
 */
function downloadRequest(path, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${BASE_URL}${path}`);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';

    onProgress?.({ phase: 'building', percent: 0 });
    xhr.onprogress = (e) => {
      // Chunked responses have no total. The server sets Content-Length on
      // every export precisely so this is computable; if it ever is not,
      // stay on the indeterminate phase rather than invent a number.
      if (!e.lengthComputable || !e.total) return;
      onProgress?.({ phase: 'downloading', percent: Math.round((e.loaded / e.total) * 100) });
    };

    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        // The error body is JSON even though we asked for a blob, so it
        // has to be read back as text to recover the message and its ref.
        let message = `Request failed: ${xhr.status}`;
        try {
          const parsed = JSON.parse(await xhr.response.text());
          if (parsed.error) message = parsed.error;
        } catch { /* not JSON: keep the status */ }
        const err = new Error(message);
        err.status = xhr.status;
        return reject(err);
      }
      const disposition = xhr.getResponseHeader('Content-Disposition') ?? '';
      const match = disposition.match(/filename="([^"]+)"/);

      /**
       * WHAT IS IN THE FILE, FROM THE SERVER THAT BUILT IT.
       *
       * Diane announced a 21 row bank run as "3 rows, 3 people": the
       * previous export's figures, read from a client cache that had not
       * caught up. Any count derived on this side can go stale; this one
       * is computed from the rows the workbook was built from.
       *
       * Null when the header is absent, never 0. A missing count and a
       * genuinely empty file must not read the same.
       */
      const num = (name) => {
        const raw = xhr.getResponseHeader(name);
        const n = Number(raw);
        return raw !== null && Number.isFinite(n) ? n : null;
      };

      resolve({
        blob: xhr.response,
        filename: match?.[1] ?? 'export',
        rows: num('X-Row-Count'),
        people: num('X-People-Count'),
      });
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

/**
 * ***************************************************
 * * Hand a downloaded blob over as a file
 * ***************************************************
 *
 * TWO WAYS, and the good one is only sometimes there.
 *
 * A plain `<a download>` cannot choose where the file lands: the browser's
 * own download folder decides, and the page is never told where it went.
 * `showSaveFilePicker` opens the real Save dialogue, so the admin picks the
 * folder and the name, which is what was actually asked for. It exists in
 * Chromium browsers and in a secure context only, so the anchor stays as
 * the fallback rather than being replaced.
 *
 * CANCELLING IS NOT A FAILURE. Closing the dialogue throws `AbortError`,
 * and treating that as an error would tell somebody their export broke
 * when they changed their mind. It resolves false, and the caller says
 * nothing.
 *
 * @returns {Promise<boolean>} whether the file was actually saved.
 */
const canPickFolder = () => typeof window !== 'undefined'
  && typeof window.showSaveFilePicker === 'function'
  && window.isSecureContext;

async function saveBlob(blob, filename) {
  if (canPickFolder()) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: filename,
        // The extension the server named it with, so the dialogue offers
        // the right filter rather than "All files".
        types: extensionType(filename),
      });
    } catch (err) {
      // They closed the dialogue. Nothing went wrong, nothing was saved.
      if (err?.name === 'AbortError') return false;
      // Anything else (a policy blocking the picker, an odd embed) falls
      // through to the anchor rather than losing the file.
      handle = null;
    }

    if (handle) {
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return true;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Appended before the click: a detached anchor is ignored by Firefox,
  // and revoked on the NEXT TICK, because Firefox also cancels an
  // in-flight download if the URL dies in the same frame as the click.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

// The picker wants a MIME type per extension. Only the ones this app
// actually hands over; an unknown one gets no filter, which is correct
// rather than wrong.
const PICKER_TYPES = {
  xlsx: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
  zip: { 'application/zip': ['.zip'] },
  pdf: { 'application/pdf': ['.pdf'] },
  txt: { 'text/plain': ['.txt'] },
};

function extensionType(filename) {
  const ext = String(filename).split('.').pop()?.toLowerCase();
  const accept = PICKER_TYPES[ext];
  return accept ? [{ description: `${ext.toUpperCase()} file`, accept }] : [];
}

// For an endpoint whose real response isn't JSON (the TTS route returns
// raw mp3 bytes) — request() always calls .json(), which would throw on
// audio. Returns a Blob the caller can hand straight to an <audio> element
// via a blob URL.
async function postForBlob(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: jsonBody(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed: ${res.status}`);
  }
  return res.blob();
}

const api = {
  get: (path, headers) => request(path, { headers }),
  post: (path, body, headers) => request(path, { method: 'POST', body: jsonBody(body), headers }),
  put: (path, body, headers) => request(path, { method: 'PUT', body: jsonBody(body), headers }),
  patch: (path, body, headers) => request(path, { method: 'PATCH', body: jsonBody(body), headers }),
  delete: (path, headers) => request(path, { method: 'DELETE', headers }),
  upload: uploadRequest,
  download: downloadRequest,
  postForBlob,
};

export { api, saveBlob };


