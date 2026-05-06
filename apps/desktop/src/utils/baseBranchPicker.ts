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
  const unique = new Set(candidates.filter((value) => value.trim().length > 0));
  const originDefault = `origin/${defaultBranch}`;
  if (unique.has(originDefault)) return originDefault;
  if (unique.has(defaultBranch)) return defaultBranch;
  return "";
}

export function filterBaseBranchCandidates(
  candidates: string[],
  query: string,
  defaultBranch: string,
): string[] {
  const ordered = orderBaseBranchCandidates(candidates, defaultBranch);
  const trimmed = query.trim();
  if (!trimmed) return ordered;
  const canonicalOrder = new Map(ordered.map((candidate, index) => [candidate, index]));

  return ordered
    .map((candidate) => ({
      candidate,
      match: fuzzyMatch(trimmed, candidate),
    }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => {
      const leftScore = a.match?.score ?? 0;
      const rightScore = b.match?.score ?? 0;
      if (rightScore !== leftScore) return rightScore - leftScore;

      const leftOrder = canonicalOrder.get(a.candidate) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = canonicalOrder.get(b.candidate) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      return a.candidate.localeCompare(b.candidate);
    })
    .map((entry) => entry.candidate);
}
