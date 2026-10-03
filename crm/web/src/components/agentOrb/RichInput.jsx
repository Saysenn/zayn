import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  BoldIcon, ItalicIcon, UnderlineIcon,
  BulletListIcon, NumberListIcon, ClearFormatIcon,
} from '../icons';

/**
 * Diane's message box — a small rich text editor, Gmail-shaped but cut
 * down to what's actually useful when you're answering questions about
 * spreadsheet rows: bold, italic, underline, bulleted and numbered lists,
 * and a way to strip formatting back off.
 *
 * ---- why contentEditable and execCommand ----
 * `document.execCommand` is formally deprecated and still the only thing
 * every browser implements for this. The alternative is a full editor
 * library (Slate, Lexical, TipTap) — hundreds of kilobytes for six
 * buttons, on a page that already ships Three.js. If a browser ever drops
 * it, the fallback degrades to plain typing, which is exactly where this
 * started, so the downside is bounded.
 *
 * ---- what gets sent ----
 * Diane reads plain text. The formatting isn't discarded, though: it's
 * SERIALIZED (see toPlainText) — a bulleted list becomes "- item" lines, a
 * numbered list becomes "1. item" lines, bold becomes **bold**. So the
 * structure you type is structure the model actually receives, rather than
 * markup that gets stripped at the door.
 */

// Enter sends; Shift+Enter is a new line, or the next item inside a list.
// That's the messaging convention, and it's the one a person reaching for
// this box already has in their fingers.
const TOOLS = [
  { key: 'bold', cmd: 'bold', Icon: BoldIcon, label: 'Bold', shortcut: 'Ctrl+B' },
  { key: 'italic', cmd: 'italic', Icon: ItalicIcon, label: 'Italic', shortcut: 'Ctrl+I' },
  { key: 'underline', cmd: 'underline', Icon: UnderlineIcon, label: 'Underline', shortcut: 'Ctrl+U' },
  { key: 'insertUnorderedList', cmd: 'insertUnorderedList', Icon: BulletListIcon, label: 'Bulleted list' },
  { key: 'insertOrderedList', cmd: 'insertOrderedList', Icon: NumberListIcon, label: 'Numbered list' },
  { key: 'removeFormat', cmd: 'removeFormat', Icon: ClearFormatIcon, label: 'Clear formatting', noState: true },
];

/**
 * The editor's DOM -> the plain text Diane receives.
 *
 * Walks the tree rather than using innerText, because innerText flattens a
 * list into bare lines and loses the one piece of structure most worth
 * keeping: that they WERE a list, and in what order.
 */
