/** how long we remember who someone is, and what they were asking about */
export const sessionConfig = {
  /** once we know which employee a number belongs to, cache it this long */
  identityTtlSeconds: 12 * 60 * 60,
  /** conversation history is forgotten after this */
  conversationTtlSeconds: 30 * 60,
};
