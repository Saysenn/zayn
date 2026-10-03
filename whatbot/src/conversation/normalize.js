/**
 * Tidy a message before matching a pattern against it.
 *
 * Every scripted handler in this folder is a regex with literal spaces in it,
 * and `how do i  look` — typed with two spaces on a phone — matched none of
 * them. It fell through to the model and came back as "I'm not able to help
 * with that": a dead end, which is the one thing these handlers exist to
 * prevent.
 *
 * Whitespace only. No stripping punctuation, no lowercasing, no collapsing
 * repeated letters. The patterns already carry /i, and anything cleverer here
 * would quietly change what they match — these decide whether somebody in
 * trouble reaches a person, so they get to keep saying exactly what they mean.
 *
 * MATCHING ONLY. What gets recorded in the audit log, and what a person later
 * reads, must be the message they actually sent.
 */
export const forMatching = (text) => text.replace(/\s+/g, " ").trim();
