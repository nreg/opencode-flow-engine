/**
 * Workflow Router tool - State detection and routing
 */
import { fileExists, directoryExists, readJsonFile } from '@opencode-sflow/shared';
/**
 * Create the workflow router tool
 */
export function createWorkflowRouterTool() {
    return {
        name: 'workflow_router',
        description: 'Detect current workflow state and route to appropriate skill',
        parameters: {
            changeDir: {
                type: 'string',
                description: 'Path to the change directory',
                required: true,
            },
        },
        execute: async (params, context) => {
            const changeDir = params.changeDir || context.changeDir;
            try {
                // Check for planning artifacts
                const artifacts = {
                    proposal: await fileExists(`${changeDir}/proposal.md`),
                    specs: await directoryExists(`${changeDir}/specs`),
                    design: await fileExists(`${changeDir}/design.md`),
                    tasks: await fileExists(`${changeDir}/tasks.md`),
                    contract: await fileExists(`${changeDir}/execution-contract.md`),
                    state: await fileExists(`${changeDir}/.sflow/state.json`),
                };
                // Determine workflow state
                let state;
                let skill;
                let reasons = [];
                if (!artifacts.proposal && !artifacts.specs) {
                    state = 'exploring';
                    skill = 'need-explorer';
                    reasons.push('No planning artifacts found');
                }
                else if (!artifacts.contract) {
                    state = 'specifying';
                    skill = 'spec-writer';
                    reasons.push('Planning artifacts exist but contract is missing');
                }
                else if (!await isContractApproved(changeDir)) {
                    state = 'bridging';
                    skill = 'contract-builder';
                    reasons.push('Contract exists but not approved');
                }
                else {
                    state = 'executing';
                    skill = 'build-executor';
                    reasons.push('Contract approved, ready for implementation');
                }
                // Check for stale artifacts using unified staleness check
                if (artifacts.contract) {
                    const isStale = await checkContractStaleness(changeDir);
                    if (isStale) {
                        state = 'bridging';
                        skill = 'contract-builder';
                        reasons.push('Contract is stale, needs regeneration');
                    }
                }
                return {
                    success: true,
                    data: {
                        state,
                        skill,
                        reasons,
                        artifacts,
                    },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    suggestions: ['Check if the change directory exists', 'Verify file permissions'],
                };
            }
        },
    };
}
async function isContractApproved(changeDir) {
    const state = await readJsonFile(`${changeDir}/.sflow/state.json`);
    if (state?.contractApproved === true)
        return true;
    if (state?.state === 'approved-for-build' || state?.state === 'executing' || state?.state === 'closing')
        return true;
    return false;
}
/**
 * Unified contract staleness check
 * Used by workflow-router, contract-validator, and guard hook
 */
export async function checkContractStaleness(changeDir) {
    const contractPath = `${changeDir}/execution-contract.md`;
    const proposalPath = `${changeDir}/proposal.md`;
    const contractExists = await fileExists(contractPath);
    const proposalExists = await fileExists(proposalPath);
    if (!contractExists || !proposalExists)
        return false;
    try {
        const { stat } = await import('fs/promises');
        const contractStats = await stat(contractPath);
        const proposalStats = await stat(proposalPath);
        return proposalStats.mtimeMs > contractStats.mtimeMs;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=workflow-router.js.map