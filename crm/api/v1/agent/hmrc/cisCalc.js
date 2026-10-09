// ***************************************************
// * A CIS DEDUCTION, WORKED OUT IN CODE (never by the model)
// ***************************************************
//
// HMRC's rule (CIS 340, "Make deductions and pay subcontractors"): the
// deduction is taken from the LABOUR part of the payment only. Take off VAT
// first (amounts here already exclude it), then the cost of materials,
// equipment/plant hire, fuel used (not travel) and the CITB levy the
// subcontractor paid for this job. Rates: 20% registered and verified,
// 30% not registered or not verifiable, 0% with gross payment status.

const RATE = { registered: 0.2, unregistered: 0.3, gross: 0 };
const pence = (x) => Math.round(Number(x) * 100) / 100;

function cisDeduction({ gross, materials = 0, status = 'registered' }) {
  const g = Number(gross);
  const m = Math.max(0, Number(materials ?? 0));
  if (!Number.isFinite(g) || g < 0) return { error: 'gross must be an amount of 0 or more' };
  if (!(status in RATE)) return { error: `status must be one of ${Object.keys(RATE).join(', ')}` };
  const labour = Math.max(0, g - Math.min(m, g));
  const rate = RATE[status];
  const deduction = pence(labour * rate);
  return {
    gross: pence(g),
    materials: pence(Math.min(m, g)),
    labour: pence(labour),
    rate: `${rate * 100}%`,
    deduction,
    netPayment: pence(g - deduction),
    note: 'Amounts exclude VAT. The deduction is paid to HMRC by the 22nd (electronic) after the tax month ends on the 5th, and shown on the monthly CIS return and the subcontractor\'s payment and deduction statement.',
  };
}

module.exports = { cisDeduction, RATE };
