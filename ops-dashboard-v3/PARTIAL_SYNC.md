# Partial Source Refresh

Updated: 2026-10-20.

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

Metric-contract builds also read `_ops_subscription_monthly_2026!A1:S120` in the
stable core snapshot. Churn and store PASS ARPU use observed subscriber-days divided
by days in the month, not the final retained count. The denominator must have the
current execution ID, matching source date and subscription totals, valid arithmetic,
and `OK` quality. A missing denominator holds these rates only; received MRR,
retained subscriptions, new subscriptions, cancellations and revenue remain visible.
Full-period exposure and ARPU require all selected denominators. Reviewed cumulative
churn uses only verified months, matching cancellations and exposure to exactly the
same months. It carries explicit included-month, total-month and completeness fields;
the UI labels incomplete results as confirmed-month-only, not full-period figures.
The payment summary may also show a clearly labelled matched subset. Position maps
use the same verified months for every displayed store. If an opening store prevents
any shared month, use the largest comparable cohort (at least two stores), disclose
the excluded stores, and never plot different month subsets on the same map.

The churn-health gauge and radar share `clamp(100 - churn_percent * 5, 0, 100)`.
The gauge displays points, not a churn percentage disguised as a health score.
Its risk color still follows the source's 5% churn threshold. Incomplete churn is
excluded from cross-store confirmed score ranks and heatmap ranks.

## Source Gap Investigation

Checked 2026-10-20 against run `4967c60b-9adb-4129-b302-93b9ae7fdb9e`.
Read `_raw_sub_2026` (22,077 rows), `_raw_sub_map_2026` (22,014 unique
date/product rows), product mappings and the monthly subscription quality table.
The 63 extra raw rows are identical duplicates on January 22, already deduplicated
by the source mapping. No unique raw date/product key is dropped by mapping.

- September: September 1 and 5 are absent from the raw source, across all products.
  This affects all seven operating stores: 14 store-days, 54 product-days.
- Jayuro product 108: May 27-29, May 31 and June 1-4 are absent (8 product-days).
- Seongsu product 104: May 27-31 and June 1-6 are absent (11 product-days).
  Both products last reported zero retained subscriptions before these gaps and
  later resumed at positive balances. The raw extract contains no all-zero rows.
  Omission of zero-activity rows is a plausible explanation, not verified lifecycle
  evidence. Do not convert those blanks to zero or mark their months complete.

This accounts for all 11 incomplete store-months (73 product-days). Restoring the
missing source records is an upstream task; the dashboard does not invent them.

## Recovery

The API retains the latest confirmed snapshot in its current server instance. The browser also
retains a confirmed snapshot for up to 24 hours in the same reporting month. Cached responses
retain their original source and fetch timestamps and show a recovery notice. Authentication
and permission errors cannot fall back to cached data. No paid or shared external store is added.

Server memory is lost when its instance stops. A new browser without a prior snapshot still
needs a readable, reconcilable source. Browser storage can be disabled, cleared or evicted.

## Verification

Run `node --test --test-isolation=none test-sync.cjs` for regression coverage.
Run `node verify-partial.cjs .qa/current-20261002.json .qa/partial-20261002.json`
to validate a captured source and generate a local preview fixture. Captures are not committed.
Run `node dev-server.cjs --snapshot .qa/partial-20261002.json` for a captured-data UI check.
Add `--cache-test --fail-after-first` to test refresh failure and reload recovery locally.
Captured-data checks do not replace production live API verification.

Rollback must restore the frontend and API together to the recorded previous production commit.
