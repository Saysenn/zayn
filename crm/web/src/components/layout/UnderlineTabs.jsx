// Underline tabs, the one accent border the rules allow. `count` is optional
// and shown faint beside the label.
//
// `rounded-none` IS THE WHOLE POINT OF THE ACTIVE MARK. The base `button`
// rule in index.css gives every button a radius, and a 2px bottom border on a
// rounded box draws a curve up at each end: the active tab read as the lip of
// a folder rather than a line under a word. Reported 2026-09-29.
//
// `action` RIDES THE SAME RULE, hard right. A tab row is a full width line
// with a handful of words on the left of it, so the space after them is the
// most reachable empty space on the page. It sits OUTSIDE the `tablist`: a
// `role="tablist"` may only hold tabs, and a button in there is a control a
// screen reader announces as a tab that does not switch anything.
export default function UnderlineTabs({ tabs, active, onChange, action }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-border">
      <div className="scroll-slim flex min-w-0 gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => onChange(t.key)}
            className={`-mb-px shrink-0 whitespace-nowrap rounded-none border-0 border-b-2 bg-transparent px-3 py-2 text-sm transition-colors ${
              active === t.key
                ? 'border-accent-strong font-semibold text-text'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 text-xs tabular-nums text-text-faint">{t.count}</span>}
          </button>
        ))}
      </div>
      {/* Lifted off the rule by the same amount the tabs are, so the button
          and the words sit on one baseline rather than the button hanging. */}
      {action && <div className="shrink-0 pb-1.5">{action}</div>}
    </div>
  );
}