function toPlainText(root) {
  const out = [];

  function walk(node, listCtx) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push(child.nodeValue);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();

      if (tag === 'br') { out.push('\n'); continue; }

      if (tag === 'ul' || tag === 'ol') {
        if (out.length && !/\n$/.test(out[out.length - 1])) out.push('\n');
        walk(child, { ordered: tag === 'ol', index: 1 });
        continue;
      }

      if (tag === 'li') {
        const marker = listCtx?.ordered ? `${listCtx.index++}. ` : '- ';
        out.push(marker);
        walk(child, null);
        out.push('\n');
        continue;
      }

      // Inline emphasis survives as markdown — meaningful to the model,
      // and it round-trips back to something a person would recognise.
      const wrap =
        tag === 'b' || tag === 'strong' ? '**'
          : tag === 'i' || tag === 'em' ? '*'
            : tag === 'u' ? '__'
              : null;

      if (wrap) {
        out.push(wrap);
        walk(child, listCtx);
        out.push(wrap);
        continue;
      }

      // Block-level anything else (div, p) ends a line.
      const block = tag === 'div' || tag === 'p';
      walk(child, listCtx);
      if (block && out.length && !/\n$/.test(out[out.length - 1])) out.push('\n');
    }
  }

  walk(root, null);

  return out
    .join('')
    .replace(/ /g, ' ')   // execCommand leaves non-breaking spaces behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const RichInput = forwardRef(function RichInput(
  {
    onChange,
    onSubmit,
    disabled = false,
    placeholder = 'Type or speak your command…',
    before = null, // rendered left of the box, bottom-aligned (the mic)
    after = null,  // rendered right of it (level meter, send, expand)
    // Kept short on purpose. Everything above this box — the orb, the
    // status line, the transcript strip — shares the same column, so every
    // line the input grows is a line taken off the orb. At 11rem a long
    // message visibly shrank Diane. Three lines covers almost every reply,
    // and past that it scrolls instead of pushing.
    maxHeight = '4.5rem',
  },
  ref,
) {
  const editorRef = useRef(null);
  const [active, setActive] = useState({});
  const [empty, setEmpty] = useState(true);

  // Which buttons should look pressed, for wherever the caret currently
  // is. queryCommandState throws in some embedded contexts, hence the
  // guard rather than a bare call.
  const refreshActive = useCallback(() => {
    const next = {};
    for (const t of TOOLS) {
      if (t.noState) continue;
      try {
        next[t.key] = document.queryCommandState(t.cmd);
      } catch {
        next[t.key] = false;
      }
    }
    setActive(next);
  }, []);

  /**
   * KEEP THE CARET IN VIEW as the box fills up.
   *
   * The editor scrolls once it reaches `maxHeight`, and a browser only
   * scrolls a contentEditable to the caret for its own key handling: a line
   * added by `insertParagraph` or by dictation lands below the fold and the
   * next thing typed is invisible. Scrolling to the BOTTOM instead would
   * fight anyone editing higher up, so it moves by the overflow only.
   */
  const keepCaretVisible = useCallback(() => {
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const caret = range.getClientRects()[0];
    // An empty line has no rect of its own. The caret is at the end there
    // by definition, so the bottom is the right answer.
    if (!caret) { el.scrollTop = el.scrollHeight; return; }

    const box = el.getBoundingClientRect();
    if (caret.bottom > box.bottom) el.scrollTop += caret.bottom - box.bottom;
    else if (caret.top < box.top) el.scrollTop -= box.top - caret.top;
  }, []);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = toPlainText(el);
    setEmpty(text.length === 0);
    onChange?.(text);
    keepCaretVisible();
  }, [onChange, keepCaretVisible]);

  useImperativeHandle(ref, () => ({
    clear() {
      const el = editorRef.current;
      if (!el) return;
      el.innerHTML = '';
      setEmpty(true);
      onChange?.('');
    },
    focus() {
      editorRef.current?.focus();
    },
    // Used by voice input: a transcript is plain text, and it should land
    // in the box as if it had been typed rather than replacing whatever is
    // already there.
    append(text) {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      document.execCommand('insertText', false, text);
      emit();
    },
  }), [emit, onChange]);

  function run(cmd) {
    // Focus first — execCommand acts on the current selection, and if the
    // toolbar button took focus there is no selection in the editor to act
    // on. onMouseDown's preventDefault below is what stops that happening,
    // and this is the belt to its braces.
    editorRef.current?.focus();
    document.execCommand(cmd, false, null);
    refreshActive();
    emit();
  }

  // Is the caret inside a list item of THIS editor? Walks up from the
  // selection rather than trusting queryCommandState, which reports "in a
  // list" for the whole block and can't tell you about the current line.
  function inListItem() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node = sel.anchorNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'LI') return true;
      node = node.parentNode;
    }
    return false;
  }

  function handleKeyDown(e) {
    // The shortcuts browsers already map to execCommand work for free.
    // Enter is the one that needs taking over.
    if (e.key !== 'Enter') return;

    if (e.shiftKey) {
      // Inside a list, the browser's own Shift+Enter inserts a <br> —
      // a second line INSIDE the current bullet, with no new marker. That
      // reads as "the bullet didn't appear", which is exactly the bug. In
      // a list we want a new item, and `insertParagraph` is what makes
      // one; outside a list the default line break is right.
      if (inListItem()) {
        e.preventDefault();
        document.execCommand('insertParagraph', false, null);
        emit(); // also scrolls the new item into view
      }
      return;
    }

    e.preventDefault();
    onSubmit?.();
  }

  // Pasting rich content from elsewhere would drag in fonts, colours and
  // background styles from whatever it came from. Plain text only.
  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emit();
  }

  // ABOVE THE PILL AND OUTSIDE IT. It sat inline beside the editor, which
  // put six buttons on top of the text you were typing. The pill holds the
  // controls that belong to a message (talk, send, read it all); the
  // formatting sits over it, where an editor's toolbar goes.
  const toolbar = (
    <div className="flex items-center justify-end gap-0.5 px-2">
      {TOOLS.map(({ key, cmd, Icon, label, shortcut }) => (
        <button
          key={key}
          type="button"
          // The critical line in this component. Without it the mousedown
          // moves focus out of the editor, the selection collapses, and
          // every button silently does nothing.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run(cmd)}
          disabled={disabled}
          title={shortcut ? `${label} (${shortcut})` : label}
          aria-label={label}
          aria-pressed={Boolean(active[key])}
          className={`w-7 h-7 min-h-0 p-0 flex items-center justify-center border-0 bg-transparent transition-colors disabled:opacity-30 ${
            active[key] ? 'text-diane-signal' : 'text-diane-dim/45 hover:text-diane-signal'
          }`}
        >
          <Icon width={15} height={15} />
        </button>
      ))}
    </div>
  );

  // The controls live on the SAME row as the editor, passed in rather than
  // placed around this component: the mic and send buttons have to
  // bottom-align with a box whose height changes as you type, and only
  // whatever owns that row can do that.
  // CENTRED, not bottom aligned. The mic and the send button sat on the
  // pill's floor, so a box that had grown to three lines left them pinned
  // under one edge of it rather than beside the message.
  const row = (
    <div className="flex items-center gap-2 sm:gap-3">
      {before}

      <div className="relative flex-1 min-w-0">
        <div
          ref={editorRef}
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-label="Message Diane"
          suppressContentEditableWarning
          onInput={emit}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onFocus={refreshActive}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          // NOT `agent-scroll`: that STYLES a scrollbar, and a bar down the
          // middle of a rounded pill is the one place in this UI that
          // cannot carry one. The editor hides its own and keeps the caret
          // in view instead. See index.css.
          className="diane-editor w-full bg-transparent text-white text-sm leading-relaxed focus:outline-none overflow-y-auto py-2"
          style={{ minHeight: '2.25rem', maxHeight }}
        />

        {/* A real element rather than CSS ::before on [contenteditable]:
            empty, because that selector misses the case where the editor
            holds an empty <div> or <br> — which is exactly what
            execCommand leaves behind after clearing a list. */}
        {empty && (
          <p className="absolute left-0 top-2 pointer-events-none truncate max-w-full text-white/25 text-sm leading-relaxed m-0">
            {placeholder}
          </p>
        )}
      </div>

      {after}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {toolbar}
      {/* THE PILL IS THE MESSAGE BOX, so its outline lives here rather than
          on the form around it: the toolbar has to sit outside that outline
          and only whatever draws it can say where the edge is. */}
      <div className="rounded-full border border-diane-line/40 bg-diane-sunken/70 px-2.5 py-2">
        {row}
      </div>
    </div>
  );
});

export default RichInput;
