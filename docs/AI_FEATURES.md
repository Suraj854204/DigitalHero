# AI features

Two optional features, off unless `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` are set:
1. **Charity assistant** (public, rate-limited): keyword retrieval limits candidates; the model may only pick among them. Output is JSON-validated, slugs checked against the candidate set, and reasons containing numeric/impact/accreditation claims are rejected.
2. **Admin report summary:** the model sees only aggregate figures; any number in its text not present in the input causes the text to be discarded.

AI never picks winners, touches ledgers, approves evidence or authorises payouts. Every path falls back to deterministic text on missing key, timeout (`AI_TIMEOUT_MS`), HTTP error or bad output. Unit tested with stub providers; **no live model call was made**.
