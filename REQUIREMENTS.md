# Requirements & decision notes

| Requirement | Implemented approach |
|---|---|
| Centres import candidate batch | JSON and CSV import |
| Bad CSV rows: exact feedback, no partial import | validate all rows before database write; reject with row-numbered errors |
| District approval | two distinct district users; decisions are transactionally guarded |
| Large batch scrutiny | batch size >= 50 is routed to Quality |
| State final decision | State approval triggers issue jobs |
| Fix and resubmit | returned batch resubmission clears active district approvals; audit remains |
| Certificate uniqueness | database unique certificate number and candidate/batch relation |
| Cancel certificate | state role only; verification immediately reflects cancellation |
| Public verification | opaque token, no auth, limited information |
| WhatsApp delivery | Transactional delivery rows are polled into BullMQ and retried; terminal failures are recorded, but no real provider, candidate phone field, or generated PDF is wired in |
| Certificate download | Certificate preview can be printed/saved as PDF; the certificate shows its public verification token |
| Live updates | Demo polls every 10 seconds (including certificates while open); this is near-real-time, not push delivery |
| Role protection | JWT role middleware and server-side authorization |
| Traceability | audit table records actor, action and timestamp |
| stuck batches | state-only query and dashboard alert after 48 hours without an update |
| Containerized | Docker Compose services |
| Tests | CSV parsing/validation tests are executable; database race, delivery, authorization, and full workflow integration tests remain outstanding |

## Ambiguities resolved
- Two distinct district officer approvals required.
- Batches with 50+ candidates require quality review.
- Returned batches reset approvals, but audit decisions are preserved.
- Certificate delivery is asynchronous after issuance; issuance itself does not wait for provider.
- Public verification returns certificate status, number, and issuance date without candidate identity or course; production still needs anti-enumeration rate limits.
- A batch is considered stalled after 48 hours without an update while in an approval stage; this is a demo SLA, not a programme-approved production SLA.
- The WhatsApp provider is a simulator. Production delivery still needs candidate phone numbers, PDF generation/storage, and a real provider integration.
- Delivery rows act as a local outbox; the worker re-enqueues pending rows after Redis recovery and reclaims stale sends after five minutes.
