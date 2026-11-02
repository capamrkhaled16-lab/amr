# Project memory

## Product intent & audience

- Student payment management app focused on tracking payments and sending receipts via WhatsApp.
- Audience: administrators/staff managing student payment records and communication.

## Brand personality & voice

- Practical, efficient, and clear. Prioritizes task completion and reliable data handling over decorative flair.

## Visual design & UX direction

- Stack: Vite + React (JSX), Tailwind CSS, Lucide React icons.
- Use `@/` path alias for imports (maps to `src/`).
- WhatsApp icon (Lucide) used per payment history row to trigger receipt send.
- Payment history renders as rows with actionable controls.
- Dialogs close on first action click to prevent double-submit.
- History WhatsApp icon opens WhatsApp directly (no review dialog).

## Decisions, constraints & rationale

- No extra UI/theme/icon packages unless absolutely necessary or user-requested.
- WhatsApp button in payment history opens a receipt message for an already-saved payment — never creates a new payment.
- Removed one-send-per-payment session guard to allow resending receipts. Rationale: user requested resend capability; double-click protection preserved via dialog-close-on-first-click behavior.
- History WhatsApp button now passes total due and running paid total (up to that payment, same month) to the receipt template. Rationale: previously these fields were blank.
- Build passes after all WhatsApp/receipt changes.

## Open questions & assumptions

- **Browser testing:** Save, history, and WhatsApp send flows are unverified in browser. Needs end-to-end manual testing.
- **History dialog:** History icon opens WhatsApp directly, not a review dialog. User may want the review dialog first — awaiting confirmation.
- Assumes payment records store enough fields (student identifier, payment amount, date) to populate receipt messages.