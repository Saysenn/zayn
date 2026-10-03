/** Keep one rendered card per stable deal id during a single Diane turn. */
function unseenCards(cards, seen) {
  return (cards ?? []).filter((card) => {
    if (card?.id == null) return true;
    const key = String(card.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { unseenCards };
