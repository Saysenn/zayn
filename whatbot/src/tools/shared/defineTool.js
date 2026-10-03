/**
 * What a tool is.
 *
 * This lives with the tools, not with the agent, so imports only ever go one
 * way: agent/ uses tools/, never the other way round. A tool shouldn't know or
 * care that an LLM is what calls it.
 */

/**
 * What a tool gives back. THIS SPLIT IS THE WHOLE SECURITY MODEL.
 *
 *   summary  -> goes to the LLM. "Returned 12 people (paid by cash)."
 *   display  -> goes straight to the user, untouched. the LLM never sees it.
 *
 * Anything with a number or a name in it goes in `display`. If the LLM gets
 * hold of figures it will eventually retype one of them wrong, and a wrong
 * payslip looks exactly as convincing as a right one.
 */

/**
 * A file to send alongside the reply.
 *
 * Described here rather than in `whatsapp/` so a tool can build one without
 * knowing what channel it goes out on — imports flow channels -> tools, and a
 * tool that imported the socket would turn that round.
 *
 * It follows the `display` rule exactly: built in code, never seen by the LLM.
 * A file is only another container for figures, and a wrong figure is no less
 * wrong for being in a spreadsheet. It is more permanent, though — a document
 * persists on the device and in whatever backs it up — so it is only ever
 * built for the verified sender, from rows already scoped to them.
 */

/** does nothing at runtime. it's here so TypeScript can work out the arg types. */
export function defineTool(def) {
  return def;
}

/** get this tool's schema for this person — the per-caller one if it has one */
export async function schemaOf(tool, ctx) {
  return tool.schemaFor ? await tool.schemaFor(ctx) : tool.schema;
}
