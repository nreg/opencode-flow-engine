import { createWorkflowManager } from './workflow-manager.js';
export function createStateManager(config = { enabled: true }, workflowManager) {
    const wf = workflowManager || createWorkflowManager(config);
    return {
        name: 'state_manager',
        config,
        getWorkflowManager: () => wf,
        async initialize() {
            if (!config.enabled) {
                return { success: true, data: { message: 'State manager disabled' } };
            }
            console.log('State manager initialized');
            return { success: true };
        },
        async getState(changeDir) {
            try {
                return await wf.getState(changeDir);
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async updateState(changeDir, updates) {
            try {
                return await wf.transitionState(changeDir, updates.state || 'exploring');
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async isContractApproved(changeDir) {
            try {
                const state = await wf.getState(changeDir);
                if (!state.success)
                    return state;
                return {
                    success: true,
                    data: { approved: state.data?.contractApproved || false },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async approveContract(changeDir) {
            try {
                const current = await wf.getState(changeDir);
                if (!current.success)
                    return current;
                const result = await wf.transitionState(changeDir, 'approved-for-build');
                return {
                    success: result.success,
                    data: { approved: true, timestamp: new Date().toISOString() },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        },
        async isContractStale(changeDir) {
            try {
                return { success: true, data: { stale: false } };
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
//# sourceMappingURL=state-manager.js.map