# Dropdown context audit

Reviewed against the current form and filter code. The custom mobile selector in `form-selector.js` displays the same underlying `<select>` options; it does not own a separate option list.

| Dropdown(s) | Decision |
| --- | --- |
| Animal purpose | Depends on a recognized species. Cattle, goats, sheep, poultry, pigs, bees, rabbits, equines, and companion animals receive plausible purposes. Unknown species retain all purposes. Changing species refreshes the options; an incompatible saved purpose is shown as Mixed with a review notice in the editor. |
| Record type and type-specific status | Keep their existing fixed lists. The Record type redraws its own status and detail fields. |
| Animal managed-as, Land type | Keep fixed; neither depends on another selected field. |
| Task linked Record | Offer active Records for new work; keep the already-linked inactive Record visible when editing history. |
| Task assignee and Chore Window | Offer active people and enabled Chore Windows; no species dependency. |
| Task priority | Keep fixed; all priorities apply to all Tasks. |
| Task repeat and schedule-from | Keep fixed choices, showing schedule-from only for recurring Tasks. |
| Task completion Yield | Depends on the linked active Record's eligible Yield types; no Record or incompatible Record means No Yield only. Existing incompatible actions are identified before saving. |
| Yield Record | Depends on the chosen Yield type and active status; preserve the previously linked inactive Record while editing an existing entry. No eligible Record is selected implicitly. |
| Yield unit and session | Unit already depends on Yield type. Session remains morning, evening, or other for all types because it records when work happened, not what was produced. |
| Land type and resulting Yield | The explicit Land type takes precedence over an incidental name or current-use word when choosing harvest versus forage. |
| Ledger type, primary Record, allocation Records | Expense/income are universal. Transactions may legitimately refer to inactive or archived Records, so these pickers retain them. Allocations are independently validated against amounts. |
| Record Event type | Depends on Record type and adds applicable dairy/bee events only when the species supports them. Removed a cap that hid valid events after specialization; save checks the current list again. |
| Calendar repeat and linked Record | Repeat choices are universal; a historical Calendar event may refer to an inactive Record. |
| Records and Tasks status/timing/type/sort filters | Keep fixed options. Task Record and assignee filters include archived Records and previously assigned people where they have history. |
| Parent animal, location, responsible person | Already constrained to compatible active animals, Land/Structure locations, and active people by `records-relationships.js`. |
| Onboarding suggestion placement | Suggested Tasks follow the Record catalog; placement follows enabled Chore Windows. |
| Onboarding and Cloud invitation roles | Keep the same fixed permission roles. Role meaning does not depend on species or form state. |
| Cyril entry type and receipt Record | Entry type is user intent. The receipt Record list already comes from active AI context and allows Cyril to suggest one. |

The shared `eligibleYieldTypes` rule powers Record Yield actions, Yield Record choices, Task completion choices, and Cyril context. Yield and Task forms also validate compatibility before saving; dropdown filtering alone is not treated as a data-integrity boundary.
