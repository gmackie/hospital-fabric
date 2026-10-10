# Local synthetic operator console

React source is bundled by `scripts/build-console.mjs` into generated Worker exports. The Worker serves `/`, `/console.js`, and `/console.css`; runtime assets are same-origin and do not require a CDN. Build dependencies must already be installed for offline rebuilding.

## Operator walkthrough

1. Start the local Worker and open its root URL. Enter the local `.dev.vars` demo token.
2. If tables are not initialized, the initial read can fail. Choose **Initialize demo**, which preserves existing records.
3. **Register synthetic patient**, then **Queue CBC**. Labels and result values are generated/fixed synthetic data.
4. **Arm lost ACK**, then **Tick delivery / poll results**. The selected operation should become **Unknown outcome**.
5. **Reconcile selected only** checks destination state and should show **Accepted** without another LIS order.
6. **Release simulated result**, then **Tick delivery / poll results**. The operation should become **Completed**, with its event timeline and patient result visible.

The lost-ACK fault is global to the next eligible delivery. A manual tick processes up to ten eligible operations, not just the selected operation. Server-side scheduling may also advance state; this console itself does not run timers or background mutations.

## Client safety boundaries

- Tokens, selected records, patient state, and pending request IDs live only in memory. Disconnect aborts active requests and clears state. Reload starts disconnected.
- A synchronous action lock prevents overlapping double-click mutations. Reads and mutations have a 15-second abort deadline. Aborting does not prove that a server mutation was rolled back.
- CBC retries retain the exact request ID and patient payload until confirmed. The explicit **Prepare another CBC** action is required to begin another logical order after success.
- Patient registration has no server idempotency key; interrupted registration can leave an extra synthetic patient. The console never retries registration automatically.
- Session epochs prevent late responses from repopulating cleared state or overwriting a later connection. Selection changes are disabled while an action is pending.
- API content is rendered as React text, never injected HTML. Tokens are not placed in URLs, local/session storage, logs, or generated assets.
- Read-only refresh never dispatches work. Reconciliation is enabled only for unknown/retry states; manual-review states have no bypass control.

This is a prototype demonstration, not clinical software, and accepts no real patient data.
