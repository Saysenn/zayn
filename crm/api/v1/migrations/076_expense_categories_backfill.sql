-- CATEGORIES FOR THE EXPENSES SAVED BEFORE THEY EXISTED (his report
-- 2026-10-07: every row read "—"). The same word rules the bot uses
-- (expenses/bot/check.js CATEGORY_WORDS, generated from it, \b as \y),
-- applied once to rows with none. A row a person set is never touched.
UPDATE tb_expenses SET category = CASE
    WHEN (coalesce(description,'') || ' ' || coalesce(payee,'')) ~* '\y(?:fuel|petrol|diesel|gas station|enoc|adnoc|eppco|emarat)\y' THEN 'fuel'
    WHEN (coalesce(description,'') || ' ' || coalesce(payee,'')) ~* '\y(?:taxi|cab|careem|uber|rta|parking|salik|train|trainline|flight|airline|emirates|flydubai|hotel|metro|bus|toll|travel)\y' THEN 'travel'
    WHEN (coalesce(description,'') || ' ' || coalesce(payee,'')) ~* '\y(?:lunch|dinner|breakfast|coffee|tea|meal|food|restaurant|cafe|starbucks|shake shack|pret|groceries|grocery|carrefour|lulu|talabat|deliveroo|water bottles?)\y' THEN 'food'
    WHEN (coalesce(description,'') || ' ' || coalesce(payee,'')) ~* '\y(?:dewa|electricity|water bill|utility|internet|du|etisalat|phone|mobile|sim|rent|bill|subscription)\y' THEN 'bills'
    WHEN (coalesce(description,'') || ' ' || coalesce(payee,'')) ~* '\y(?:office|stationery|ink|paper|printer|amazon|ikea|laptop|computer|furniture|chairs?|desk|software|equipment|supplies|cleaner|cleaning)\y' THEN 'office'
    ELSE 'other'
  END
WHERE category IS NULL;
