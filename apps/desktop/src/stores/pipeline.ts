import { parseAgentDefinition } from "../../../../packages/core/src/pipeline/agent-loader";
import { parsePipelineJson } from "../../../../packages/core/src/pipeline/pipeline-loader";
import { buildStagePrompt } from "../../../../packages/core/src/pipeline/prompt-builder";
import { getNextStage } from "../../../../packages/core/src/pipeline/types";
import type { AgentDefinition, PipelineDefinition } from "../../../../packages/core/src/pipeline/pipeline-types";
import { clearPipelineItemStageResult, getRepo } from "@kanna/db";
import { invoke } from "../invoke";
import { buildTaskRuntimeEnv } from "./kannaCliEnv";
import {
  getPreferredAgentProviders,
  resolveAgentProvider,
} from "./agent-provider";
import { resolveDbName } from "./db";
import { requireService, type StoreContext } from "./state";

export interface PipelineApi {
  loadPipeline: (repoPath: string, pipelineName: string) => Promise<PipelineDefinition>;
  loadAgent: (repoPath: string, agentName: string) => Promise<AgentDefinition>;
  advanceStage: (taskId: string) => Promise<void>;
  rerunStage: (taskId: string) => Promise<void>;
}

export function createPipelineApi(context: StoreContext): PipelineApi {
  function buildWorktreePath(repoPath: string, branch: string): string {
    return `${repoPath}/.kanna-worktrees/${branch}`;
  }

  function resolveSourceWorktree(repoPath: string, branch: string | null | undefined): string | undefined {
    if (!branch) return undefined;
    return buildWorktreePath(repoPath, branch);
  }

  function resolvePriorTaskSourceWorktree(repoPath: string, baseRef: string | null): string | undefined {
    if (!baseRef?.startsWith("task-")) return undefined;
    return buildWorktreePath(repoPath, baseRef);
  }

  function computeNextVisibleItemId(currentItemId: string): string | null {
    const sortedItems = requireService(context.services.sortedItemsForCurrentRepo, "sortedItemsForCurrentRepo").value;
    const currentIndex = sortedItems.findIndex((candidate) => candidate.id === currentItemId);
    if (currentIndex === -1) return null;

    const remainingItems = sortedItems.filter((candidate) => candidate.id !== currentItemId);
    const nextIndex = currentIndex >= remainingItems.length ? remainingItems.length - 1 : currentIndex;
    return remainingItems[nextIndex]?.id ?? null;
  }

  async function restoreStageAdvanceSelection(itemId: string | null) {
    if (itemId) {
      const item = context.state.items.value.find((candidate) => candidate.id === itemId);
      const isItemHidden = requireService(context.services.isItemHidden, "isItemHidden");
      if (item && !isItemHidden(item) && item.repo_id === context.state.selectedRepoId.value) {
        await requireService(context.services.selectItem, "selectItem")(itemId);
        return;
      }
    }

    context.state.selectedItemId.value = null;
  }

  async function loadPipeline(repoPath: string, pipelineName: string): Promise<PipelineDefinition> {
    const cacheKey = `${repoPath}::${pipelineName}`;
    const cached = context.state.pipelineCache.get(cacheKey);
    if (cached) return cached;

    let pipeline: PipelineDefinition;
    try {
      const path = `${repoPath}/.kanna/pipelines/${pipelineName}.json`;
      const content = await invoke<string>("read_text_file", { path });
      pipeline = parsePipelineJson(content);
    } catch {
      try {
        const content = await invoke<string>("read_builtin_resource", {
          relativePath: `.kanna/pipelines/${pipelineName}.json`,
        });
        pipeline = parsePipelineJson(content);
      } catch (error) {
        throw new Error(
          `Pipeline "${pipelineName}" not found: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        );
      }
    }

    context.state.pipelineCache.set(cacheKey, pipeline);
    return pipeline;
  }

  async function loadAgent(repoPath: string, agentName: string): Promise<AgentDefinition> {
    const cacheKey = `${repoPath}::${agentName}`;
    const cached = context.state.agentCache.get(cacheKey);
    if (cached) return cached;

    let agent: AgentDefinition;
    try {
      const path = `${repoPath}/.kanna/agents/${agentName}/AGENT.md`;
      const content = await invoke<string>("read_text_file", { path });
      agent = parseAgentDefinition(content);
    } catch {
      try {
        const content = await invoke<string>("read_builtin_resource", {
          relativePath: `.kanna/agents/${agentName}/AGENT.md`,
        });
        agent = parseAgentDefinition(content);
      } catch (error) {
        throw new Error(
          `Agent "${agentName}" not found on disk or in bundled resources: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        );
      }
    }

    context.state.agentCache.set(cacheKey, agent);
    return agent;
  }

  async function hasUnresolvedBlockers(itemId: string): Promise<boolean> {
    const { listBlockersForItem } = await import("@kanna/db");
    const blockers = await listBlockersForItem(context.requireDb(), itemId);
    return blockers.some((blocker) => blocker.closed_at === null);
  }

  async function advanceStage(taskId: string): Promise<void> {
    const item = context.state.items.value.find((candidate) => candidate.id === taskId);
    if (!item?.branch) return;

    const repo = context.state.repos.value.find((candidate) => candidate.id === item.repo_id)
      ?? await getRepo(context.requireDb(), item.repo_id);
    if (!repo) {
      console.error("[store] advanceStage: repo not found for", taskId);
      return;
    }

    let pipeline: PipelineDefinition;
    try {
      pipeline = await loadPipeline(repo.path, item.pipeline);
    } catch (error) {
      console.error("[store] advanceStage: pipeline definition not found:", error);
      context.toast.error(context.tt("toasts.pipelineNotFound"));
      return;
    }

    const nextStage = getNextStage(pipeline, item.stage);
    if (!nextStage) {
      context.toast.warning(context.tt("toasts.taskAtFinalStage"));
      return;
    }

    if (await hasUnresolvedBlockers(taskId)) {
      context.toast.warning(context.tt("toasts.taskBlocked"));
      return;
    }

    const shouldFollowTask = nextStage.follow_task !== false;
    const preservedSelectionId = shouldFollowTask ? null : computeNextVisibleItemId(item.id);

    let stagePrompt = "";
    let agentOpts: Record<string, unknown> = { agentProvider: item.agent_provider };

    if (nextStage.agent) {
      try {
        const agent = await loadAgent(repo.path, nextStage.agent);
        const prevResult = item.stage_result ?? undefined;
        stagePrompt = buildStagePrompt(agent.prompt, nextStage.prompt, {
          taskPrompt: item.prompt ?? "",
          prevResult,
          branch: item.branch ?? undefined,
          sourceWorktree: resolveSourceWorktree(repo.path, item.branch),
        });

        const preferredProviders = getPreferredAgentProviders({
          stage: nextStage.agent_provider as import("@kanna/db").AgentProvider | import("@kanna/db").AgentProvider[] | undefined,
          agent: agent.agent_provider as import("@kanna/db").AgentProvider | import("@kanna/db").AgentProvider[] | undefined,
          item: item.agent_provider,
        });
        const resolvedProvider = resolveAgentProvider(
          preferredProviders,
          await requireService(context.services.getAgentProviderAvailability, "getAgentProviderAvailability")(),
        );

        agentOpts = {
          agentProvider: resolvedProvider,
          model: agent.model,
          permissionMode: agent.permission_mode,
          allowedTools: agent.allowed_tools,
        };
      } catch (error) {
        console.error("[store] advanceStage: failed to load agent:", error);
        context.toast.error(`${context.tt("toasts.agentStartFailed")}: ${error instanceof Error ? error.message : error}`);
        return;
      }
    }

    await requireService(context.services.closeTask, "closeTask")(item.id, { selectNext: false });
    await requireService(context.services.createItem, "createItem")(repo.id, repo.path, stagePrompt, "pty", {
      baseBranch: item.branch,
      pipelineName: item.pipeline,
      stage: nextStage.name,
      selectOnCreate: shouldFollowTask,
      ...agentOpts,
    });

    if (!shouldFollowTask) {
      await restoreStageAdvanceSelection(preservedSelectionId);
    }
  }

  function parseTaskPortEnv(portEnv: string | null): Record<string, string> | undefined {
    if (!portEnv) return undefined;
    return JSON.parse(portEnv) as Record<string, string>;
  }

  async function rerunStage(taskId: string): Promise<void> {
    const item = context.state.items.value.find((candidate) => candidate.id === taskId);
    if (!item) return;
    if (!item.branch) return;

    const repo = context.state.repos.value.find((candidate) => candidate.id === item.repo_id)
      ?? await getRepo(context.requireDb(), item.repo_id);
    if (!repo) return;

    let pipeline: PipelineDefinition;
    try {
      pipeline = await loadPipeline(repo.path, item.pipeline);
    } catch (error) {
      console.error("[store] rerunStage: pipeline not found:", error);
      context.toast.error(context.tt("toasts.pipelineNotFound"));
      return;
    }

    const currentStage = pipeline.stages.find((stage) => stage.name === item.stage);
    if (!currentStage) {
      console.error("[store] rerunStage: stage not found:", item.stage);
      context.toast.error(context.tt("toasts.stageNotFound"));
      return;
    }

    await clearPipelineItemStageResult(context.requireDb(), taskId);

    if (currentStage.environment) {
      const env = pipeline.environments?.[currentStage.environment];
      if (env?.setup?.length) {
        const worktreePath = buildWorktreePath(repo.path, item.branch);
        try {
          const portEnv = parseTaskPortEnv(item.port_env);
          const scriptEnv = buildTaskRuntimeEnv({
            taskId,
            dbName: await resolveDbName(),
            appDataDir: await invoke<string>("get_app_data_dir"),
            socketPath: await invoke<string>("get_pipeline_socket_path"),
            portEnv,
            kannaCliPath: await invoke<string>("which_binary", { name: "kanna-cli" }).catch(() => null),
          });
          for (const script of env.setup) {
            await invoke("run_script", { script, cwd: worktreePath, env: scriptEnv });
          }
        } catch (error) {
          console.error("[store] rerunStage: setup script failed:", error);
          context.toast.error(context.tt("toasts.stageSetupFailed"));
          return;
        }
      }
    }

    if (currentStage.agent) {
      try {
        const agent = await loadAgent(repo.path, currentStage.agent);
        const stagePrompt = buildStagePrompt(agent.prompt, currentStage.prompt, {
          taskPrompt: item.prompt ?? "",
          branch: item.branch ?? undefined,
          sourceWorktree: resolvePriorTaskSourceWorktree(repo.path, item.base_ref),
        });
        const worktreePath = buildWorktreePath(repo.path, item.branch);
        const preferredProviders = getPreferredAgentProviders({
          stage: currentStage.agent_provider as import("@kanna/db").AgentProvider | import("@kanna/db").AgentProvider[] | undefined,
          agent: agent.agent_provider as import("@kanna/db").AgentProvider | import("@kanna/db").AgentProvider[] | undefined,
          item: item.agent_provider,
        });
        const agentProvider = resolveAgentProvider(
          preferredProviders,
          await requireService(context.services.getAgentProviderAvailability, "getAgentProviderAvailability")(),
        );

        await invoke("kill_session", { sessionId: taskId }).catch((error: unknown) =>
          console.error("[store] kill_session before rerun failed:", error),
        );

        await requireService(context.services.spawnPtySession, "spawnPtySession")(taskId, worktreePath, stagePrompt, 80, 24, {
          agentProvider,
          model: agent.model,
          permissionMode: agent.permission_mode,
          allowedTools: agent.allowed_tools,
        });
      } catch (error) {
        console.error("[store] rerunStage: agent spawn failed:", error);
        context.toast.error(`${context.tt("toasts.agentStartFailed")}: ${error instanceof Error ? error.message : error}`);
      }
    }

    await requireService(context.services.reloadSnapshot, "reloadSnapshot")();
  }

  return {
    loadPipeline,
    loadAgent,
    advanceStage,
    rerunStage,
  };
}
