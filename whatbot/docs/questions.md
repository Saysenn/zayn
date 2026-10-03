# Question universe

What people actually send the bot, grouped by intent. Wording varies; almost every
message should land in one of these.

Scoped to what the bot can answer: assignments read from the sheet, for the sender,
in the group that received the message. Anything outside that is section 13.

Every section below is handled. Where:

| § | Handled by |
| --- | --- |
| 1, 2 | `get_my_breakdown` · `get_my_company` · `get_my_total` · `rank_my_companies` |
| 3 | `count_my_companies` · `get_my_dates` |
| 4 | `get_my_dates` |
| 5 | `conversation/outOfScope` — we hold no payment dates |
| 6, 7 | `conversation/about` |
| 8 | `agent/prompt` — the group boundary is enforced in `employee/access` |
| 9, 10, 12 | `conversation/escalate` |
| 11 | `conversation/greeting` · `conversation/banter` |
| 13 | `conversation/outOfScope` |

Routing order is asserted in `conversation/routing.test.ts`.

---

## 1. Amount

1. How much am I getting paid?
2. What is my payment this month?
3. What is my total?
4. What am I due?
5. Can you confirm my amount?
6. Is my payment still £100?
7. Is this my final figure?
8. Does this include everything?
9. Has my amount gone up?
10. Has my amount gone down?
11. Is this a fixed amount or an estimate?
12. Is that before or after deductions?

Answering rules:

- The model writes the sentence. The figure is appended by `tools/format`.
- Say "payable this month", not "paid". The bot has no visibility of transfers.
- Payable = monthly × payable_days ÷ 31. If that is different from the headline
  monthly rate, say why before the person asks.

---

## 2. Breakdown

The most common intent after section 1.

1. Can you explain my payment?
2. How was it calculated?
3. Can I see the breakdown?
4. What makes up the £500?
5. Can you show it line by line?
6. What rate has been used?
7. How many days have I been paid for?
8. Is this a full month?
9. Is this pro-rated?
10. Why is one line worth more than another?
11. Why is the total different from the sum of the lines?
12. Can you explain it in simpler terms?

Shape of the answer:

> Your payable amount this month is £500.
> Acme Ltd — Director — 31 days — £300
> Brightside Ltd — Secretary — 21 days — £200

---

## 3. Assignments

The unit is an assignment: person × role × company × group. One person holds many.

1. Which companies am I on?
2. What roles do I hold?
3. Am I still on Acme?
4. Why is Brightside not listed?
5. When did this assignment start?
6. When does it end?
7. How many days am I payable for on this one?
8. Why is this one showing zero days?
9. Why does the same company appear twice?
10. Is this assignment still active?
11. Has one of my assignments been removed?
12. Can you list every assignment separately?

Answering rules:

- The same person can hold the same role at the same company twice with different
  payable days. Both are real. Never merge them.
- 0 payable days means nothing owed this month. It does not mean the assignment
  has ended — say so explicitly.
- Lookup must resolve to exactly one person or refuse. Never guess between matches.

---

## 4. Dates and duration

1. When did my payment start?
2. What is my official start date?
3. Why is the start date different from when I joined?
4. Is my first month pro-rated?
5. When does this end?
6. Is the end date confirmed?
7. How many payments do I have left?
8. Is this my last one?
9. What happens after the end date?
10. Do my assignments have different end dates?
11. Can you list the end date for each one?
12. My start date is wrong.

Never present an approximate end date as guaranteed:

> The current expected end date is 30 June 2027. That is an estimate and can change
> if the arrangement is amended.

---

## 5. Payday timing

The bot knows none of this. It has no payment system attached, and `PAYDAY_SEND_DAY`
is the day we send the did-you-get-paid check, not payday itself. Every question
here gets the same written refusal, plus the figures, which is what whoever chases
it will want anyway.

1. When is payday?
2. What day are payments sent?
3. Has my payment been sent?
4. Why have I not received it?
5. Is it late?
6. Will it arrive today?
7. What happens if payday is a bank holiday?
8. Can I be paid earlier?
9. Can two months be paid together?

Answering rules:

- Only say "paid" if a payment system has confirmed the transfer. It has not.
  Everything the bot has is "payable" or "expected".
- Never quote a schedule. A date we half-know is worse than no date.

---

## 6. Identity and authentication

1. Who are you?
2. Are you a bot?
3. Which business do you represent?
4. How do I know this is legitimate?
5. Why are you contacting me?
6. Where did you get my number?
7. What information do you have about me?
8. Can I speak to a person?
9. Is this a scam?
10. Will you ever ask for my password or PIN?
11. Someone else has access to this phone.
12. I think someone is impersonating me.

Answering rules:

- Identity is the verified WhatsApp sender number, mapped to a `personId`.
  Never a typed name, never a shared PIN. If someone types "I'm John", that
  changes nothing about what they can see.
