/**
 * Artifact Validation hook - Validate artifacts on state transitions
 */
import { Validator } from '@opencode-sflow/core';
/**
 * Create the artifact validation hook
 */
export function createArtifactValidationHook() {
    return {
        name: 'artifact_validation',
        description: 'Validate artifacts when transitioning between states',
        execute: async (context) => {
            const { changeDir, action, data } = context;
            const validator = new Validator();
            try {
                const newState = data?.newState;
                // Validate based on target state
                switch (newState) {
                    case 'specifying':
                        return await validateForSpecifying(changeDir, validator);
                    case 'bridging':
                        return await validateForBridging(changeDir, validator);
                    case 'approved-for-build':
                        return await validateForExecution(changeDir, validator);
                    case 'closing':
                        return await validateForClosing(changeDir, validator);
                    default:
                        return { success: true };
                }
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
// Validation functions
async function validateForSpecifying(changeDir, validator) {
    // For specifying state, we need valid proposal
    const proposalContent = await readFile(`${changeDir}/proposal.md`);
    if (!proposalContent) {
        return {
            success: false,
            error: 'Proposal file not found',
            block: true,
            blockReason: 'Cannot enter specifying state without a proposal',
        };
    }
    const report = validator.validateProposal(proposalContent);
    if (!report.valid) {
        return {
            success: false,
            error: 'Proposal validation failed',
            block: true,
            blockReason: `Proposal has ${report.issues.filter(i => i.level === 'ERROR').length} errors`,
        };
    }
    return { success: true };
}
async function validateForBridging(changeDir, validator) {
    // For bridging state, we need valid specs
    const specsDir = `${changeDir}/specs`;
    const specFiles = await listFiles(specsDir);
    if (specFiles.length === 0) {
        return {
            success: false,
            error: 'No spec files found',
            block: true,
            blockReason: 'Cannot enter bridging state without specs',
        };
    }
    // Validate each spec
    for (const specFile of specFiles) {
        const specContent = await readFile(`${specsDir}/${specFile}`);
        if (specContent) {
            const report = validator.validateSpec(specContent, specFile.replace('.md', ''));
            if (!report.valid) {
                return {
                    success: false,
                    error: `Spec validation failed: ${specFile}`,
                    block: true,
                    blockReason: `Spec ${specFile} has ${report.issues.filter(i => i.level === 'ERROR').length} errors`,
                };
            }
        }
    }
    return { success: true };
}
async function validateForExecution(changeDir, validator) {
    // For execution state, we need valid execution contract
    const contractContent = await readFile(`${changeDir}/execution-contract.md`);
    if (!contractContent) {
        return {
            success: false,
            error: 'Execution contract not found',
            block: true,
            blockReason: 'Cannot enter execution state without an execution contract',
        };
    }
    const report = validator.validateExecutionContract(contractContent);
    if (!report.valid) {
        return {
            success: false,
            error: 'Execution contract validation failed',
            block: true,
            blockReason: `Execution contract has ${report.issues.filter(i => i.level === 'ERROR').length} errors`,
        };
    }
    return { success: true };
}
async function validateForClosing(changeDir, validator) {
    // For closing state, we need all tasks complete
    const tasksContent = await readFile(`${changeDir}/tasks.md`);
    if (!tasksContent) {
        return {
            success: false,
            error: 'Tasks file not found',
            block: true,
            blockReason: 'Cannot enter closing state without tasks',
        };
    }
    const report = validator.validateTasks(tasksContent);
    if (!report.valid) {
        return {
            success: false,
            error: 'Tasks validation failed',
            block: true,
            blockReason: `Tasks has ${report.issues.filter(i => i.level === 'ERROR').length} errors`,
        };
    }
    return { success: true };
}
// Helper functions
async function readFile(path) {
    try {
        const file = Bun.file(path);
        if (await file.exists()) {
            return await file.text();
        }
        return null;
    }
    catch {
        return null;
    }
}
async function listFiles(dirPath) {
    try {
        const dir = Bun.dir(dirPath);
        const files = [];
        for await (const file of dir) {
            if (file.isFile() && file.name.endsWith('.md')) {
                files.push(file.name);
            }
        }
        return files;
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=artifact-validation.js.map