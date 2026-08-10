# Implementation Notes

## Orientation / Application Overview

This is a small Angular app for reviewing Change Requests (CRs) — proposed changes to a live Purchase Agreement. Approvers use it to find a CR, understand what changed, and approve or reject it.

The list screen loads CRs for the current user’s org, lets you filter by status (`visibleRows`), and shows clear loading / loaded / empty / error states via `ViewState`. The detail screen shows the selected CR’s diff, totals/delta, and timeline (oldest first), plus Approve/Reject when the user is allowed — including reject-reason validation and handling for in-progress / failed actions. Everything talks to the mock `CrApiService`; there’s no real backend.

## 1. What I changed

- **Task 1:** Fixed `computeDiff` so a quantity (or description) change counts as `changed`, not only price. Fixed `canApprove` so it checks both `PENDING_APPROVAL` and `canApprovePolicy` — a read-only viewer can’t approve.
- **Task 2:** Implemented the status filter in `visibleRows` without changing the loaded data. Left the existing list state handling as-is.
- **Task 3:** Sorted the timeline chronologically (copy of `audit`, oldest first). Diff panel and totals already came from the model; I made sure they behave correctly with the fixtures.
- **Approve:** Wired `approve()` to the API with guards for permission, status, and `submitting`, update from the response, double-click protection, and `actionError` on failure.
- **Reject:** Same pattern as approve. `canReject` uses the same approval policies. Reject reason must be non-empty after trim.
- **Extra polish:** Detail reloads when `id` changes. Approve/Reject only show when allowed. If the list fails or is empty, the shell hides detail so you don’t get a broken split view.
- **Tests:** Added coverage for filter, states, timeline order, permissions, approve/reject (happy + unhappy paths), validation, and id reload.

## 2. Component & state model

I kept state in the component that owns the screen, rather than introducing anything global beyond `SessionService` and the mock API.

**List** holds the loaded rows, the current status filter, and a `ViewState` for loading / loaded / empty / error. `visibleRows` is just a filtered view of that data — filtering never rewrites `state.data`. Empty means “API returned nothing”; error means “the call failed.” The list also emits `stateChange` so the demo shell can react.

**Detail** holds the loaded CR, derives diff and timeline from it, and tracks reject form state, `submitting`, and `actionError`. When the `id` input changes, `ngOnChanges` reloads so switching rows in the list actually refreshes the pane.

**Approve / Reject** follow the same flow: check you’re allowed, bail if already submitting (or if reject reason is invalid), set `submitting`, call the API, put the returned CR into state on success, clear `submitting`, and on failure show `actionError` without inventing a new status. The API response is the source of truth after a successful action.

## 3. Invariants I keep

| Invariant | How / where |
|---|---|
| Empty list or failed list | Successful `[]` → `empty`; thrown error → `error` with a message |
| Filter doesn’t mutate loaded data | `visibleRows` filters a copy of the view; zero matches stay `loaded` |
| Diff notices real line edits | Compares quantity, unitPrice, and description |
| Timeline is chronological | Sort a copy of `audit` by `at`, oldest first |
| Money display matches the API | Format `baselineTotal` / `newTotal` / `delta` — don’t recompute them |
| Approve & Reject need status + policy | `PENDING_APPROVAL` and `canApprovePolicy` |
| Disallowed actions aren’t shown | `*ngIf` on Approve and the Reject block |
| Don’t trust the button alone | `approve()` / `reject()` also guard in code |
| No double submit | Shared `submitting` flag |
| Reject needs a real reason | Trimmed non-empty validator; whitespace doesn’t count |
| Failed action doesn’t fake success | Keep existing CR; set `actionError` |
| Success uses the API payload | Replace detail with the returned `CrDetail` |
| Changing selection reloads detail | `ngOnChanges` on `id` |
| List failure doesn’t leave stale detail | Shell clears selection / hides detail on list empty or error |

## 4. Testing strategy

I leaned on the existing TestBed style: render, flush the mock promise, assert on the DOM. For actions I stub the API (or hold a Promise open) so tests stay fast and deterministic.

Covered: diff edge cases; list loading/empty/error and status filter; detail title, totals, diff, timeline order, id change; permission visibility; approve/reject success, blocked cases, duplicate clicks, and failures.

I didn’t spend time on full shell E2E tests, or on calling every `latencyMs` / `failNext` path (deferred Promises cover the same ideas). I also didn’t add list refresh-after-action tests or deep tests of `cr_a_u` vs `cr_a_w` beyond what `canApprovePolicy` already means.

## 5. Assumptions

- There’s no separate “reject” policy in the repo, so Reject uses the same `canApprovePolicy` helpers as Approve.
- “Can’t see/enable actions” meant hide Approve/Reject when not allowed, not leave Approve sitting there disabled for viewers.
- Any non-empty trimmed string is a valid reject reason — the brief didn’t ask for a minimum length.
- Filtering to zero rows is still a loaded list with an empty table, not the API empty state.
- Approve/reject pass `new Date().toISOString()` for the API’s `at` field.
- `failNext` only fails the next call, so the shell sync exists mainly so a list error doesn’t leave an old detail on screen.

## 6. Where I used AI

I used Cursor as an AI-assisted development tool during the assessment. I personally completed the project setup, configured the environment, ran the application, reviewed the provided scaffold/README, and verified the implementation manually.

Cursor was primarily used as an assistance tool for testing and writing/expanding test cases, including identifying relevant test scenarios and validating edge cases.

All implementation decisions and code changes were made under my own review and consideration. I reviewed the requirements, determined the expected behavior, implemented the required changes, and verified the resulting behavior in the application. I also manually tested the UI and ran the test suite to ensure the changes worked as expected.

I remain fully familiar with the implementation and can explain or modify any part of the submitted solution.

## 7. What I'd improve with more time

With additional time, I would focus on the following improvements:

List/detail synchronization: Refresh or reconcile the CR list after a successful Approve/Reject action so the left-hand list immediately reflects the latest status without relying on stale state.
More realistic service-state testing: Add tests that directly exercise the provided mock service by toggling latencyMs and failNext, ensuring loading, delayed responses, and API failure states are covered against realistic conditions.
UI/UX enhancement: The current implementation prioritizes the assessment requirements and existing architecture. With additional time, I would enhance the UI with more polished cards, improved spacing, responsive layouts, clearer status indicators, and stronger visual hierarchy.
Action confirmation: Add a proper confirmation modal before Approve/Reject actions. The Reject flow would include a dedicated reason field with validation, making the action more explicit and reducing accidental state changes.
Responsive design: Further optimize the list/detail experience for smaller screens while maintaining an efficient desktop workflow.
Code quality and delivery: Run the complete lint/format pipeline, perform a final cleanup pass, and use clear, focused commit messages to make the repository history easier to review.

UI note: I intentionally kept the visual changes focused on the existing assessment scope rather than introducing a significant redesign. The current UI fulfills the required functionality, but I would be happy to take it further with a more polished and engaging production-ready interface if UI enhancement is part of the next phase.
