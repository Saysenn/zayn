// "2 people", "3 companies", "1 deal". The bulk bar and its toasts name
// what was ticked, and a plain "+s" wrote "persons" and "companys".
const IRREGULAR = { person: 'people', change: 'changes' };

export function pluralNoun(noun, n) {
  if (n === 1) return noun;
  if (IRREGULAR[noun]) return IRREGULAR[noun];
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

export const countOf = (n, noun) => `${n} ${pluralNoun(noun, n)}`;
