import { renderTable } from "./table.js";
import { pictureStyle } from "./style.js";
import { money, totalsByCurrency, groupName } from "../tools/format/money.js";
import { noteLines } from "../payments/elsewhere.js";

/**
 * THE PAY BREAKDOWN AS A PICTURE (his call 2026-10-07: every breakdown, any
 * number of companies). One row per assignment: company, role, payable
 * days, monthly, payable; the total underneath. Every figure is the same
 * code-made one the text breakdown shows, never the model's.
 *
 * @returns {Promise<null | { base64, mime, caption, feature }>}
 */
export async function breakdownPicture(rows, ctx) {
  if (!rows?.length) return null;
  const style = await pictureStyle();
  const month = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });
  const sorted = [...rows].sort((a, b) => String(a.company ?? "").localeCompare(String(b.company ?? "")));
  const total = totalsByCurrency(rows);
  const pngs = renderTable({
    style,
    title: `${ctx.person.personName.split(" ")[0]}'s pay · ${groupName(ctx.channelGroup)}`,
    subtitle: `${month} · ${rows.length} ${rows.length === 1 ? "deal" : "deals"}`,
    columns: [
      { label: "Company" }, { label: "Role" }, { label: "Days", align: "right" },
      { label: "Monthly", align: "right" }, { label: "Payable", align: "right" },
    ],
    sections: [{
      rows: sorted.map((a) => ({
        cells: [a.company || "Not tied to a company", a.roleLabel ?? "", String(a.payableDays ?? ""), money(a.monthlyAmount ?? 0, a.currency), money(a.payableAmount ?? 0, a.currency)],
        // a part month is the line people query: its days are marked
        tint: a.payableDays > 0 && a.payableDays < 31 ? [2] : [],
      })),
    }],
    total: { label: "Total", value: total },
    // WHERE THE REST OF THEIR PAY IS, as a tidy box under the total
    ...(noteLines(ctx).length ? { notes: { title: "Your other pay", lines: noteLines(ctx) } } : {}),
    marks: false,
  });
  if (!pngs.length) return null;
  return {
    base64: pngs[0].toString("base64"),
    mime: "image/png",
    caption: `💷 Your ${month.split(" ")[0]} ${groupName(ctx.channelGroup)} breakdown: *${total}*${noteLines(ctx).length ? `\n📍 You also have pay in ${noteLines(ctx).map((l) => `*${l.label}*`).join(", ").replace(/, ([^,]*)$/, " and $1")}: see the picture for where.` : ""}`,
    feature: "payImages",
  };
}
