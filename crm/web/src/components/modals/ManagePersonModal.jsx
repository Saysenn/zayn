import { useState } from 'react';
import { usePerson, useUpdatePerson, useAddDeal, usePeopleFilters } from '../../hooks/usePeople';
import { useNotifications } from '../../hooks/useNotifications';
import Modal from './Modal';
import FloatingField from '../forms/FloatingField';
import Button from '../buttons/Button';
import DealsEditor from '../forms/DealsEditor';
import { Skeleton } from '../display/Skeleton';

/**
 * One person, everything an admin changes about them, in one modal.
 *
 * ONE MODAL, NOT TWO. Editing a person and assigning them to a company
 * were separate dialogs behind separate buttons, and they are the same
 * job: you open a person to fix what is wrong about them, and "they are
 * on the wrong company" is one of the things that can be wrong. Two
 * buttons meant deciding which dialog held the field you wanted before
 * you could look for it.
 *
 * The two halves stay visibly separate inside it, because they write to
 * different places: the details are tb_people's own three columns, the
 * companies are rows of tb_mastersheet. Only the details need a Save —
 * company edits are already live, which is why the footer says so
 * rather than implying one button covers both.
 *
 * Opened from a People row (where there is no page to go to first) and
 * from the person's own page.
 */
export default function ManagePersonModal({ personId, onClose }) {
  const { data: person, isLoading } = usePerson(personId);
  const { data: options } = usePeopleFilters();
  const updatePerson = useUpdatePerson();
  const addDeal = useAddDeal();
  const { notify } = useNotifications();

  const [form, setForm] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Seeded once the person lands, rather than from a prop: this modal
  // opens straight off a list row, which carries the aggregate and not
  // the profile fields.
  if (person && form === null) {
    setForm({
      displayName: person.display_name ?? '',
      email: person.email ?? '',
      notes: person.notes ?? '',
    });
  }

  const deals = person?.deals ?? [];

  function saveDetails() {
    updatePerson.mutate(
      { personId, fields: form },
      {
        // The hook reports it, from `fields.displayName`. See useUpdatePerson.
        onSuccess: onClose,
      },
    );
  }

  return (
    <Modal wide title={person ? `Manage ${person.display_name}` : 'Manage person'} onClose={onClose}>
      {isLoading || !form ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2.5 text-sm font-semibold">Details</h3>
            <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2">
              <FloatingField label="Display name" required filled={Boolean(form.displayName)}>
                <input className="form-control" placeholder="Display name" value={form.displayName}
                  onChange={(e) => set('displayName', e.target.value)} />
              </FloatingField>
              <FloatingField label="Email" filled={Boolean(form.email)}>
                <input className="form-control" type="email" placeholder="Email" value={form.email}
                  onChange={(e) => set('email', e.target.value)} />
              </FloatingField>
              <FloatingField label="Notes" filled={Boolean(form.notes)} className="sm:col-span-2">
                <textarea className="form-textarea" rows={2} placeholder="Notes"
                  value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </FloatingField>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <DealsEditor
              mode="person"
              subjectName={person.display_name}
              deals={deals}
              options={options}
              adding={addDeal.isPending}
              onAdd={(deal, { onDone, onFail }) =>
                addDeal.mutate(
                  { personId, deal: { ...deal, personName: person.display_name } },
                  {
                    onSuccess: () => {
                      notify({ level: 'success', message: `${person.display_name} added to ${deal.company}` });
                      onDone();
                    },
                    onError: (err) => onFail(err.message),
                  },
                )
              }
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            {/* Said out loud, because the Save button sitting beside them
                implies it covers them too. */}
            <p className="text-xs text-text-muted">
              Company changes above are saved already.
            </p>
            <div className="flex gap-2">
              <Button onClick={onClose}>Close</Button>
              <Button
                variant="primary"
                onClick={saveDetails}
                disabled={!form.displayName.trim() || updatePerson.isPending}
              >
                {updatePerson.isPending ? 'Saving…' : 'Save details'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
