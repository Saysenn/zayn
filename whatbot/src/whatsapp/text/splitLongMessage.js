/**
 * WhatsApp itself allows far more than this — the cap is a readability choice,
 * not a protocol limit. A breakdown someone has to scroll through three screens
 * of is worse than two messages, and splitting also keeps each send small
 * enough to arrive reliably on a poor connection.
 */
export const MAX_BODY = 1500;

/**
 * Splits on paragraph, then line, then hard-cuts. Never mid-word if avoidable —
 * a breakdown cut through a number is worse than one extra message.
 */
export function splitMessage(text, limit = MAX_BODY) {
  if (text.length <= limit) return [text];

  const parts = [];
  let current = "";

  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };

  for (const block of text.split("\n\n")) {
    if (block.length > limit) {
      flush();
      for (const line of block.split("\n")) {
        if (line.length > limit) {
          flush();
          for (let i = 0; i < line.length; i += limit)
            parts.push(line.slice(i, i + limit));
          continue;
        }
        if (current.length + line.length + 1 > limit) flush();
        current += (current ? "\n" : "") + line;
      }
      continue;
    }

    if (current.length + block.length + 2 > limit) flush();
    current += (current ? "\n\n" : "") + block;
  }
  flush();

  if (parts.length <= 1) return parts;
  return parts.map((p, i) => `(${i + 1}/${parts.length})\n${p}`);
}
