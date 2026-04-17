// @vitest-environment happy-dom

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mount } from "@vue/test-utils";
import type { PipelineItem } from "@kanna/db";
import type { Component } from "vue";
import { afterAll, describe, expect, it } from "vitest";

function makeItem(overrides: Partial<PipelineItem> = {}): PipelineItem {
  return {
    id: "task-1",
    repo_id: "repo-1",
    issue_number: null,
    issue_title: null,
    prompt: "Fix handoff",
    pipeline: "default",
    stage: "in progress",
    stage_result: null,
    tags: "[]",
    pr_number: null,
    pr_url: null,
    branch: "task-1",
    closed_at: null,
    agent_type: "pty",
    agent_provider: "claude",
    activity: "idle",
    activity_changed_at: null,
    unread_at: null,
    port_offset: null,
    display_name: null,
    port_env: null,
    pinned: 0,
    pin_order: null,
    base_ref: "main",
    claude_session_id: null,
    previous_stage: null,
    created_at: "2026-04-08T00:00:00Z",
    updated_at: "2026-04-08T00:00:00Z",
    ...overrides,
  };
}

const testDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(testDir, "../../..");
const actionBarPath = fileURLToPath(new URL("../ActionBar.vue", import.meta.url));

interface CompilerSfcModule {
  parse: (source: string, options?: { filename?: string }) => {
    descriptor: unknown;
    errors: Array<unknown>;
  };
  compileScript: (
    descriptor: unknown,
    options: { id: string; inlineTemplate: boolean },
  ) => { content: string };
}

let actionBarComponentPromise: Promise<Component> | null = null;
let compiledTempDir: string | null = null;

interface MountGlobals {
  Element?: unknown;
  Node?: {
    COMMENT_NODE: number;
  };
  SVGElement?: unknown;
  HTMLElement?: unknown;
}

const mountGlobals = globalThis as unknown as MountGlobals;
if (typeof mountGlobals.Element === "undefined") {
  mountGlobals.Element =
    typeof mountGlobals.HTMLElement === "function" ? mountGlobals.HTMLElement : class {};
}
if (typeof mountGlobals.SVGElement === "undefined") {
  mountGlobals.SVGElement =
    typeof mountGlobals.Element === "function" ? mountGlobals.Element : class {};
}
if (typeof mountGlobals.Node === "undefined") {
  mountGlobals.Node = { COMMENT_NODE: 8 };
}

async function loadActionBar(): Promise<Component> {
  if (!actionBarComponentPromise) {
    actionBarComponentPromise = (async () => {
      const compilerBunDir = resolve(appRoot, "../../node_modules/.bun");
      const compilerPackageDir = readdirSync(compilerBunDir).find((entry) =>
        entry.startsWith("@vue+compiler-sfc@")
      );
      const vuePackageDir = readdirSync(compilerBunDir).find((entry) =>
        entry.startsWith("vue@")
      );
      if (!compilerPackageDir) {
        throw new Error("unable to locate @vue/compiler-sfc in bun node_modules");
      }
      if (!vuePackageDir) {
        throw new Error("unable to locate vue runtime in bun node_modules");
      }

      const compilerModulePath = resolve(
        compilerBunDir,
        compilerPackageDir,
        "node_modules/@vue/compiler-sfc/dist/compiler-sfc.cjs.js",
      );
      const vueRuntimePath = resolve(
        compilerBunDir,
        vuePackageDir,
        "node_modules/vue/dist/vue.runtime.esm-bundler.js",
      );
      const vueRuntimeUrl = pathToFileURL(vueRuntimePath).href;
      const compiler = await import(pathToFileURL(compilerModulePath).href) as CompilerSfcModule;

      const source = readFileSync(actionBarPath, "utf8");
      const parsed = compiler.parse(source, { filename: actionBarPath });
      if (parsed.errors.length > 0) {
        throw new Error(`failed to parse ActionBar.vue: ${String(parsed.errors[0])}`);
      }

      const script = compiler.compileScript(parsed.descriptor, {
        id: "action-bar-test",
        inlineTemplate: true,
      });
      const runtimeCode = script.content.replace(
        /^\s*import\s+type\s+\{[^}]+\}\s+from\s+["']@kanna\/db["'];\n?/m,
        "",
      ).replace(/from\s+["']vue["']/g, `from "${vueRuntimeUrl}"`);

      compiledTempDir = mkdtempSync(join(tmpdir(), "action-bar-test-"));
      const compiledPath = join(compiledTempDir, "ActionBar.compiled.ts");
      writeFileSync(compiledPath, runtimeCode, "utf8");

      const compiled = await import(pathToFileURL(compiledPath).href);
      return compiled.default as Component;
    })();
  }
  return actionBarComponentPromise;
}

afterAll(() => {
  if (compiledTempDir) {
    rmSync(compiledTempDir, { recursive: true, force: true });
  }
});

describe("ActionBar", () => {
  it("shows push-to-machine for active tasks", async () => {
    const ActionBar = await loadActionBar();
    const wrapper = mount(ActionBar, {
      props: { item: makeItem() },
      global: {
        mocks: {
          $t: (key: string) =>
            key === "taskTransfer.pushToMachine" ? "Push to Machine" : key,
        },
      },
    });

    expect(wrapper.text()).toContain("Push to Machine");
  });
});
