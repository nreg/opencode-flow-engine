/**
 * Workflow Router tool - State detection and routing
 */
import { Validator } from '@opencode-sflow/core';
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
            const { changeDir } = params;
            const validator = new Validator();
            try {
                // Check for planning artifacts
                const artifacts = {
                    proposal: await fileExists(`${changeDir}/proposal.md`),
                    specs: await directoryExists(`${changeDir}/specs`),
                    design: await fileExists(`${changeDir}/design.md`),
                    tasks: await fileExists(`${changeDir}/tasks.md`),
                    contract: await fileExists(`${changeDir}/execution-contract.md`),
                    state: await fileExists(`${changeDir}/.spec-superflow.yaml`),
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
                // Check for stale artifacts
                if (artifacts.contract) {
                    const isStale = await isContractStale(changeDir);
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
// Helper functions
async function fileExists(path) {
    try {
        await Bun.file(path).exists();
        return true;
    }
    catch {
        return false;
    }
}
async function directoryExists(path) {
    try {
        const dir = Bun.file(path);
        return await dir.exists();
    }
    catch {
        return false;
    }
}
async function isContractApproved(changeDir) {
    // TODO: Read state file and check if contract is approved
    return false;
}
async function isContractStale(changeDir) {
    // TODO: Compare proposal scope vs contract intent lock
    return false;
}
//# sourceMappingURL=workflow-router.js.map