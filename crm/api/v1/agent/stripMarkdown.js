/**
 * Strips markdown formatting out of the agent's reply before it reaches
 * the chat bubble.
 *
 * The model isn't told to write markdown, but chat-completion models default
 * to it whether asked or not — same problem whatbot's own noDashes.js exists
 * for (one dash and the reply reads like a machine wrote it), just a
 * different tell. The overlay renders the reply as plain text, so a raw
 * `**bold**` shows its own asterisks instead of ever becoming bold.
 *
 * Only strips the markup — the words inside survive, so "**Gloria**" becomes
 * "Gloria", not nothing.
 */
function stripMarkdown(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '') // # Heading
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, '').trim()) // ```code```
    .replace(/`([^`]+)`/g, '$1') // `code`
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1') // ***bold italic***
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1') // *italic*
    .replace(/__([^_]+)__/g, '$1') // __bold__
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1') // _italic_
    // Keep a real plain-text bullet because the chat bubble supports it and
    // computed money answers use it for scannable deal breakdowns. Strip only
    // markdown list markers, which would otherwise show as formatting noise.
    .replace(/^[ \t]*[-*+][ \t]+/gm, '') // - bullet / * bullet / + bullet
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '') // 1. numbered
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    // A sentence running straight into the next one with no space
    // ("...as listed.Whenever you're ready"). Comes from the model
    // joining two blocks, and it reads as a typo in the chat bubble.
    // Deliberately narrow: a full stop, question or exclamation mark
    // directly against a capital, which no normal abbreviation produces.
    .replace(/([.!?])([A-Z])/g, '$1 $2')
    .trim();
}

module.exports = { stripMarkdown };
