import { fuzzyMatch } from "./fuzzyMatch";

function preferredRefs(defaultBranch: string): string[] {
  return [`origin/${defaultBranch}`, defaultBranch];
}

export function orderBaseBranchCandidates(
  candidates: string[],
  defaultBranch: string,
): string[] {
  const unique = [...new Set(candidates.filter((value) => value.trim().length > 0))];
  const preferred = preferredRefs(defaultBranch);
  const remaining = unique
    .filter((value) => !preferred.includes(value))
    .sort((a, b) => a.localeCompare(b));

  return [
    ...preferred.filter((value) => unique.includes(value)),
    ...remaining,
  ];
}

export function getDefaultBaseBranch(
  candidates: string[],
  defaultBranch: string,
): string {
  const ordered = orderBaseBranchCandidates(candidates, defaultBranch);
  return ordered[0] ?? defaultBranch;
}

export function filterBaseBranchCandidates(
  candidates: string[],
  query: string,
  defaultBranch: string,
): string[] {
  const ordered = orderBaseBranchCandidates(candidates, defaultBranch);
  const trimmed = query.trim();
  if (!trimmed) return ordered;

  return ordered
    .map((candidate) => ({
      candidate,
      match: fuzzyMatch(trimmed, candidate),
    }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => {
      if (b.match!.score !== a.match!.score) return b.match!.score - a.match!.score;
      return a.candidate.localeCompare(b.candidate);
    })
    .map((entry) => entry.candidate);
}
