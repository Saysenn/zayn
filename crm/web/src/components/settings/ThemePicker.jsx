import { THEMES, THEME_IDS } from '../../configs/themes';
import { useTheme } from '../../hooks/useTheme';
import { CheckIcon } from '../icons';

// ***************************************************
// * The five themes, as swatches. One click recolours everything at once.
// ***************************************************
// SILENT, a decision: the whole screen changing colour is the confirmation,
// and a toast saying so would sit on top of it.

export default function ThemePicker() {
  const { themeId, setTheme } = useTheme();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" role="radiogroup" aria-label="Theme">
      {THEME_IDS.map((id) => {
        const theme = THEMES[id];
        const chosen = id === themeId;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => setTheme(id)}
            className={`block min-h-0 w-full rounded-lg border bg-surface p-2 text-left transition ${
              chosen ? 'border-accent-strong ring-2 ring-accent-strong/30' : 'border-border hover:border-border-strong'
            }`}
          >
            {/* Its own colours, whatever theme is showing: the pale fill, the strong step and the tint. */}
            <span className="flex h-12 w-full overflow-hidden rounded-md" aria-hidden="true">
              <span className="flex-[3]" style={{ background: theme.accent.DEFAULT }} />
              <span className="flex-[2]" style={{ background: theme.accent.strong }} />
              <span className="flex-1" style={{ background: theme.accent.tint }} />
            </span>
            <span className="mt-2 flex w-full items-center justify-between gap-1 text-sm font-medium">
              {theme.label}
              {chosen && <CheckIcon width={15} height={15} className="text-accent-strong" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
