/**
 * sFlow Plugin Entry Point
 *
 * Architecture follows oh-my-openagent's create-plugin-module pattern:
 * - Tools registered via Hooks.tool (Record<string, ToolDefinition>)
 * - Agents registered via config hook (cfg.agent)
 * - MCP servers registered via config hook (cfg.mcp)
 * - No `as any` — all types align with @opencode-ai/plugin
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule, ToolDefinition } from '@opencode-ai/plugin';
import type { Message, Part } from '@opencode-ai/sdk';
import { z } from 'zod';

type SFlowClient = PluginInput['client'];

export { Validator, isValidStateRecord } from '@opencode-flow-engine/core';
export type {
  Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change,
  WorkflowState, WorkflowMode, WorkflowStateFile, WorkflowStateRecord,
  ValidationReport, ValidationIssue, VerificationReport, ConflictReport,
} from '@opencode-flow-engine/core';

import {
  getAgentNames, getAgentMode, createAgent,
} from './agents/index.js';
export {
  createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent,
  createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent,
  createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent,
  createUiImplementerAgent,
  createIFlowAgent, createIFlowDiscussPlannerAgent, createIFlowPlanExecutorAgent,
  createIFlowVerifierAgent, createIFlowResearcherAgent, createIFlowShipperAgent,
} from './agents/index.js';
export type {
  ModelProvenance, ModelResolutionResult,
} from './agents/index.js';

import { createWorkflowRouterTool } from './tools/index.js';

export {
  createWorkflowRouterTool, createIFlowRouterTool, createContractValidatorTool, createArtifactInspectorTool,
} from './tools/index.js';

export {
  createStateTransitionHook, createArtifactValidationHook, createGuardHook,
  createSessionStartHook, createSessionEndHook,
  createPreProcessHook, createPostProcessHook, createContinuationHook,
} from './hooks/index.js';

export {
  createWorkflowManager, createStateManager,
  BuiltinMcpRegistry, createValidatorTools,
} from './features/index.js';

export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-flow-engine/shared';

import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import { readJsonFile } from '@opencode-flow-engine/shared';
import type { HookContext } from './hooks/types.js';
import { sharedValidator } from '@opencode-flow-engine/core';
import { fileExists as sflowFileExists, directoryExists, readFile as sflowReadFile, ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { isContractStale, sleep as crossSleep } from '@opencode-flow-engine/shared';
import { detectStateMismatch, simpleHash, getStateFilePath } from './features/state-manager.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { createValidatorTools, createWorkflowTools } from './features/builtin-mcp.js';
import { setHasOmoPlugin, setHasAgnesProvider } from './agents/agent-tools.js';
import { markOmoUsed, resetOmoTracking } from './hooks/guard.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';

/** 
 * PLUGIN_ID: 'opencode-sflow' for backward compatibility.
 * The project was renamed to opencode-flow-engine (方案 C),
 * but existing users reference the plugin by the old ID in opencode.json.
 */
export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_NAME = 'opencode-flow-engine';
export const PLUGIN_VERSION = '1.0.0';

/** sFlow native tool names (used in tool.execute.after for post-processing) */
const SFLOW_TOOLS = new Set(['workflow_router', 'iflow_router', 'contract_validator', 'artifact_inspector', 'validate_spec', 'validate_proposal', 'validate_delta_spec', 'validate_tasks', 'validate_contract', 'validate_design', 'validate_implementation', 'detect_sync_conflicts', 'record_decision_point', 'call_flow_agent', 'flowagent_output', 'flowagent_cancel']);

/**
 * Agent color mapping
 */
const AGENT_COLORS: Record<string, string> = {
  sFlow: '#f8cd93',
  iFlow: '#FFB6C1',
};

/**
 * Agent → model mapping populated during config hook.
 * Used by call_flow_agent to explicitly pass the model when creating
 * subagent sessions — ensures OpenCode assigns the correct model
 * even when the subagent's mode is 'subagent'.
 */
const AGENT_MODEL_MAP: Record<string, string> = {};

// Lightweight in-memory background task registry
// Maps taskId → { sessionID, status, result, error }
interface BackgroundTaskEntry {
  sessionID: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}
const backgroundTaskRegistry = new Map<string, BackgroundTaskEntry>();
let backgroundTaskCounter = 0;

