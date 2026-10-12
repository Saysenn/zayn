# Courier delivery pay — not built

Some employees are paid in cash, delivered by a courier who is paid by distance.

**Exists:** `payment_method` (`bank` / `cash` / `crypto`), the `courier` role, filtering by both.
**Missing:** postcodes, deliveries or rounds, and which courier delivers to whom.

## Questions to settle first

1. **Distance from where?** Courier's postcode, a depot, or the previous drop?
2. **One drop or a round?** Separate distances added up, or one optimised route (much
   bigger job, Directions API with waypoints)?
3. **Distance → money?** Per mile, banded, flat + mileage, minimums, per-drop amounts?
4. **Driving or straight line?** Driving (Distance Matrix API) is real but paid per lookup;
   straight line is free but 15–30% under — not defensible for a per-mile rate.
5. **Who asks?** Courier, manager or finance — decides chat tool vs scheduled job vs report.
6. **Who assigns deliveries?** Without a list, there is nothing to add up.

## Likely shape

```
postcode (employee) + courier_code or round_id  →  distance per postcode pair (cached)
  →  rule  →  pay per drop  →  sum per courier per period
```

- Cache each postcode pair once, both directions — lookups cost money.
- Validate postcodes at sync; reject ones that will not geocode.
- Not a route planner. That is a separate product.

## Before building

- [ ] Answers to the six questions
- [ ] `postcode` column, validated
- [ ] Google Maps key with billing and a quota cap
- [ ] One real worked example from payroll to check the rule against
