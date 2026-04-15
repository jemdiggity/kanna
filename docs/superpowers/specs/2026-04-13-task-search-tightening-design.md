# Task Search Tightening Design

## Summary

Sidebar task search currently feels too fuzzy because it uses character-by-character subsequence matching for titles. Queries like `unfuck` can match unrelated titles that happen to contain those letters in order, even when the contiguous substring does not appear anywhere in the task.

This change replaces sidebar task search with strict contiguous matching semantics. A query term will only match when it appears as an exact token, a token prefix, or a contiguous substring within a searchable field. Scattered-letter fuzzy matching will no longer be used for tasks.

## Goals

- Eliminate subsequence false positives in sidebar task search.
- Preserve natural substring behavior, so `unfuck` still matches values like `hot-unfuck-fix`.
- Keep multi-word search useful by requiring all query terms to match somewhere meaningful.
- Preserve strong ranking for task names over secondary fields like branch and prompt.

## Non-Goals

- Changing file picker search behavior. File search should keep using `fuzzyMatch`.
- Adding advanced search syntax, field qualifiers, or quoted phrases.
- Changing sidebar layout, selection, or keyboard shortcut behavior.

## Search Semantics

Searchable fields remain:

- `display_name` with the highest weight
- `issue_title`
- `branch`
- `prompt` with the lowest weight

For each query term:

- Exact token match is the strongest result.
- Token prefix match is next strongest.
- Contiguous substring match is allowed and is weaker than token and prefix matches.
- Non-contiguous subsequence matches are rejected.

For the full query:

- The query is normalized to lowercase and split into alphanumeric terms.
- Every term must match at least one searchable field, or the task is excluded.
- The full raw query receives an additional boost when it exactly matches, prefixes, or appears contiguously within a field.
- Search results are ranked by score, with `created_at DESC` as the tiebreaker.

This means:

- `unfuck` matches `hot-unfuck-fix`
- `unfuck` matches `Unfucked terminal bootstrap`
- `unfuck` does not match a title that only contains `u ... n ... f ... u ... c ... k`

## Architecture

The change stays inside the current sidebar search boundary:

- `apps/desktop/src/utils/taskSearch.ts` remains the source of truth for task matching and scoring.
- `apps/desktop/src/components/Sidebar.vue` continues to call `taskSearchMatch()` for filtering and ranking.
- `apps/desktop/src/App.vue` continues to use `sidebar.matchesSearch()` for keyboard navigation through filtered results.

No store, database, or daemon changes are needed.

## Implementation Notes

- Remove `fuzzyMatch` from task search entirely and keep it isolated to file-path search.
- Keep the current weighted scoring model, but ensure matches come only from contiguous token or field checks.
- Prefer token-aware scoring before broad substring scoring so exact names sort above loose prompt matches.
- Keep branch and prompt searchable, but below title-based fields in weight so secondary matches do not outrank obvious title hits.

## Testing

Add or keep unit coverage in `apps/desktop/src/utils/taskSearch.test.ts` for:

- exact token matches in titles
- prefix matches in titles
- contiguous substring matches in hyphenated titles
- rejection of subsequence-only queries like `ctma` and the reported `unfuck` case
- multi-word queries that require every term to match
- ranking that prefers title hits over prompt-only hits

No UI or E2E coverage is required unless implementation reveals sidebar integration regressions.

## Risks and Mitigations

Risk: Search could become too strict for users who relied on subsequence matching.

Mitigation: Preserve exact, prefix, and general contiguous substring matching across all current searchable fields.

Risk: Prompt text may still create noisy matches.

Mitigation: Keep prompt weight lower than title and issue-title weight so prompt-only matches sort behind obvious title matches.

## Rollout

This can ship as a direct behavior change with no migration. The search logic is local, stateless, and immediately reversible if feedback shows it is too strict.
