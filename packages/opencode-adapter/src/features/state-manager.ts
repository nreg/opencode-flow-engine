import type { FeatureConfig, FeatureResult } from "./types.js";
import { createWorkflowManager } from "./workflow-manager.js";
import { fileExists, readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, readFile, directoryExists, isContractStale as checkContractStale } from "@opencode-sflow/shared";

const BOULDER_STATE_FILE = ".sflow/boulder-state.json";

type WorkflowManager = ReturnType<typeof createWorkflowManager>;

export function createStateManager(
  config: FeatureConfig = { enabled: true },
  workflowManager?: WorkflowManager,
) {
  const wf = workflowManager || createWorkflowManager(config);

  return {
    name: "state_manager",
    config,

    getWorkflowManager: () => wf,

    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: "State manager disabled" } };
      }
      console.log("State manager initialized");
      return { success: true };
    },

    async restoreState(changeDir: string): Promise<FeatureResult> {
      try {
        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        const exists = await fileExists(boulderPath);
        if (!exists) {
          return { success: true, data: { restored: false, reason: "No boulder state found" } };
        }

        const boulderState = await readJsonFile<Record<string, unknown>>(boulderPath);
        if (!boulderState) {
          return { success: true, data: { restored: false, reason: "Empty boulder state" } };
        }

        const currentState = (boulderState.state as string) || "exploring";
        const repairedState = await this.detectStateMismatch(changeDir, currentState);

        if (repairedState !== currentState) {
          console.log(`[SFLOW] Detected state mismatch: state=${currentState} but artifacts indicate ${repairedState}. Auto-repairing.`);
          boulderState.state = repairedState;
          boulderState.repairedFrom = currentState;
          boulderState.repairedAt = new Date().toISOString();
        }

        const statePath = `${changeDir}/.sflow/state.json`;
        await writeJsonFile(statePath, {
          ...boulderState,
          restoredAt: new Date().toISOString(),
          restoredFrom: BOULDER_STATE_FILE,
        });

        return {
          success: true,
          data: {
            restored: true,
            state: repairedState,
            repaired: repairedState !== currentState,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

async detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
      const hasProposal = await fileExists(`${changeDir}/proposal.md`);
      const hasDesign = await fileExists(`${changeDir}/design.md`);
      const hasTasks = await fileExists(`${changeDir}/tasks.md`);
      const hasSpecs = await directoryExists(`${changeDir}/specs`);
      const hasContract = await fileExists(`${changeDir}/execution-contract.md`);

      const proposalContent = hasProposal ? await readFile(`${changeDir}/proposal.md`) : null;
      const tasksContent = hasTasks ? await readFile(`${changeDir}/tasks.md`) : null;

      const incompleteTasks = tasksContent
        ? tasksContent.split("\n").filter((line) => line.match(/^-\s*\[\s\]/)).length
        : 0;
      const allTasksChecked = tasksContent
        ? tasksContent.split("\n").filter((line) => line.match(/^-\s*\[.\]\s+/)).length > 0 &&
          incompleteTasks === 0
        : false;

      // Forward mismatch: contract changed after approval → route back to bridging
      if (hasContract && (currentState === "approved-for-build" || currentState === "executing")) {
        const stateData = await readJsonFile<Record<string, unknown>>(`${changeDir}/.sflow/state.json`);
        const storedHash = (stateData?.contract_hash as string) || "";
        if (storedHash) {
          const contractContent = await readFile(`${changeDir}/execution-contract.md`);
          const currentHash = simpleHash(contractContent || "");
          if (currentHash !== storedHash) {
            return "bridging";
          }
        }
      }

      if (currentState === "exploring" && hasProposal && proposalContent && proposalContent.trim().length > 100) {
        return "specifying";
      }

      if (currentState === "specifying" && !hasProposal) {
        return "exploring";
      }
      if (currentState === "specifying" && hasDesign && hasTasks && hasSpecs) {
        return "bridging";
      }

      if (currentState === "bridging" && (!hasDesign || !hasTasks || !hasSpecs)) {
        return "specifying";
      }
      if (currentState === "bridging" && hasContract) {
        return "approved-for-build";
      }

      if (currentState === "approved-for-build" && !hasContract) {
        return "bridging";
      }
      if (currentState === "approved-for-build" && allTasksChecked) {
        return "closing";
      }

      if (currentState === "executing" && !hasContract) {
        return "bridging";
      }
      if (currentState === "executing" && allTasksChecked) {
        return "closing";
      }

      if (currentState === "debugging" && !hasContract) {
        return "bridging";
      }

      return currentState;
    },

    async persistState(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);
        if (!stateExists) {
          return { success: true, data: { persisted: false, reason: "No workflow state to persist" } };
        }

        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: true, data: { persisted: false, reason: "Empty workflow state" } };
        }

        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        await writeJsonFile(boulderPath, {
          ...state,
          persistedAt: new Date().toISOString(),
          version: 1,
          artifacts_hash: state.artifacts_hash || "",
          contract_hash: state.contract_hash || "",
          batches_completed: state.batches_completed || 0,
        });

        return {
          success: true,
          data: {
            persisted: true,
            state: state.state,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getState(changeDir: string): Promise<FeatureResult> {
      try {
        return await wf.getState(changeDir);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult> {
      try {
        return await wf.transitionState(changeDir, (updates.state as string) || "exploring");
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isContractApproved(changeDir: string): Promise<FeatureResult> {
      try {
        const state = await wf.getState(changeDir);
        if (!state.success) return state;
        return {
          success: true,
          data: { approved: (state.data as Record<string, unknown>)?.contractApproved || false },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async approveContract(changeDir: string): Promise<FeatureResult> {
      try {
        const current = await wf.getState(changeDir);
        if (!current.success) return current;
        const result = await wf.transitionState(changeDir, "approved-for-build");
        if (result.success) {
          await this.persistState(changeDir);
        }
        return {
          success: result.success,
          data: { approved: true, timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async upgradeMode(changeDir: string, newMode: string, reason: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }

        const previousMode = state.mode;
        state.mode = newMode;
        state.updatedAt = new Date().toISOString();
        state.upgradedFrom = previousMode;
        state.upgradeReason = reason;
        state.upgradedAt = new Date().toISOString();

        await atomicWriteJsonFile(statePath, state);

        await this.persistState(changeDir);

        return {
          success: true,
          data: {
            upgraded: true,
            from: previousMode,
            to: newMode,
            reason,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async setBuildPause(changeDir: string, pauseType: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = pauseType;
        state.buildPauseSetAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: pauseType, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async clearBuildPause(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = null;
        state.buildPauseClearedAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: null, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        const stateExists = await fileExists(`${changeDir}/.sflow/state.json`);
        const contractPath = `${changeDir}/execution-contract.md`;
        const contractExists = await fileExists(contractPath);

        if (!stateExists || !contractExists) {
          return { success: true, data: { stale: false } };
        }

        const stale = await checkContractStale(changeDir);
        return { success: true, data: { stale } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
},
  };
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
