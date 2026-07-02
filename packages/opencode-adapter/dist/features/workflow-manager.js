/**
 * Workflow Manager feature - Manage workflow execution
 */
import { isValidTransition } from '@opencode-sflow/core';
import { readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir } from '@opencode-sflow/shared';
const STATE_FILE = '.sflow/state.json';
/**
 * Create the workflow manager feature
 */
export function createWorkflowManager(config = { enabled: true }) {
    return {
        name: 'workflow_manager',
        config,
        async initialize() {
            if (!config.enabled) {
                return { success: true, data: { message: 'Workflow manager disabled' } };
            }
            console.log('Workflow manager initialized');
            return { success: true };
        },
        async startWorkflow(changeDir) {
            try {
                await createChangeDirectory(changeDir);
                await initializeStateFile(changeDir);
                return {
                    success: true,
                    data: {
                        changeDir,
                        state: 'exploring',
                        message: 'Workflow started',
                    },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async getState(changeDir) {
            try {
                const state = await readStateFile(changeDir);
                return {
                    success: true,
                    data: state,
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async transitionState(changeDir, newState) {
            try {
                const currentState = await readStateFile(changeDir);
                if (!isValidTransition(currentState.state, newState)) {
                    return {
                        success: false,
                        error: `Invalid transition from ${currentState.state} to ${newState}`,
                    };
                }
                await updateStateFile(changeDir, {
                    ...currentState,
                    state: newState,
                    updatedAt: new Date().toISOString(),
                });
                return {
                    success: true,
                    data: {
                        from: currentState.state,
                        to: newState,
                        timestamp: new Date().toISOString(),
                    },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async completeWorkflow(changeDir) {
            try {
                await archiveChange(changeDir);
                return {
                    success: true,
                    data: {
                        changeDir,
                        message: 'Workflow completed and archived',
                    },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
    };
}
async function createChangeDirectory(changeDir) {
    const stateDir = `${changeDir}/.sflow`;
    await ensureDir(stateDir);
    await writeJsonFile(`${changeDir}/${STATE_FILE}`, {
        state: 'exploring',
        mode: 'full',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
}
async function initializeStateFile(changeDir) {
    const stateFile = `${changeDir}/${STATE_FILE}`;
    const existing = await readJsonFile(stateFile);
    if (!existing) {
        await ensureDir(`${changeDir}/.sflow`);
        await writeJsonFile(stateFile, {
            state: 'exploring',
            mode: 'full',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
    }
}
async function readStateFile(changeDir) {
    const state = await readJsonFile(`${changeDir}/${STATE_FILE}`);
    return state || { state: 'exploring', mode: 'full', updatedAt: new Date().toISOString() };
}
async function updateStateFile(changeDir, state) {
    await atomicWriteJsonFile(`${changeDir}/${STATE_FILE}`, state);
}
async function archiveChange(changeDir) {
    const archiveDir = `${changeDir}/.sflow/archive`;
    await ensureDir(archiveDir);
    await Bun.write(`${archiveDir}/archived-at.txt`, new Date().toISOString());
}
//# sourceMappingURL=workflow-manager.js.map