# Courier delivery pay — not built

Some employees are paid in **cash**. A courier delivers that cash to their postcode. The
courier is paid based on the distance covered.

This is the design outline and, more importantly, the questions that have to be answered
before any of it is written. The code is straightforward; the pricing rule is not, and
getting it wrong means paying people the wrong amount.

---

## What exists already

- `payment_method` per employee — `bank` / `cash` / `crypto`
- `role` — `courier` is already a role
- The bot can already answer "who is paid in cash" and filter by role

## What is missing

- **Postcodes.** Not in the sheet yet. Needed for the employee (destination) and probably
  for the courier (origin).
- Any notion of a delivery, a round, or distance
- Any link between a courier and the people they deliver to

---

## Questions to settle first

**1. Distance from where?**

- The courier's own postcode?
- A depot or office?
- The previous drop on the round?

Each gives a different number for the same day's work.

**2. One drop, or a round?**

If a courier delivers to eight people in a day:

- Eight separate origin→destination distances, added up? Or
- One optimised route, where total mileage is what counts?

These differ by a lot. Route optimisation is also a much larger piece of work — it needs the
Directions API with waypoints, and the ordering problem gets expensive above ~10 stops.

**3. How does distance become money?**

- Per mile — what rate?
- Banded — 0–5 miles £X, 5–10 miles £Y?
- Flat fee plus mileage?
- Is there a minimum per drop, or per day?
- Does the number of drops matter as well as the distance?

**4. Driving distance or straight line?**

| | Accuracy | Cost |
|---|---|---|
| Driving (Distance Matrix API) | real roads, real distance | paid per lookup |
| Straight line (haversine) | 15–30% under on real journeys | free, no API |

Straight line is defensible for a rough allowance. It is not defensible if couriers are being
paid a per-mile rate they can check against their odometer.

**5. Who asks, and when?**

- A courier: "what did I earn this month?"
- A manager: "what will tomorrow's round cost?"
- Finance: "what do we owe the couriers this period?"

This decides whether it is a chat tool, a scheduled job, or a report — and whether it needs to
work on planned rounds or only completed ones.

**6. Who assigns deliveries?**

Is there a list somewhere of which courier delivers to whom, or is that decided on the day?
Without it, the system cannot know whose distances to add up.

---

## Likely shape, once the above is answered

```
sheet gains:  postcode (employee) · courier_code or round_id
                ↓
postcode pair → distance          cached, computed once
                ↓
distance + rule → pay per drop
                ↓
sum per courier per period
```

### Caching is not optional

Postcodes rarely change, and Maps API calls cost money per lookup. A distance between two
postcodes should be computed **once** and stored — keyed on the postcode pair — not looked up
every time somebody asks a question. Without that, a chatty month becomes an expensive one.

A postcode pair also normalises: `SW1A 1AA → M1 1AE` is the same distance as the reverse, so
cache both directions from one lookup.

### Validation

- Postcodes must be validated before they reach the Maps API — a typo costs a call and returns
  nothing useful
- A postcode that will not geocode should be **rejected at sync**, like any other bad row,
  rather than producing a silent zero-mile delivery

---

## What this is not

Not a route planner. If the requirement turns out to be "tell the courier the best order to
visit eight addresses", that is a different product and should be scoped separately.

---

## Before building

- [ ] Answers to the six questions above
- [ ] `postcode` column added to the sheet, validated
- [ ] Decision on driving vs straight-line distance
- [ ] Google Maps API key, with billing and a quota cap set
- [ ] A worked example from payroll: one courier, one real day, the amount they were actually
      paid — so the rule can be checked against something real before it goes live
