/**
 * State Transition hook - Manage workflow state transitions
 */
import { isValidTransition, getValidTransitions } from '@opencode-sflow/core';
import { ensureDir, readJsonFile, writeJsonFile } from '@opencode-sflow/shared';
const STATE_FILE_PATH = '.sflow/state.json';
/**
 * Create the state transition hook
 */
export function createStateTransitionHook() {
    return {
        name: 'state_transition',
        description: 'Manage workflow state transitions and validate transitions',
        execute: async (context) => {
            const { changeDir, data } = context;
            try {
                const currentState = await getCurrentState(changeDir);
                const newState = data?.newState;
                if (!newState) {
                    return { success: true, data: { currentState } };
                }
                if (!currentState) {
                    await updateState(changeDir, newState);
                    return {
                        success: true,
                        data: { from: null, to: newState, timestamp: new Date().toISOString() },
                    };
                }
                if (!isValidTransition(currentState, newState)) {
                    const valid = getValidTransitions(currentState);
                    return {
                        success: false,
                        error: `Invalid transition from ${currentState} to ${newState}`,
                        block: true,
                        blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${valid.join(', ')}`,
                    };
                }
                await updateState(changeDir, newState);
                return {
                    success: true,
                    data: {
                        from: currentState,
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
    };
}
async function getCurrentState(changeDir) {
    const state = await readStateFile(changeDir);
    if (state) {
        return state.state || state.currentState || 'exploring';
    }
    return null;
}
async function readStateFile(changeDir) {
    if (!changeDir)
        return null;
    return await readJsonFile(`${changeDir}/${STATE_FILE_PATH}`);
}
async function updateState(changeDir, newState) {
    const now = new Date().toISOString();
    let state = {};
    const existing = await readStateFile(changeDir);
    if (existing) {
        state = existing;
    }
    else {
        state = { mode: 'full', createdAt: now, timestamps: { createdAt: now, updatedAt: now } };
        await ensureDir(`${changeDir}/.sflow`);
    }
    state.state = newState;
    state.updatedAt = now;
    if (!state.timestamps)
        state.timestamps = {};
    state.timestamps.lastTransition = now;
    state.timestamps.updatedAt = now;
    await writeJsonFile(`${changeDir}/${STATE_FILE_PATH}`, state);
}
//# sourceMappingURL=state-transition.js.map