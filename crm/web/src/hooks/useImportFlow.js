import { useState } from 'react';
import { useImportPreview, useCommitImport, useBulkDeleteMasterSheetRows } from './useMasterSheet';

/**
 * Picking a sheet, looking at what it would do, and applying it.
 *
 * ONE FLOW, THREE DOORS. The Master Sheet page, People and Settings all
 * upload the same file into the same table, and each had its own copy of
 * this: the same phase machine, the same "100% means the bytes are gone,
 * not that the work is done" comment, the same result banner. Three copies
 * meant the diff step could be added to one and not the others, which
 * would leave a door that still writes without asking.
 *
 * `phase` is not decoration. The browser's progress bar reaches 100% the
 * moment the bytes leave, and everything after that — parsing, folding
 * spellings, comparing a hundred rows against the table — happens
 * server-side with nothing to report. Showing "Uploading 100%" through all
 * of it reads as a hung upload, which is exactly what it looked like.
 *
 * NOTHING IS WRITTEN by handleImport. It parses and compares; the diff
 * opens for approval and `applyImport` is the only thing here that writes.
 *
 * ===============================
 * * IMPORT EVERYWHERE, EXCEPT THE ONE WORD WHATBOT OWNS
 * ===============================
 * The screen, the components, the hooks and the routes all say Import.
 *
 * That includes the stored value. `changed_via` and the bulk delete's
 * `via` both say 'import' now; migration 054 widened the CHECK and
 * rewrote the rows that already existed.
 */
/**
 * A preview with some rows taken out of its two delete lists.
 *
 * Only those two. `changed` and `new` are keyed by the FILE's rows, not by
 * database ids, so there is nothing here to match them on and nothing to
 * take out of them: see deleteRows for when that difference matters.
 */
function withoutRows(preview, gone) {
  const drop = (list) => (list ?? []).filter((r) => !gone.has(r.id));
  return {
    ...preview,
    diff: {
      ...preview.diff,
      notInFile: drop(preview.diff?.notInFile),
      inFile: drop(preview.diff?.inFile),
    },
  };
}

