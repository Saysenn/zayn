# Expense test files

All fake: made up 2026-10-07 for testing the expense bot (WhatBot and Diane's
Expenses context). Amounts below are what each file should read as.

| File                           | What it is                                        | Should read as                                                                 |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `expenses-october.xlsx`        | The expenses document: a tab per group            | 5 tabs; title and Total rows skipped; MILKMAN has a two-row header; INDIGO has one GBP flight |
| `expenses-random.xlsx`         | Odd headings (When, Item, Supplier, Cost (AED), Team, By) | 25 expenses, mixed date styles, a few with no supplier (asked)          |
| `expenses-messy.csv`           | Mixed dates, "AED 7,500", "85 dhs", "£45"        | 6 expenses; Stationery has no payee (asked); Total row skipped                  |
| `receipt-01-carrefour.jpg`     | Supermarket, tilted                               | Carrefour, 04 Oct, AED 139.91 (the total, not the subtotal)                     |
| `receipt-02-careem.png`        | Taxi                                              | Careem, 05 Oct, AED 45                                                          |
| `receipt-03-enoc-blurry.jpg`   | Fuel, blurry and tilted                           | ENOC, 06 Oct, AED 120.43                                                        |
| `receipt-04-pret-gbp.jpg`      | London lunch                                      | Pret A Manger, 02 Oct, GBP 19                                                   |
| `receipt-05-du-bill.png`       | Phone/internet bill                               | du, 01 Oct, AED 471.45                                                          |
| `receipt-06-cash-note.jpg`     | Handwritten-style cash note                       | Ahmed (cleaner), 07 Oct, AED 250                                                |
| `receipt-07-amazon.png`        | Online order                                      | Amazon, 03 Oct, AED 180.50                                                      |
| `invoice-01-dewa.pdf`          | Utility invoice                                   | DEWA, 01 Oct, AED 919.28                                                        |
| `invoice-02-trainline-gbp.pdf` | Train e-ticket                                    | Trainline, GBP 86.40, booked 06 Oct (travel 08 Oct, a future date to check)     |
| `invoice-03-rent.pdf`          | Rent receipt                                      | Al Fardan Properties, 01 Oct, AED 7,500                                         |
| `weekly-expenses.docx`         | Word notes, a week of MANBAT expenses             | 4 expenses; the printer repair has no proper payee                              |
| `costs-review.pptx`            | Slides                                            | 3 expenses: flight GBP 412, hotel GBP 238, coffee machine AED 899               |
| `messages.txt`                 | Typed WhatsApp messages, one per block            | Send each one; some leave out the payee or date on purpose, one is large (25,000) |

The clone database also has 86 fake expenses (August to October 2026, all five
groups, one GBP and one EUR) for questions like "how much did each group spend".
