import { describe, it, expect } from "vitest";
import { parseRepoInput } from "./parseRepoInput";

describe("parseRepoInput", () => {
  it("detects HTTPS GitHub URL", () => {
    const r = parseRepoInput("https://github.com/owner/repo");
    expect(r).toEqual({ type: "clone", owner: "owner", repo: "repo", cloneUrl: "https://github.com/owner/repo.git" });
  });

  it("detects HTTPS URL with .git suffix", () => {
    const r = parseRepoInput("https://github.com/owner/repo.git");
    expect(r).toEqual({ type: "clone", owner: "owner", repo: "repo", cloneUrl: "https://github.com/owner/repo.git" });
  });

  it("detects SSH URL", () => {
    const r = parseRepoInput("git@github.com:owner/repo.git");
    expect(r).toEqual({ type: "clone", owner: "owner", repo: "repo", cloneUrl: "git@github.com:owner/repo.git" });
  });

  it("detects owner/repo shorthand", () => {
    const r = parseRepoInput("jemdiggity/kanna-v2");
    expect(r).toEqual({ type: "clone", owner: "jemdiggity", repo: "kanna-v2", cloneUrl: "https://github.com/jemdiggity/kanna-v2.git" });
  });

  it("detects gh repo clone command", () => {
    const r = parseRepoInput("gh repo clone owner/repo");
    expect(r).toEqual({ type: "clone", owner: "owner", repo: "repo", cloneUrl: "https://github.com/owner/repo.git" });
  });

  it("detects absolute local path", () => {
    const r = parseRepoInput("/Users/me/code/project");
    expect(r).toEqual({ type: "local", localPath: "/Users/me/code/project" });
  });

  it("detects tilde path", () => {
    const r = parseRepoInput("~/code/project");
    expect(r).toEqual({ type: "local", localPath: "~/code/project" });
  });

  it("returns unknown for empty string", () => {
    expect(parseRepoInput("")).toEqual({ type: "unknown" });
  });

  it("returns unknown for random text", () => {
    expect(parseRepoInput("hello world")).toEqual({ type: "unknown" });
  });

  it("returns unknown for triple-segment path without leading slash", () => {
    expect(parseRepoInput("a/b/c")).toEqual({ type: "unknown" });
  });
});