export function useImportFlow() {
  const importPreview = useImportPreview();
  const commitImport = useCommitImport();
  const bulkDelete = useBulkDeleteMasterSheetRows();

  // Progress only. There is no `result` or `error` here any more: both
  // fed a panel that repeated, after the fact, what the diff modal had
  // already shown before it. The outcome is a toast, from the mutations
  // themselves, so no page has to hold it.
  const [state, setState] = useState({ phase: 'idle', percent: 0 });
  const [preview, setPreview] = useState(null);
  // THE FILE IS KEPT, not just its parse.
  //
  // Filling in a column the file leaves out re-runs the whole parse rather
  // than patching the diff, because a default can change a row's GROUP and
  // the group is part of its identity: patched client-side, the modal
  // would show a row as an update while the write created it new. So the
  // File itself has to survive until the modal closes.
  const [file, setFile] = useState(null);
  // THE FILLS ARE KEPT TOO, for the same reason the file is.
  //
  // Deleting from the diff re-reads the file, and a re-read that forgot
  // what had been filled in would silently undo it: rows the admin had
  // given a group to would come back as UNKNOWN, which changes their
  // identity and therefore which side of the diff they land on.
  const [fills, setFills] = useState(undefined);
  // The delete AND the re-read that follows it, as one flag.
  //
  // Not `importPreview.isPending`: that is true for an Apply defaults
  // re-read too, which would put the delete button into "Deleting…" for an
  // action that deletes nothing.
  const [deleting, setDeleting] = useState(false);

  function preview_(chosen, nextFills, onProgress, onSettled) {
    setFills(nextFills);
    return importPreview.mutate(
      { file: chosen, fills: nextFills, onProgress },
      {
        onSuccess: (result) => {
          setState({ phase: 'idle', percent: 0 });
          setPreview(result);
          onSettled?.();
        },
        // The toast comes from useImportPreview. Resetting here is all
        // this has to do, so the button goes back to saying "Upload".
        onError: () => { setState({ phase: 'idle', percent: 0 }); onSettled?.(); },
      },
    );
  }

  function handleImport(e) {
    const chosen = e.target.files?.[0];
    // Reset the input immediately so picking the SAME file again still
    // fires onChange. Without this, a re-upload after a failed parse
    // silently does nothing.
    e.target.value = '';
    if (!chosen) return;

    setFile(chosen);
    setState({ phase: 'uploading', percent: 0 });
    preview_(chosen, undefined, (percent) => setState({
      percent,
      phase: percent >= 100 ? 'saving' : 'uploading',
    }));
  }

  /** Re-read the same file with what the admin has filled in. */
  function applyDefaults(fills) {
    if (!file) return;
    setState({ phase: 'saving', percent: 100 });
    preview_(file, fills);
  }

  /**
   * DELETING IS ITS OWN ACT, AND IT HAPPENS NOW.
   *
   * It used to travel with the commit, which meant the only way to remove
   * six finished deals was to also write every change the sheet proposed.
   * Two decisions on one button. So this writes on its own and the upload's
   * changes stay pending behind it.
   *
   * Then it RE-READS THE FILE. The diff is a comparison against the CRM and
   * the CRM just changed, so every tab, count and total is now answering
   * against a table that no longer exists. Re-running the preview is the
   * only thing that makes all of them right at once; patching the lists
   * client-side would fix the tab you are looking at and quietly leave the
   * other three wrong.
   *
   * The trade this accepts: cancelling the modal no longer undoes it. That
   * is the point of it being its own act, and the confirm says so.
   */
  /**
   * OPTIMISTIC. The rows leave the diff on the click, not on the response.
   *
   * A delete is the one action where seeing the row vanish IS the
   * confirmation, and waiting for a round trip with the row still sitting
   * there invites a second press on deals that are already gone. The tab
   * counts follow, because they are lengths of these same arrays.
   *
   * `rereadDiff` is the honest half of it. Rows off "Potentially ended deals" are
   * BY DEFINITION not in the file, so nothing else in the diff mentions
   * them and dropping them locally is not an approximation, it is the
   * whole answer. Rows off "Similar deals" ARE in the file: deleting one
   * moves it from "Existing to update" to "New incoming deals", which no
   * client-side patch can work out. That case re-reads the file.
   *
   * The old preview is kept so a refusal puts the rows back rather than
   * leaving the screen claiming a deletion that never happened.
   */
  function deleteRows(ids, { rereadDiff = false } = {}) {
    if (!ids?.length) return;
    const gone = new Set(ids);
    const restore = preview;
    setPreview((p) => (p ? withoutRows(p, gone) : p));
    setDeleting(true);
    bulkDelete.mutate({ ids, via: 'import' }, {
      onSuccess: () => {
        if (!rereadDiff || !file) return setDeleting(false);
        setState({ phase: 'saving', percent: 100 });
        preview_(file, fills, undefined, () => setDeleting(false));
      },
      onError: () => {
        // The toast comes from useBulkDeleteMasterSheetRows. This just puts
        // the screen back to what is actually true.
        setPreview(restore);
        setDeleting(false);
      },
    });
  }

  function applyImport(payload) {
    commitImport.mutate(payload, {
      onSuccess: () => { setPreview(null); setFile(null); setFills(undefined); setDeleting(false); },
    });
  }

  return {
    importState: state,
    busy: state.phase === 'uploading' || state.phase === 'saving',
    preview,
    committing: commitImport.isPending,
    // A re-preview is not the same wait as a commit, so the modal can say
    // "Reading again" rather than greying out the Confirm button.
    rereading: importPreview.isPending && Boolean(preview),
    // The whole delete, including the re-read that follows it. Both halves
    // are one flag or the tab flickers back to enabled between them and
    // invites a second press on rows that are already gone.
    deleting,
    handleImport,
    applyDefaults,
    applyImport,
    deleteRows,
    cancelPreview: () => {
      setPreview(null); setFile(null); setFills(undefined); setDeleting(false);
    },
  };
}