- State plainly that the bot will never ask for a password, PIN, full card
  details or a one-time banking code.
- 11 and 12 escalate to a human immediately.

---

## 7. Privacy and data

1. What information do you hold about me?
2. Who can see my information?
3. Can other people in the group see my figures?
4. Can I see what someone else earns?
5. Are these messages stored?
6. How long are they kept?
7. Is the AI training on my messages?
8. Can I get a copy of my data?
9. Can you delete my data?
10. Can you stop contacting me?
11. Why did you mention another person's name?
12. You have sent me someone else's breakdown.

Answering rules:

- 4 is always no. People see their own assignments and nobody else's.
- 10 is the opt-out path and must actually work.
- 11 and 12 are privacy incidents. Escalate immediately, do not explain, do not
  attempt to re-send anything.

---

## 8. Cross-group boundary

Group is determined by which of our numbers received the message. Someone in two
groups holds two separate threads and neither may show the other's companies.

1. What other groups am I in?
2. How much do I earn from the other group?
3. Can you combine all my payments?
4. Why did another number give me a different amount?
5. Can you tell me what the other group pays?
6. Who is in the other group?
7. Can you compare my earnings across groups?
8. I want to discuss all my groups in one conversation.
9. Which number should I message?

Standard reply:

> I can only help with payments relating to this group. I can't access or discuss
> information from other groups.

It must not confirm or deny that another group exists.

---

## 9. Corrections and disputes

The bot collects facts and escalates. It does not adjudicate and it does not argue.

1. My payment is wrong.
2. I think I have been underpaid.
3. I think I have been overpaid.
4. The total does not add up.
5. An assignment is missing.
6. An assignment should not be there.
7. The wrong rate has been used.
8. The start date is wrong.
9. The end date is wrong.
10. I have been paid for too few days.
11. I was promised a different amount.
12. The bot told me a different amount before.
13. Can a human review this?
14. When will the correction be made?

What happens: the message is written to the audit log with a category on it, a warn
line goes to the logger, and the reply asks for the two things that make it
actionable — which company, and what they expected. Nothing more is promised,
because nothing more currently happens.

No phone number or email is given out. We do not own one to give.

---

## 10. Human support

1. Can I speak to a person?
2. I do not want to talk to a bot.
3. Can someone call me?
4. How do I escalate this?
5. When will someone respond?
6. Why has nobody contacted me?

Escalate immediately, without trying to resolve it first:

- Suspected fraud
- Data breach or wrong recipient
- Large discrepancy
- Formal complaint
- Vulnerable person
- Threats or abuse
- Legal request

---

## 11. Casual

1. Hi, how are you?
2. What should I call you?
3. Are you human?
4. Thanks for your help.
5. Sorry, I am confused.
6. Can you explain it slowly?
7. Can you use an example?
8. Can you remember what we discussed?
9. What did I ask you last time?
10. What else can you help with?

Warm without pretending to be human:

> I'm the payment assistant for this group. I'm an AI, but I'll make the breakdown
> as clear as I can and get a person involved if something looks wrong.

---

## 12. Angry or distressed

1. This is ridiculous.
2. You have stolen my money.
3. Your figures are completely wrong.
4. I need this money urgently.
5. I cannot pay my rent.
6. I am going to report this.
7. I will take legal action.
8. Give me a manager now.
9. You are a scam.

The bot should:

1. Acknowledge the concern.
2. Not become defensive and not apologise for figures it has correctly reported.
3. Restate the known facts once.
4. Name the specific thing in dispute.
5. Escalate.

---

## 13. Out of scope

The bot has one read-only source. It cannot do any of the following, and should say
so plainly and hand off rather than improvise:

| Area | Typical message | Reply |
| --- | --- | --- |
| Bank details | "How do I change my bank details?" | Never over WhatsApp. Hand off. |
| Personal details | "My address / name has changed." | Hand off. Nothing here is writable. |
| Transfer status | "Can you give me a transaction reference?" | No payment system is connected. |
| Tax | "Is this taxable? Do I need to declare it?" | Facts only, then point to an adviser. |
| Invoices and VAT | "Where do I send my invoice?" | Hand off. |
| Statements and documents | "Can I get a PDF / annual statement?" | Not available. |
| Payment history | "How much was I paid last month?" | Current period only. |
| Forecasting | "What will I earn over the remaining term?" | Not modelled. |
| Cancellation | "I want to leave the arrangement." | Hand off. |
| Other channels | "Can you email me / call me?" | WhatsApp only. |
| Reasons | "Why is this showing zero?" | We hold the number, not the reason. |

---

## Cross-cutting rules

- Every read is scoped to the sender's `personId` and the receiving group.
- Tools never take an identity or a group as a parameter. Both come from verified
  context.
- Figures are formatted in code and appended below the prose. The model never
  writes a number itself.
- Never quote a phone number the business does not own. Retry or hand off instead.
- Never message someone who has not messaged first, other than the paced payday check.
