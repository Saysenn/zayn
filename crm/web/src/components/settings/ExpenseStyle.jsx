import { apiService } from '../../configs/api.config';
import { useImageBlob } from '../../hooks/useImageBlob';
import { Skeleton } from '../display/Skeleton';

/**
 * HOW AN EXPENSE PREVIEW LOOKS, on WhatsApp and in Diane's chat.
 *
 * His call 2026-10-07: a clean sheet in the master sheet export's Blue white,
 * or a handwritten note, or plain text. Each card shows the real picture,
 * drawn by the CRM from the same sample expenses, so what is picked here is
 * exactly what an admin receives.
 */
const STYLES = [
  { key: 'sheet', label: 'Clean sheet', note: 'A table like the master sheet export' },
  { key: 'notebook', label: 'Notebook', note: 'A handwritten note on ruled paper' },
  { key: 'text', label: 'Plain text', note: 'No picture, one field per line' },
];

const TEXT_SAMPLE = `*4 EXPENSES · MANBAT*
_Not saved yet_
==================
*1.* Taxi to office
• Date: Mon 6 Oct 2026
• Amount: *AED 45.00*
• Paid to: Careem
• Spent by: Sara K
…
*TOTAL:* *AED 2,465.00* + *GBP 86.40*

Reply *yes* to save · *modify* · *cancel*`;

function Preview({ style }) {
  const { url, isLoading, isError } = useImageBlob(['expense-style-preview', style], () => apiService.expenseStyle.preview(style), { enabled: style !== 'text' });
  if (style === 'text') {
    return <pre className="h-full overflow-hidden whitespace-pre-wrap bg-surface p-3 font-sans text-[10px] leading-snug text-text-muted">{TEXT_SAMPLE}</pre>;
  }
  if (isError) return <p className="p-3 text-xs text-text-muted">Preview unavailable.</p>;
  if (isLoading || !url) return <Skeleton className="h-full w-full" />;
  return <img src={url} alt="" className="h-full w-full object-cover object-top" />;
}

export default function ExpenseStyle({ value, onChange, disabled, isLoading }) {
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Expense message style">
      {STYLES.map((s) => {
        const active = (value ?? 'sheet') === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(s.key)}
            className={`flex min-h-0 flex-col overflow-hidden rounded-lg border p-0 text-left transition-colors disabled:opacity-60 ${
              active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-text-faint'
            }`}
          >
            <div className="h-36 w-full overflow-hidden border-b border-border bg-surface-sunken">
              <Preview style={s.key} />
            </div>
            <div className={`flex w-full items-start justify-between gap-2 px-3 py-2 ${active ? 'bg-accent-tint' : 'bg-surface'}`}>
              <span>
                <span className={`block text-sm font-semibold ${active ? 'text-accent-strong' : 'text-text'}`}>{s.label}</span>
                <span className="block text-[11px] text-text-muted">{s.note}</span>
              </span>
              {active && <span className="mt-0.5 shrink-0 text-[11px] font-semibold text-accent-strong">In use</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
