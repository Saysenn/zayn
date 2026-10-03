# calculator

Reserved for the payment-breakdown calculator — reads the sheet(s) your boss
provides, computes a full breakdown per person/company (why the total is
what it is, what deductions applied), and produces a structured xlsx the
admin views/downloads from the CRM's Breakdowns page.

Pure code, no LLM — see the architecture discussion in `docs/todo.md`'s
"Next feature: the payment calculator" section.

**Not built yet.** Blocked on two open questions:

- The day-count formula: a fixed 31-day denominator (some payroll systems
  do this deliberately) or actual calendar days for that month (28-31)?
  Needs confirming — this determines everyone's numbers, not something to
  guess at.
- The real shape of the sheet(s) your boss will send — not yet seen.

Once both are known, this folder gets the usual shape: a route file, a
`*.repo.js` for whatever gets stored (probably in `v1/repos/`, matching
where every other repo lives — only reserving this folder for the
calculator's own parsing/computation logic, not duplicating the DB-access
convention), and the xlsx read/write logic itself.


https://claude.ai/code/artifact/bb1efb8a-5a77-41e5-ae7c-e35802856f37?via=auto_preview