function generateTaskId(): string {
  backgroundTaskCounter++;
  return `sf_${Date.now()}_${backgroundTaskCounter}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const IFLOW_STATES = new Set(['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCurrentWorkflowState(changeDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  return state?.state ?? null;
}

/** Promise-based sleep (cross-runtime compatible) */
const sleep = crossSleep;

/** Format a tool error response */
function formatToolOutput(title: string, success: boolean, data: Record<string, unknown>): { title: string; output: string } {
  return { title, output: JSON.stringify({ success, ...data }, null, 2) };
}
function formatToolError(msg: string): { title: string; output: string } {
  return formatToolOutput('Error', false, { error: msg });
}

// ─── Tool definitions using @opencode-ai/plugin ToolDefinition format ──────────




/**
 * Detect oh-my-openagent from cfg.plugin list.
 * Called during config hook to set the hasOmoPlugin flag for agent-tools.
 */
function detectOmoPlugin(pluginConfig: (string | [string, Record<string, unknown>])[] | undefined): boolean {
  if (!pluginConfig) return false;
  return pluginConfig.some(p => {
    const name = Array.isArray(p) ? p[0] : p;
    return name === 'oh-my-openagent'
      || name === 'oh-my-opencode'
      || name.startsWith('oh-my-openagent')
      || name.startsWith('oh-my-opencode')
      || name === 'omo';
  });
}

/**
 * Detect agnesmore provider from cfg.provider or cfg.plugin.
 * Called during config hook to set the hasAgnesProvider flag for agent-tools.
 */
async function detectAgnesProvider(cfg: { provider?: Record<string, unknown>; plugin?: (string | [string, Record<string, unknown>])[] }): Promise<boolean> {
  if (cfg.provider && 'agnesmore' in cfg.provider) return true;
  if (cfg.plugin) {
    const hasPlugin = cfg.plugin.some(p => {
      const name = Array.isArray(p) ? p[0] : p;
      return name === 'agnesmore';
    });
    if (hasPlugin) return true;
  }
  try {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    return existsSync(join(homedir(), '.agnesmore', 'auth.json'));
  } catch {
    return false;
  }
}

function createSFlowTools(client: SFlowClient): Record<string, ToolDefinition> {
  return {
    workflow_router: {
      description: 'Detect current workflow state and route to the appropriate agent. Supports GO.md-style intent matching.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        
        return createWorkflowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

    iflow_router: {
      description: 'Detect current IFlow state from .iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        const { createIFlowRouterTool } = await import('./tools/iflow-router.js');
        return createIFlowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

    contract_validator: {
      description: 'Validate execution contract for correctness and completeness',
      args: {
        contract_path: z.string().optional().describe('Path to the execution contract file'),
      },
      execute: async (args: { contract_path?: string }, context) => {
        const changeDir = args.contract_path
          ? args.contract_path.replace(/[/\\]execution-contract\.md$/, '')
          : context.directory || '';
        const result = await executeContractValidator(changeDir);
        return { title: 'Contract Validator', output: JSON.stringify(result, null, 2) };
      },
    },

    artifact_inspector: {
      description: 'Inspect planning artifacts for completeness and consistency',
      args: {
        artifact_path: z.string().optional().describe('Path to the artifact or change directory'),
      },
      execute: async (args: { artifact_path?: string }, context) => {
        const changeDir = args.artifact_path
          ? args.artifact_path.replace(/[/\\](proposal|design|tasks)\.md$/, '').replace(/[/\\]specs$/, '')
          : context.directory || '';
        const result = await executeArtifactInspector(changeDir);
        return { title: 'Artifact Inspector', output: JSON.stringify(result, null, 2) };
      },
    },

    call_flow_agent: {
      description: 'Invoke a specialized sFlow subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.',
      args: {
        description: z.string().describe('Short (3-5 words) description of the task'),
        prompt: z.string().describe('The task for the subagent to perform'),
        subagent_type: z.string().describe('The subagent to invoke (e.g. build-executor, spec-writer)'),
        run_in_background: z.boolean().describe('true=async (returns task_id for flowagent_output), false=sync (waits for completion)'),
        session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { subagent_type, prompt, run_in_background, session_id, description } = args;

        const isIFlowContext = await directoryExists(`${changeDir}/.iflow`);

        if (isIFlowContext) {
          const validIFlowAgents = IFLOW_AGENT_NAMES as readonly string[];
          if (!validIFlowAgents.includes(subagent_type as string)) {
            return await formatToolError(
              `Invalid IFlow agent: "${subagent_type}". Available IFlow agents: ${validIFlowAgents.join(', ')}`,
            );
          }
        }

        const workflowPrefix = isIFlowContext ? 'iFlow' : 'sFlow';
        const sessionLabel = `${workflowPrefix} → ${subagent_type}`;
        const MAX_WAIT_MS = 30_000;
        const POLL_INTERVAL_MS = 500;

        try {
          // Resolve the session to use
          let sessionID: string;
          let isNew = false;

          // Look up the subagent's model (needed for both create and prompt)
          const subagentModel = AGENT_MODEL_MAP[subagent_type as string];
          if (!subagentModel) {
            return await formatToolError(
              `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(AGENT_MODEL_MAP).join(', ')}`,
            );
          }

          if (session_id) {
            if (run_in_background) {
              return await formatToolError('session_id is not supported in background mode. Use run_in_background=false to continue an existing session.');
            }
            sessionID = session_id as string;
          } else {
            const createResult = await (client.session.create as (args: {
              body: { parentID?: string; title?: string };
              query?: { directory?: string };
            }) => Promise<{ data?: { id?: string } }>)({
              body: {
                parentID: context.sessionID,
                title: sessionLabel,
              },
              query: { directory: changeDir },
            });
            const id = createResult.data?.id;
            if (!id) {
              return await formatToolError('Failed to create subagent session');
            }
            sessionID = id;
            isNew = true;
          }

          // Send the prompt to the subagent with agent and model
          const modelParts = subagentModel.split('/');
          const modelObj = modelParts.length >= 2
            ? { providerID: modelParts[0], modelID: modelParts.slice(1).join('/') }
            : { providerID: subagentModel, modelID: subagentModel };
          await (client.session.prompt as (args: {
            path: { id: string };
            body: Record<string, unknown>;
          }) => Promise<unknown>)({
            path: { id: sessionID },
            body: {
              agent: subagent_type as string,
              model: modelObj,
              parts: [{ type: 'text', text: prompt as string }],
            },
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to send prompt: ${msg}`);
          });

          if (run_in_background) {
            // Async mode: register task and return immediately
            const taskId = generateTaskId();
            backgroundTaskRegistry.set(taskId, {
              sessionID,
              status: 'running',
              createdAt: Date.now(),
            });
            return {
              title: sessionLabel,
              output: JSON.stringify({
                success: true,
                task_id: taskId,
                session_id: sessionID,
                status: 'running',
                description,
                agent: subagent_type,
              }, null, 2),
            };
          }
          // Sync mode: poll for completion using shared pollSessionCompletion
          const lastOutput = await pollSessionCompletion(
            client as unknown as { session: import("./helpers/polling.js").SFlowClientSession },
            sessionID,
            { isNew },
          ) || '(no output)';

          const syncTaskId = generateTaskId();
          backgroundTaskRegistry.set(syncTaskId, {
            sessionID,
            status: 'completed',
            result: lastOutput,
            createdAt: Date.now(),
            completedAt: Date.now(),
          });

          return {
            title: sessionLabel,
            output: JSON.stringify({
              success: true,
              subagent: subagent_type,
              sessionID,
              task_id: syncTaskId,
              output: lastOutput,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: sessionLabel,
            output: JSON.stringify({
              success: false,
              subagent: subagent_type,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    /**
     * sFlow native background output retrieval.
     * Named flowagent_output to avoid collision with oh-my-openagent's background_output.
     */
    flowagent_output: {
      description: 'Retrieve results from a background sFlow subagent task (call_flow_agent async mode). Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).',
      args: {
        task_id: z.string().describe('The task ID returned by call_flow_agent (run_in_background=true, prefix: sf_)'),
        block: z.boolean().optional().describe('Wait for completion (default: false)'),
      },
      execute: async (args: { task_id: string; block?: boolean }, _context) => {
        const { task_id, block } = args;

        // Poll the live session to check if the subagent has completed.
        // This is necessary because async mode tasks are created with status='running'
        // and there is no automatic callback to update the in-memory registry.
        // When a session becomes idle, we read its messages and update the registry.
        const pollAndComplete = async (task: BackgroundTaskEntry): Promise<BackgroundTaskEntry> => {
          const output = await pollSessionCompletion(
            client as unknown as { session: import('./helpers/polling.js').SFlowClientSession },
            task.sessionID,
            { maxWaitMs: 120000 },
          );
          const now = Date.now();
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'completed',
            result: output || '(no output)',
            completedAt: now,
          };
          backgroundTaskRegistry.set(task_id, updated);
          return updated;
        };

        const buildResponse = (task: BackgroundTaskEntry) => ({
          title: 'FlowAgent Output',
          output: JSON.stringify({
            success: task.status !== 'error',
            task_id,
            status: task.status,
            session_id: task.sessionID,
            result: task.result,
            error: task.error,
          }, null, 2),
        });

        try {
          const existingTask = backgroundTaskRegistry.get(task_id);
          if (!existingTask) {
            return { title: 'FlowAgent Output', output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2) };
          }

          if (!block) {
            // Non-blocking: return current in-memory status
            return buildResponse(existingTask);
          }

          // Blocking: wait for completion, live-polling the session if needed
          const completed = existingTask.status !== 'running'
            ? existingTask
            : await pollAndComplete(existingTask);
          return buildResponse(completed);
        } catch (error) {
          return {
            title: 'FlowAgent Output',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    /**
     * sFlow native background task cancellation.
     * Named flowagent_cancel to avoid collision with oh-my-openagent's background_cancel.
     */
    flowagent_cancel: {
      description: 'Cancel a running sFlow subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.',
      args: {
        taskId: z.string().describe('Task ID to cancel (required, prefix: sf_)'),
      },
      execute: async (args: { taskId: string }, _context) => {
        const { taskId } = args;
        try {
          const task = backgroundTaskRegistry.get(taskId);
          if (!task) {
            return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: false, error: `Task ${taskId} not found` }, null, 2) };
          }
          if (task.status !== 'running') {
            return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} already in status: ${task.status}` }, null, 2) };
          }

          // Abort the session if possible
          try {
            await client.session.abort({ path: { id: task.sessionID } });
          } catch {
            // session.abort may not be available; mark cancelled anyway
          }

          backgroundTaskRegistry.delete(taskId);
          return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} cancelled and removed` }, null, 2) };
        } catch (error) {
          return {
            title: 'FlowAgent Cancel',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    /**
     * Agnesmore image generation tool.
     * Available when agnesmore provider is detected.
     * Reads API key from ~/.agnesmore/auth.json, calls Agnes Image API,
     * downloads result to project assets/ directory.
     */
    agnes_image_generate: {
      description: 'Generate an image using agnesmore provider. Requires agnesmore plugin installed and configured.',
      args: {
        prompt: z.string().describe('Text description of the image to generate. Use format: [subject] + [scene] + [style] + [lighting] + [composition]'),
        output_path: z.string().optional().describe('Relative path to save the image (e.g. "public/images/hero.png"). Defaults to src/assets/images/<timestamp>.png'),
        size: z.string().optional().describe('Size tier: 1K, 2K, 3K, 4K (default: 1K)'),
        ratio: z.string().optional().describe('Aspect ratio: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9 (default: 1:1)'),
      },
      execute: async (args: { prompt: string; output_path?: string; size?: string; ratio?: string }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile, writeFile, mkdir } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, dirname } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const size = args.size || '1K';
          const ratio = args.ratio || '1:1';

          const response = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'agnes-image-2.1-flash',
              prompt: args.prompt,
              size,
              ratio,
              extra_body: { response_format: 'url' },
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: `API error ${response.status}: ${errText}` }, null, 2) };
          }

          const data = await response.json() as { data?: Array<{ url?: string }> };
          const imageUrl = data?.data?.[0]?.url;
          if (!imageUrl) {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: 'No image URL in response' }, null, 2) };
          }

          const imgResponse = await fetch(imageUrl);
          if (!imgResponse.ok) {
            return { title: 'Agnes Image Gen', output: JSON.stringify({ success: false, error: `Failed to download image: ${imgResponse.status}` }, null, 2) };
          }
          const imgBuffer = await imgResponse.arrayBuffer();

          const outputPath = args.output_path || `src/assets/images/gen-${Date.now()}.png`;
          const fullPath = join(changeDir, outputPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, Buffer.from(imgBuffer));

          return {
            title: 'Agnes Image Gen',
            output: JSON.stringify({
              success: true,
              prompt: args.prompt,
              size: `${size} ${ratio}`,
              output_path: outputPath,
              image_url: imageUrl,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Image Gen',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    /**
     * Agnesmore video generation tool.
     * Available when agnesmore provider is detected.
     * Creates async video task, polls until completion, downloads result.
     */
    agnes_video_generate: {
      description: 'Generate a video using agnesmore provider. Requires agnesmore plugin installed and configured.',
      args: {
        prompt: z.string().describe('Text description of the video. Use format: [subject] + [action] + [scene] + [camera movement] + [style]'),
        output_path: z.string().optional().describe('Relative path to save the video (e.g. "public/videos/hero.mp4"). Defaults to src/assets/videos/<timestamp>.mp4'),
        width: z.number().optional().describe('Video width (default: 1152)'),
        height: z.number().optional().describe('Video height (default: 768)'),
        num_frames: z.number().optional().describe('Number of frames (max 441, must be 8n+1). Default: 121 (~5s at 24fps)'),
        frame_rate: z.number().optional().describe('Frame rate 1-60 (default: 24)'),
      },
      execute: async (args: { prompt: string; output_path?: string; width?: number; height?: number; num_frames?: number; frame_rate?: number }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile, writeFile, mkdir } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, dirname } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const createResponse = await fetch('https://apihub.agnes-ai.com/v1/videos', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'agnes-video-v2.0',
              prompt: args.prompt,
              width: args.width || 1152,
              height: args.height || 768,
              num_frames: args.num_frames || 121,
              frame_rate: args.frame_rate || 24,
            }),
          });

          if (!createResponse.ok) {
            const errText = await createResponse.text();
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: `Create task error ${createResponse.status}: ${errText}` }, null, 2) };
          }

          const taskData = await createResponse.json() as { video_id?: string; task_id?: string; status?: string };
          const videoId = taskData.video_id || taskData.task_id || '';
          if (!videoId) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'No video/task ID in response' }, null, 2) };
          }

          const maxAttempts = 60;
          const pollIntervalMs = 5000;
          let videoUrl = '';
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(r => setTimeout(r, pollIntervalMs));
            const pollResponse = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}`, {
              headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (!pollResponse.ok) continue;
            const pollData = await pollResponse.json() as { status?: string; url?: string };
            if (pollData.status === 'completed' && pollData.url) {
              videoUrl = pollData.url;
              break;
            }
            if (pollData.status === 'failed') {
              return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Video generation failed' }, null, 2) };
            }
          }

          if (!videoUrl) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: 'Video generation timed out after 5 minutes' }, null, 2) };
          }

          const videoResponse = await fetch(videoUrl);
          if (!videoResponse.ok) {
            return { title: 'Agnes Video Gen', output: JSON.stringify({ success: false, error: `Failed to download video: ${videoResponse.status}` }, null, 2) };
          }
          const videoBuffer = await videoResponse.arrayBuffer();

          const outputPath = args.output_path || `src/assets/videos/gen-${Date.now()}.mp4`;
          const fullPath = join(changeDir, outputPath);
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, Buffer.from(videoBuffer));

          return {
            title: 'Agnes Video Gen',
            output: JSON.stringify({
              success: true,
              prompt: args.prompt,
              output_path: outputPath,
              video_url: videoUrl,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Video Gen',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    /**
     * Agnesmore image understanding tool.
     * Uses agnes-2.0-flash multimodal model to analyze images.
     */
    agnes_image_understand: {
      description: 'Analyze an image using agnesmore multimodal model. Requires agnesmore plugin installed and configured.',
      args: {
        image_path: z.string().describe('Path to the image file to analyze (e.g. "screenshots/page.png")'),
        prompt: z.string().optional().describe('Question or instruction about the image (default: "请详细描述这张图片的内容")'),
      },
      execute: async (args: { image_path: string; prompt?: string }, context) => {
        const changeDir = context.directory || process.cwd();
        try {
          const { readFile } = await import('node:fs/promises');
          const { homedir } = await import('node:os');
          const { join, extname } = await import('node:path');

          let apiKey: string;
          try {
            const authContent = await readFile(join(homedir(), '.agnesmore', 'auth.json'), 'utf-8');
            const auth = JSON.parse(authContent);
            apiKey = auth.keys?.[0] || '';
            if (!apiKey) throw new Error('No API key found');
          } catch {
            return { title: 'Agnes Image Understand', output: JSON.stringify({ success: false, error: 'Agnesmore auth not found or invalid. Run /connect in OpenCode to configure agnesmore first.' }, null, 2) };
          }

          const imagePath = join(changeDir, args.image_path);
          const ext = extname(args.image_path).toLowerCase();
          const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
          const mime = mimeMap[ext] || 'image/png';

          const imageBuffer = await readFile(imagePath);
          const base64 = imageBuffer.toString('base64');

          const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'agnes-2.0-flash',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: args.prompt || '请详细描述这张图片的内容' },
                  { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
                ],
              }],
            }),
          });

          if (!response.ok) {
            const errText = await response.text();
            return { title: 'Agnes Image Understand', output: JSON.stringify({ success: false, error: `API error ${response.status}: ${errText}` }, null, 2) };
          }

          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = data?.choices?.[0]?.message?.content || '(empty response)';

          return {
            title: 'Agnes Image Understand',
            output: JSON.stringify({
              success: true,
              image: args.image_path,
              prompt: args.prompt || '请详细描述这张图片的内容',
              analysis: content,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Agnes Image Understand',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },
  };
};

// ─── Tool execution logic ─────────────────────────────────────────────────────

// Delegates to canonical detectWorkflowState() — single source of truth.
// Replaces the earlier inline implementation that was missing ui-design/frontend support.
async function executeWorkflowRouter(changeDir: string) {
  const detection = await detectWorkflowState(changeDir);
  return {
    state: detection.state,
    skill: detection.skill,
    reasons: detection.reasons,
    artifacts: detection.artifacts,
  };
}

async function executeContractValidator(changeDir: string) {
  const contractContent = await sflowReadFile(`${changeDir}/execution-contract.md`);
  if (!contractContent) {
    return {
      validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
      isStale: false,
      recommendations: ['execution-contract.md not found — run contract-builder to create the contract'],
    };
  }

  const report = sharedValidator.validateExecutionContract(contractContent);
  const isStale = await isContractStale(changeDir);

  const recommendations: string[] = [];
  if (isStale) recommendations.push('Contract is stale — regenerate with contract-builder');
  if (!report.valid) recommendations.push('Fix validation errors before proceeding');
  report.issues.filter(i => i.level === 'ERROR').forEach(i => recommendations.push(`Fix: ${i.message}`));

  return { validation: report, isStale, recommendations };
}

async function executeArtifactInspector(changeDir: string) {
  const results: Record<string, unknown> = {};

  // Proposal
  const proposalContent = await sflowReadFile(`${changeDir}/proposal.md`);
  if (proposalContent) {
    results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
  } else {
    results.proposal = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Specs
  const specsDir = `${changeDir}/specs`;
  const { readdir } = await import('fs/promises');
  try {
    const specEntries = await readdir(specsDir, { withFileTypes: true });
    const specFiles = specEntries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);
    results.specs = {};
    for (const specFile of specFiles) {
      const specContent = await sflowReadFile(`${specsDir}/${specFile}`);
      if (specContent) {
        (results.specs as Record<string, unknown>)[specFile] = sharedValidator.validateSpecContent(
          specFile.replace('.md', ''),
          specContent,
        );
      }
    }
  } catch {
    results.specs = {};
  }

  // Design
  const designContent = await sflowReadFile(`${changeDir}/design.md`);
  if (designContent) {
    results.design = sharedValidator.validateDesign(designContent);
  } else {
    results.design = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Tasks
  const tasksContent = await sflowReadFile(`${changeDir}/tasks.md`);
  if (tasksContent) {
    results.tasks = sharedValidator.validateTasks(tasksContent);
  } else {
    results.tasks = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Summary
  const issues: string[] = [];
  const proposal = results.proposal as { valid: boolean; summary?: { errors: number } } | undefined;
  if (proposal && !proposal.valid) issues.push(`Proposal: ${proposal.summary?.errors || 0} error(s)`);
  const specs = results.specs as Record<string, { valid: boolean }> | undefined;
  if (specs) {
    const specErrors = Object.values(specs).filter(s => !s.valid).length;
    if (specErrors > 0) issues.push(`Specs: ${specErrors} file(s) with errors`);
  }
  const tasks = results.tasks as { valid: boolean; summary?: { errors: number } } | undefined;
  if (tasks && !tasks.valid) issues.push(`Tasks: ${tasks.summary?.errors || 0} error(s)`);

  const summary = issues.length === 0 ? 'All artifacts are valid' : `Found issues: ${issues.join(', ')}`;

  const recommendations: string[] = [];
  if (proposal && !proposal.valid) recommendations.push('Fix proposal issues before proceeding');
  if (specs && Object.values(specs).some(s => !s.valid)) recommendations.push('Fix spec issues before proceeding');
  if (tasks && !tasks.valid) recommendations.push('Fix task issues before proceeding');

  return { results, summary, recommendations };
}

// ─── Plugin server function ───────────────────────────────────────────────────

async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  const workDir = input.directory;
  const sflowClient = input.client;


  const hookComposer = createHookComposer();
  const skillLoader = await createSkillLoader();
  const mcpManager = createMcpManager();

  // Build tool definitions using @opencode-ai/plugin format
  const tools = createSFlowTools(sflowClient);
  const validatorTools = createValidatorTools();
  const workflowTools = createWorkflowTools();
  Object.assign(tools, validatorTools, workflowTools);

  return {
    dispose: async () => {
      for (const server of mcpManager.getRunningServers()) {
        try {
          await mcpManager.stopServer(server.name);
        } catch (err) {
          console.warn(`[sFlow] Failed to stop MCP server ${server.name}: `, err);
        }
      }
    },

    // event hook: session lifecycle events (S14 fix)
    event: async (input) => {
      const event = input.event;
      if (event.type === 'session.created') {
        const sessionStartHook = hookComposer.getHook('session_start');
        if (sessionStartHook) {
          await sessionStartHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'session.created',
          });
        }
      } else if (event.type === 'session.deleted') {
        const sessionEndHook = hookComposer.getHook('session_end');
        if (sessionEndHook) {
          await sessionEndHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'session.deleted',
          });
        }
      }
    },

    // ── config hook: register agents, MCP servers, detect plugins ──
    config: async (cfg) => {
      // Detect oh-my-openagent from cfg.plugin list
      const hasOmo = detectOmoPlugin(cfg.plugin);
      setHasOmoPlugin(hasOmo);

      // Detect agnesmore provider for image/video generation tools
      const hasAgnes = await detectAgnesProvider({ provider: cfg.provider as Record<string, unknown> | undefined, plugin: cfg.plugin });
      setHasAgnesProvider(hasAgnes);

      if (!cfg.agent) cfg.agent = {};

      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const skill = skillLoader.getSkill(name);
        const agentCfg = await createAgent(name, undefined, undefined, skill?.content);

        // Type-safe extraction of AgentConfig fields
        const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
        const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
        const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
        const tools = agentCfg.tools ?? undefined;

        cfg.agent[name] = {
          model: modelName,
          prompt: instructions,
          mode: getAgentMode(name),
          tools,
          color: AGENT_COLORS[name],
          temperature: override?.temperature ?? temperature,
          description: (typeof agentCfg.id === 'string')
            ? `${agentCfg.id} agent from sFlow plugin`
            : undefined,
        };

        // Populate model map for call_flow_agent to use when creating subagent sessions
        if (modelName) {
          AGENT_MODEL_MAP[name] = modelName;
        }
      }

      // --- Register skill-embedded MCPs (Tier 3) ---
      if (!cfg.mcp) cfg.mcp = {};
      const skillsWithMcp = skillLoader.getSkillsWithMcp();
      for (const skill of skillsWithMcp) {
        if (skill.metadata.mcp?.servers) {
          for (const server of skill.metadata.mcp.servers) {
            cfg.mcp[server.name] = {
              type: 'local',
              command: [server.command, ...(server.args || [])],
              environment: server.env,
            };
            // Start the MCP server process (S15 fix)
            mcpManager.startServer(server.name, server).catch(err => {
              console.warn(`[sFlow] Failed to start MCP server ${server.name}: ${err.message}`);
              // Rollback: remove from cfg.mcp so OpenCode doesn't try to connect to a dead server
              if (cfg.mcp) delete cfg.mcp[server.name];
            });
          }
        }
      }

      // --- Register project-level MCPs (Tier 2) (S15 fix) ---
      
      const projectMcpConfig = (await loadProjectMcpConfig()) as Record<string, { command: string | string[]; environment?: Record<string, string> }>;
      for (const [name, server] of Object.entries(projectMcpConfig)) {
        const srv = server as { command: string | string[]; environment?: Record<string, string> };
        if (srv && srv.command) {
          cfg.mcp[name] = {
            type: 'local',
            command: Array.isArray(srv.command) ? srv.command : [srv.command],
            environment: srv.environment,
          };
          const cmd = Array.isArray(srv.command) ? srv.command[0] : srv.command;
          const cmdArgs = Array.isArray(srv.command) ? srv.command.slice(1) : [];
          if (cmd) {
            mcpManager.startServer(name, { name, command: cmd, args: cmdArgs, env: srv.environment }).catch(err => {
              console.warn(`[sFlow] Failed to start project MCP server ${name}: ${err.message}`);
              // Rollback: remove from cfg.mcp so OpenCode doesn't try to connect to a dead server
              if (cfg.mcp) delete cfg.mcp[name];
            });
          }
        }
      }
    },

    // ── tool hook: register sflow tools via Hooks.tool ──
    // This follows oh-my-openagent's pattern: tools are registered
    // as Record<string, ToolDefinition> on the Hooks return value.
    tool: tools,

    // ── command.execute.before hook ──
    "command.execute.before": async (input, output) => {
      const command = input.command;
      if (!command.startsWith('/')) return;

      const skillName = command.slice(1);
      const skill = skillLoader.getSkill(skillName);
      if (!skill) return;

      const skillContent = skill.content;
      if (!skillContent) return;

      output.parts.push({
        id: `sflow-skill-${Date.now()}`,
        sessionID: input.sessionID,
        messageID: '',
        type: 'text',
        text: skillContent,
      });
    },

    // ── tool.execute.before hook ──
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;
      const lowerTool = toolName?.toLowerCase();

      if (lowerTool === 'call_omo_agent') {
        markOmoUsed();
      }

      // Gather file path for write/edit tools to pass to guard hook
      const filePath = (lowerTool === 'write' || lowerTool === 'edit')
        ? (((output.args ?? {}) as Record<string, unknown>).filePath
          ?? ((output.args ?? {}) as Record<string, unknown>).path
          ?? ((output.args ?? {}) as Record<string, unknown>).file_path
          ?? '') as string
        : '';

      // Single guard hook call — all guard logic lives in guard.ts
      const guardHook = hookComposer.getHook('guard');
      if (guardHook) {
        const guardResult = await guardHook.execute({
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}`,
          data: {
            toolName: lowerTool,
            agent: (input as Record<string, unknown>).agent,
            filePath,
          },
        });

        if (guardResult.block) {
          output.args = {
            ...(output.args ?? {}),
            _sflow_guard_blocked: true,
            _sflow_guard_reason: guardResult.blockReason ?? guardResult.error ?? 'Guard condition not met',
          };
          return;
        }
      }

    },

    // ── tool.execute.after hook ──
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      // Artifact validation
      const validationHook = hookComposer.getHook('artifact_validation');
      if (validationHook) {
        const currentState = await getCurrentWorkflowState(workDir);
        const validationCtx: HookContext = {
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { newState: currentState },
        };
        const validationRes = await validationHook.execute(validationCtx);
        if (!validationRes.success && validationRes.block) {
          output.output = `[sFlow validation] ${validationRes.blockReason ?? validationRes.error ?? 'Artifact validation failed'}\n${output.output}`;
        }
      }

      // State transition — detect from tool output
      const outputStr = output.output ?? '';
      const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
      if (stateMatch) {
        const newState = stateMatch[1];

        const isIFlowTool = toolName === 'iflow_router';
        const isIFlowState = newState && IFLOW_STATES.has(newState);
        if (isIFlowTool || (isIFlowState && !SFLOW_TOOLS.has(toolName))) {
          try {
            await ensureDir(`${workDir}/.iflow`);
            await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
              state: newState,
              updatedAt: new Date().toISOString(),
            });
          } catch (err) {
            console.warn('[sFlow] Failed to write IFlow state:', err);
          }
          return;
        }

        const transitionHook = hookComposer.getHook('state_transition');
        if (transitionHook) {
          await transitionHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'state-transition',
            data: { newState },
          });
        }
        // Reset omo tracking when leaving exploring state
        if (newState !== 'exploring') {
          resetOmoTracking();
        }
      }

      // Post-process: detect state transitions from agent responses
      const postProcessHook = hookComposer.getHook('post_process');
      if (postProcessHook) {
        const ppResult = await postProcessHook.execute({
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { output: outputStr },
        });
        if (ppResult.success) {
          const ppData = ppResult.data as { stateTransitionSignal?: { from?: string; to: string } } | null;
          if (ppData?.stateTransitionSignal) {
            const transitionHook = hookComposer.getHook('state_transition');
            if (transitionHook) {
              await transitionHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                pluginRoot: '',
                action: 'state-transition',
                data: { newState: ppData.stateTransitionSignal.to },
              });
            }
            // Reset omo tracking when leaving exploring state
            if (ppData.stateTransitionSignal.to !== 'exploring') {
              resetOmoTracking();
            }
          }
        }
      }
    },

    // ── experimental.compaction.autocontinue hook ──
    "experimental.compaction.autocontinue": async (input, output) => {
      const continuationHook = hookComposer.getHook('continuation');
      if (!continuationHook) return;

      const result = await continuationHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/${getStateFilePath('sflow')}`,
        pluginRoot: '',
        action: 'autocontinue',
      });

      const shouldContinue = result.success && (result.data as { shouldContinue?: boolean })?.shouldContinue === true;
      output.enabled = shouldContinue;
    },

    };
}

// ─── Plugin module export ─────────────────────────────────────────────────────

const sflowPluginModule: PluginModule = {
  id: PLUGIN_ID,
  server: sflowPlugin,
};

export default sflowPluginModule;






