/**
 * State Transition hook - Manage workflow state transitions
 */
/**
 * Valid state transitions
 */
const VALID_TRANSITIONS = {
    exploring: ['specifying', 'abandoned'],
    specifying: ['bridging', 'exploring', 'abandoned'],
    bridging: ['approved-for-build', 'specifying', 'abandoned'],
    'approved-for-build': ['executing', 'bridging', 'abandoned'],
    executing: ['debugging', 'closing', 'abandoned'],
    debugging: ['executing', 'abandoned'],
    closing: ['abandoned'],
    abandoned: [], // Terminal state
};
/**
 * Create the state transition hook
 */
export function createStateTransitionHook() {
    return {
        name: 'state_transition',
        description: 'Manage workflow state transitions and validate transitions',
        execute: async (context) => {
            const { changeDir, action, data } = context;
            try {
                // Get current state
                const currentState = await getCurrentState(changeDir);
                const newState = data?.newState;
                if (!newState) {
                    return { success: true, data: { currentState: await getCurrentState(changeDir) } };
                }
                if (!currentState) {
                    await updateState(changeDir, newState);
                    return {
                        success: true,
                        data: { from: null, to: newState, timestamp: new Date().toISOString() },
                    };
                }
                const validTransitions = VALID_TRANSITIONS[currentState] || [];
                if (!validTransitions.includes(newState)) {
                    return {
                        success: false,
                        error: `Invalid transition from ${currentState} to ${newState}`,
                        block: true,
                        blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${validTransitions.join(', ')}`,
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
// Helper functions
async function getCurrentState(changeDir) {
    if (!changeDir)
        return null;
    const stateFilePath = `${changeDir}/.sflow/state.json`;
    try {
        const file = Bun.file(stateFilePath);
        if (await file.exists()) {
            const content = await file.text();
            const state = JSON.parse(content);
            return state.state || state.currentState || 'exploring';
        }
    }
    catch { }
    return null;
}
async function updateState(changeDir, newState) {
    const stateFilePath = `${changeDir}/.sflow/state.json`;
    const now = new Date().toISOString();
    const file = Bun.file(stateFilePath);
    let state = {};
    if (await file.exists()) {
        const content = await file.text();
        state = JSON.parse(content);
    }
    else {
        state = { mode: 'full', createdAt: now };
    }
    state.state = newState;
    state.updatedAt = now;
    await Bun.write(stateFilePath, JSON.stringify(state, null, 2));
}
//# sourceMappingURL=state-transition.js.map