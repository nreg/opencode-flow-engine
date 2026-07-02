/**
 * Guard hook - Guard state transitions and block invalid operations
 */
import { fileExists, readFile, readJsonFile } from '@opencode-sflow/shared';
import { checkContractStaleness } from '../tools/workflow-router.js';
/**
 * Create the guard hook
 */
export function createGuardHook() {
    return {
        name: 'guard',
        description: 'Guard state transitions and block invalid operations',
        execute: async (context) => {
            const { changeDir } = context;
            try {
                const guards = [
                    await checkArtifactExistence(changeDir),
                    await checkContractStalenessGuard(changeDir),
                    await checkTaskCompletion(changeDir),
                    await checkDebuggingState(changeDir),
                ];
                const blockingGuards = guards.filter(g => g.block);
                if (blockingGuards.length > 0) {
                    return {
                        success: false,
                        error: 'Guard conditions not met',
                        block: true,
                        blockReason: blockingGuards.map(g => g.blockReason).join('; '),
                    };
                }
                return { success: true };
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
async function checkArtifactExistence(changeDir) {
    if (!changeDir)
        return { success: true };
    const dirExists = await fileExists(changeDir);
    if (!dirExists)
        return { success: true };
    const stateData = await readJsonFile(`${changeDir}/.sflow/state.json`);
    const currentState = stateData?.state || 'exploring';
    const artifactByState = {
        exploring: [],
        specifying: ['proposal.md'],
        bridging: ['proposal.md', 'specs', 'design.md', 'tasks.md'],
        'approved-for-build': ['proposal.md', 'specs', 'design.md', 'tasks.md', 'execution-contract.md'],
        executing: ['proposal.md', 'specs', 'design.md', 'tasks.md', 'execution-contract.md'],
        debugging: ['proposal.md', 'specs', 'design.md', 'tasks.md', 'execution-contract.md'],
        closing: ['proposal.md', 'specs', 'design.md', 'tasks.md', 'execution-contract.md'],
        abandoned: [],
    };
    const requiredArtifacts = artifactByState[currentState] || [];
    const missingArtifacts = [];
    for (const artifact of requiredArtifacts) {
        const exists = await fileExists(`${changeDir}/${artifact}`);
        if (!exists) {
            missingArtifacts.push(artifact);
        }
    }
    if (missingArtifacts.length > 0) {
        return {
            success: false,
            block: true,
            blockReason: `Missing required artifacts: ${missingArtifacts.join(', ')}`,
        };
    }
    return { success: true };
}
async function checkContractStalenessGuard(changeDir) {
    if (!changeDir)
        return { success: true };
    const isStale = await checkContractStaleness(changeDir);
    if (isStale) {
        return {
            success: false,
            block: true,
            blockReason: 'Contract is stale: proposal.md was modified after execution-contract.md was created',
        };
    }
    return { success: true };
}
async function checkTaskCompletion(changeDir) {
    if (!changeDir)
        return { success: true };
    const tasksContent = await readFile(`${changeDir}/tasks.md`);
    if (!tasksContent)
        return { success: true };
    const taskLines = tasksContent.split('\n').filter(line => line.match(/^-\s*\[.\]\s+/));
    if (taskLines.length === 0)
        return { success: true };
    const incompleteTasks = taskLines.filter(line => line.match(/^-\s*\[\s\]/));
    if (incompleteTasks.length > 0) {
        return {
            success: false,
            block: true,
            blockReason: `${incompleteTasks.length} task(s) are incomplete. Complete all tasks before closing.`,
        };
    }
    return { success: true };
}
async function checkDebuggingState(changeDir) {
    if (!changeDir)
        return { success: true };
    const stateData = await readJsonFile(`${changeDir}/.sflow/state.json`);
    if (stateData?.state === 'debugging') {
        return {
            success: false,
            block: true,
            blockReason: 'Workflow is in debugging state. Fix the bug and transition back to executing before continuing.',
        };
    }
    return { success: true };
}
//# sourceMappingURL=guard.js.map