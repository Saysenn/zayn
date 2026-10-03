import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../configs/api.config';
import { useUpdateSettings } from '../../hooks/useSettings';
import Button from '../buttons/Button';
import { Skeleton } from '../display/Skeleton';

/**
 * WHICH PLACES ARE LOCAL. Everything else is money being sent.
 *
 * The export's payout breakdown splits cash into what stays here and what
 * has to travel, and that rule cannot be derived: `location` is free text
 * and nothing in a row says which country it is in. Somebody has to say
 * it once per place.
 *
 * THE LIST OF PLACES IS DERIVED FROM THE DEALS, never stored, which is the
 * whole point. A location the boss invents next month appears in this card
 * by itself, so classifying it is a tick rather than something anybody has
 * to remember to add to a list. Only the ticks are saved.
 *
 * TICKED IS LOCAL. Unticked is away. The direction matters: away places
 * are open ended and unknowable, local ones are few and known, so the
 * short list is the one worth maintaining.
 */
export default function LocalLocations() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings-locations'],
    queryFn: () => apiService.settings.locations(),
  });

  const [picked, setPicked] = useState(null);
  /**
   * ===============================
   * * THROUGH THE HOOK, because a silent failure was possible here
   * ===============================
   * It called `apiService.settings.update` itself, in a try/finally with no
   * catch: a refused save put the button back and said NOTHING, leaving the
   * ticks on screen exactly as typed. That is indistinguishable from a save
   * that worked. Fixed 2026-09-29.
   *
   * THE TICKS ARE STILL A DRAFT until Save. That is deliberate and is not
   * "it has a Save button": one tick is one place out of twenty six, and
   * the export's whole local/away split moves with the SET, so it is one
   * decision made once rather than twenty six writes.
   */
  const update = useUpdateSettings();
  const saving = update.isPending;

  // Seeded from the server, then owned here until saved. Keyed on the
  // fetch so a refetch after saving does not fight what is on screen.
  useEffect(() => {
    if (!data?.locations) return;
    setPicked(new Set(data.locations.filter((l) => l.local).map((l) => l.location)));
  }, [data]);

  if (isLoading || picked === null) return <Skeleton className="h-24 w-full" />;

  const locations = data?.locations ?? [];
  if (locations.length === 0) {
    return <p className="text-sm text-text-muted">No locations on the sheet yet.</p>;
  }

  const toggle = (name) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const saved = new Set(locations.filter((l) => l.local).map((l) => l.location));
  const changed = saved.size !== picked.size || [...picked].some((p) => !saved.has(p));

  // The row counts beside each place come from this query, not from
  // settings, so the saved set has to be read back rather than patched.
  function save() {
    update.mutate({ localLocations: [...picked] }, { onSuccess: () => refetch() });
  }

  const awayCount = locations.length - picked.size;

  return (
    <div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {locations.map((l) => (
          <label key={l.location} className="flex cursor-pointer items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={picked.has(l.location)}
              onChange={() => toggle(l.location)}
              disabled={saving}
            />
            <span className="text-sm">{l.location}</span>
            {/* How much of the sheet a tick actually moves. A place on one
                row and a place on twenty-six are very different decisions
                and the name alone does not say which is which. */}
            <span className="text-[11px] text-text-faint">
              {l.rows} {l.rows === 1 ? 'row' : 'rows'}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={save} disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <span className="text-xs text-text-muted">
          {picked.size} local, {awayCount} counted as sent
        </span>
      </div>
    </div>
  );
}
