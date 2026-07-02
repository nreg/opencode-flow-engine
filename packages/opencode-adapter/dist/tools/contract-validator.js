/**
 * Contract Validator tool - Validate execution contracts
 */
import { sharedValidator } from '@opencode-sflow/core';
import { readFile } from '@opencode-sflow/shared';
import { checkContractStaleness } from './workflow-router.js';
/**
 * Create the contract validator tool
 */
export function createContractValidatorTool() {
    return {
        name: 'contract_validator',
        description: 'Validate execution contracts against planning artifacts',
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
                const contractContent = await readFile(`${changeDir}/execution-contract.md`);
                if (!contractContent) {
                    return {
                        success: true,
                        data: {
                            validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
                            isStale: false,
                            recommendations: ['execution-contract.md not found - run contract-builder to create the contract'],
                        },
                    };
                }
                const report = sharedValidator.validateExecutionContract(contractContent);
                const isStale = await checkContractStaleness(changeDir);
                return {
                    success: true,
                    data: {
                        validation: report,
                        isStale,
                        recommendations: generateRecommendations(report, isStale),
                    },
                };
            }
            catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                    suggestions: ['Check file permissions', 'Verify file format'],
                };
            }
        },
    };
}
function generateRecommendations(report, isStale) {
    const recommendations = [];
    if (isStale) {
        recommendations.push('Contract is stale - regenerate with contract-builder');
    }
    if (!report.valid) {
        recommendations.push('Fix validation errors before proceeding');
    }
    report.issues
        .filter(issue => issue.level === 'ERROR')
        .forEach(issue => {
        recommendations.push(`Fix: ${issue.message}`);
    });
    return recommendations;
}
//# sourceMappingURL=contract-validator.js.map