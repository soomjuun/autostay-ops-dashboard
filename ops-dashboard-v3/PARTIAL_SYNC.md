# Partial Source Refresh

Updated: 2026-10-02.

## Publication Contract

- Completed, audited builds retain the existing full-data loading path.
- Running builds and completed builds awaiting their current audit can publish partial data.
- Read the monthly facts, portfolio totals, quality tables and configuration twice.
- Require the same run, build state, source dates and core values across both reads.
- Reconcile financial and usage observations by store and month with current-run quality tables.
- Reconcile store totals with portfolio totals and validate subscription dates, flows and ARR.
- Reject duplicate keys, invalid numbers and current-run audit blockers.
- Exclude unverified groups instead of fabricating zero or showing an incomplete portfolio total.
- Keep received but incomplete usage as provisional, without enabling official comparisons or rankings.
- Do not consume in-progress Summary or display-only analysis tabs.
- Hold coupon and contribution metrics until the final audit is available.

## Recovery

The API retains the latest confirmed snapshot in its current server instance. The browser also
retains a confirmed snapshot for up to 24 hours in the same reporting month. Cached responses
retain their original source and fetch timestamps and show a recovery notice. Authentication
and permission errors cannot fall back to cached data. No paid or shared external store is added.

Server memory is lost when its instance stops. A new browser without a prior snapshot still
needs a readable, reconcilable source. Browser storage can be disabled, cleared or evicted.

## Verification

Run `node test-sync.cjs`. The 2026-10-02 revision passed 38 regression tests.
Run `node verify-partial.cjs .qa/current-20261002.json .qa/partial-20261002.json`
to validate a captured source and generate a local preview fixture. Captures are not committed.
Run `node dev-server.cjs --snapshot .qa/partial-20261002.json` for a captured-data UI check.
Add `--cache-test --fail-after-first` to test refresh failure and reload recovery locally.
Captured-data checks do not replace production live API verification.

Rollback must restore the frontend and API together to the previous production commit `7909c37`.
