export function defaultReposHome(homeDir: string): string {
  return `${homeDir.replace(/\/+$/, "")}/.kanna/repos`;
}
