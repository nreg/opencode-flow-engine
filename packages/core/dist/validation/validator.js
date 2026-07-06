/**
 * Validator for spec-superflow core engine
 * Aligned with spec-superflow/src/validation/validator.ts
 * Full port: block-level validation, implementation verification,
 * sync conflict detection, and language-aware tokenization.
 */
import { VALIDATION_MESSAGES, MIN_PURPOSE_LENGTH, MIN_WHY_SECTION_LENGTH, MAX_WHY_SECTION_LENGTH, MAX_REQUIREMENT_TEXT_LENGTH, MAX_DELTAS_PER_CHANGE, VERIFICATION_MESSAGES, } from './constants.js';
import { tokenize } from './tokenizer.js';
import { parseDeltaSpec, normalizeRequirementName, extractRequirementsSection, } from '../parsing/requirement-blocks.js';
const REQUIREMENT_HEADER_REGEX = /^###\s*Requirement:\s*(.+)\s*$/i;
const SCENARIO_HEADER_REGEX = /^####\s+Scenario:/gim;
function normalizeLineEndings(content) {
    return content.replace(/\r\n?/g, '\n');
}
function extractSection(content, heading) {
    const normalized = normalizeLineEndings(content);
    const lines = normalized.split('\n');
    const headingRegex = new RegExp(`^##\\s+${heading.replace(/\s+/g, '\\s+')}\\s*$`, 'i');
    const idx = lines.findIndex((l) => headingRegex.test(l));
    if (idx === -1)
        return undefined;
    let endIdx = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
        if (i < lines.length && /^##\s+/.test(lines[i])) {
            endIdx = i;
            break;
        }
    }
    return lines.slice(idx + 1, endIdx).join('\n').trim();
}
function containsShallOrMust(text) {
    return /\b(SHALL|MUST)\b/.test(text);
}
function countScenarios(blockRaw) {
    const matches = blockRaw.match(SCENARIO_HEADER_REGEX);
    return matches ? matches.length : 0;
}
function extractRequirementText(blockRaw) {
    const lines = blockRaw.split('\n');
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^####\s+/.test(line))
            break;
        const trimmed = line.trim();
        if (trimmed.length === 0)
            continue;
        if (/^\*\*[^*]+\*\*:/.test(trimmed))
            continue;
        return trimmed;
    }
    return undefined;
}
function buildMissingShallOrMustMessage(action, blockName) {
    const base = `${action} "${blockName}" must contain SHALL or MUST`;
    if (containsShallOrMust(blockName)) {
        return `${base} in the requirement body, not only in the header. Move the SHALL/MUST statement to the line immediately after the "### Requirement: ..." header.`;
    }
    return base;
}
function enrichTopLevelError(itemId, baseMessage) {
    const msg = baseMessage.trim();
    if (msg === VALIDATION_MESSAGES.CHANGE_NO_DELTAS) {
        return `${msg}. ${VALIDATION_MESSAGES.GUIDE_NO_DELTAS}`;
    }
    if (msg.includes('Spec must have a Purpose section') ||
        msg.includes('Spec must have a Requirements section')) {
        return `${msg}. ${VALIDATION_MESSAGES.GUIDE_MISSING_SPEC_SECTIONS}`;
    }
    if (msg.includes('Change must have a Why section') ||
        msg.includes('Change must have a What Changes section')) {
        return `${msg}. ${VALIDATION_MESSAGES.GUIDE_MISSING_CHANGE_SECTIONS}`;
    }
    return msg;
}
function createReport(issues, strictMode = false) {
    const errors = issues.filter((i) => i.level === 'ERROR').length;
    const warnings = issues.filter((i) => i.level === 'WARNING').length;
    const info = issues.filter((i) => i.level === 'INFO').length;
    const valid = strictMode ? errors === 0 && warnings === 0 : errors === 0;
    return {
        valid,
        issues,
        summary: { errors, warnings, info },
    };
}
/**
 * Main validator class
 * Aligned with spec-superflow: full block-level validation,
 * implementation verification, and sync conflict detection.
 */
export class Validator {
    strictMode;
    constructor(strictMode = false) {
        this.strictMode = strictMode;
    }
    /**
     * Validate spec content (block-level validation)
     * Replaces the old regex-based validateSpec with proper block parsing
     */
    validateSpecContent(specName, content) {
        const issues = [];
        if (!specName || specName.trim().length === 0) {
            issues.push({ level: 'ERROR', path: 'name', message: VALIDATION_MESSAGES.SPEC_NAME_EMPTY });
        }
        const purposeSection = extractSection(content, 'Purpose');
        if (!purposeSection || purposeSection.trim().length === 0) {
            issues.push({
                level: 'ERROR',
                path: 'overview',
                message: VALIDATION_MESSAGES.SPEC_PURPOSE_EMPTY,
            });
        }
        else if (purposeSection.length < MIN_PURPOSE_LENGTH) {
            issues.push({
                level: 'WARNING',
                path: 'overview',
                message: VALIDATION_MESSAGES.PURPOSE_TOO_BRIEF,
            });
        }
        const reqSectionParts = extractRequirementsSection(content);
        if (reqSectionParts.bodyBlocks.length === 0) {
            issues.push({
                level: 'ERROR',
                path: 'requirements',
                message: VALIDATION_MESSAGES.SPEC_NO_REQUIREMENTS,
            });
        }
        for (const block of reqSectionParts.bodyBlocks) {
            const reqText = extractRequirementText(block.raw);
            if (!reqText || reqText.trim().length === 0) {
                issues.push({
                    level: 'ERROR',
                    path: `requirements.${block.name}`,
                    message: VALIDATION_MESSAGES.REQUIREMENT_EMPTY,
                });
            }
            else {
                if (!containsShallOrMust(reqText)) {
                    issues.push({
                        level: 'ERROR',
                        path: `requirements.${block.name}`,
                        message: buildMissingShallOrMustMessage('ADDED', block.name),
                    });
                }
                if (reqText.length > MAX_REQUIREMENT_TEXT_LENGTH) {
                    issues.push({
                        level: 'INFO',
                        path: `requirements.${block.name}`,
                        message: VALIDATION_MESSAGES.REQUIREMENT_TOO_LONG,
                    });
                }
            }
            const scenarioCount = countScenarios(block.raw);
            if (scenarioCount < 1) {
                issues.push({
                    level: 'WARNING',
                    path: `requirements.${block.name}.scenarios`,
                    message: `${VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS}. ${VALIDATION_MESSAGES.GUIDE_SCENARIO_FORMAT}`,
                });
            }
        }
        return createReport(issues, this.strictMode);
    }
    /**
     * Validate a proposal markdown content (also used for change validation)
     * Aligned with spec-superflow: validateChangeContent
     */
    validateChangeContent(changeName, content) {
        const issues = [];
        if (!changeName || changeName.trim().length === 0) {
            issues.push({ level: 'ERROR', path: 'name', message: VALIDATION_MESSAGES.CHANGE_NAME_EMPTY });
        }
        const whySection = extractSection(content, 'Why');
        if (!whySection || whySection.trim().length === 0) {
            issues.push({
                level: 'ERROR',
                path: 'why',
                message: VALIDATION_MESSAGES.CHANGE_WHY_TOO_SHORT,
            });
        }
        else {
            if (whySection.length < MIN_WHY_SECTION_LENGTH) {
                issues.push({
                    level: 'ERROR',
                    path: 'why',
                    message: VALIDATION_MESSAGES.CHANGE_WHY_TOO_SHORT,
                });
            }
            if (whySection.length > MAX_WHY_SECTION_LENGTH) {
                issues.push({
                    level: 'WARNING',
                    path: 'why',
                    message: VALIDATION_MESSAGES.CHANGE_WHY_TOO_LONG,
                });
            }
        }
        const whatChanges = extractSection(content, 'What Changes');
        if (!whatChanges || whatChanges.trim().length === 0) {
            issues.push({
                level: 'ERROR',
                path: 'whatChanges',
                message: VALIDATION_MESSAGES.CHANGE_WHAT_EMPTY,
            });
        }
        return createReport(issues, this.strictMode);
    }
    /**
     * Validate a proposal markdown content
     * Alias for validateChangeContent for backward compatibility
     */
    validateProposal(content) {
        return this.validateChangeContent('proposal', content);
    }
    /**
     * Validate a spec markdown content
     * Backward-compatible wrapper around validateSpecContent
     */
    validateSpec(content, specName) {
        return this.validateSpecContent(specName, content);
    }
    /**
     * Validate a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
     * Full cross-section conflict detection, duplicate detection, etc.
     * Aligned with spec-superflow: complete validation
     */
    validateDeltaSpec(content, changeName) {
        const issues = [];
        const plan = parseDeltaSpec(content);
        const totalDeltas = plan.added.length + plan.modified.length + plan.removed.length + plan.renamed.length;
        if (totalDeltas === 0) {
            issues.push({
                level: 'ERROR',
                path: 'file',
                message: enrichTopLevelError('change', VALIDATION_MESSAGES.CHANGE_NO_DELTAS),
            });
            return createReport(issues, this.strictMode);
        }
        if (totalDeltas > MAX_DELTAS_PER_CHANGE) {
            issues.push({
                level: 'WARNING',
                path: 'file',
                message: VALIDATION_MESSAGES.CHANGE_TOO_MANY_DELTAS,
            });
        }
        const addedNames = new Set();
        const modifiedNames = new Set();
        const removedNames = new Set();
        const renamedFrom = new Set();
        const renamedTo = new Set();
        // Validate ADDED blocks
        for (const block of plan.added) {
            const key = normalizeRequirementName(block.name);
            if (addedNames.has(key)) {
                issues.push({
                    level: 'ERROR',
                    path: 'added',
                    message: `Duplicate requirement in ADDED: "${block.name}"`,
                });
            }
            else {
                addedNames.add(key);
            }
            const reqText = extractRequirementText(block.raw);
            if (!reqText) {
                issues.push({
                    level: 'ERROR',
                    path: `added.${block.name}`,
                    message: `ADDED "${block.name}" is missing requirement text`,
                });
            }
            else if (!containsShallOrMust(reqText)) {
                issues.push({
                    level: 'ERROR',
                    path: `added.${block.name}`,
                    message: buildMissingShallOrMustMessage('ADDED', block.name),
                });
            }
            if (countScenarios(block.raw) < 1) {
                issues.push({
                    level: 'ERROR',
                    path: `added.${block.name}`,
                    message: `ADDED "${block.name}" must include at least one scenario`,
                });
            }
        }
        // Validate MODIFIED blocks
        for (const block of plan.modified) {
            const key = normalizeRequirementName(block.name);
            if (modifiedNames.has(key)) {
                issues.push({
                    level: 'ERROR',
                    path: 'modified',
                    message: `Duplicate requirement in MODIFIED: "${block.name}"`,
                });
            }
            else {
                modifiedNames.add(key);
            }
            const reqText = extractRequirementText(block.raw);
            if (!reqText) {
                issues.push({
                    level: 'ERROR',
                    path: `modified.${block.name}`,
                    message: `MODIFIED "${block.name}" is missing requirement text`,
                });
            }
            else if (!containsShallOrMust(reqText)) {
                issues.push({
                    level: 'ERROR',
                    path: `modified.${block.name}`,
                    message: buildMissingShallOrMustMessage('MODIFIED', block.name),
                });
            }
            if (countScenarios(block.raw) < 1) {
                issues.push({
                    level: 'ERROR',
                    path: `modified.${block.name}`,
                    message: `MODIFIED "${block.name}" must include at least one scenario`,
                });
            }
        }
        // Validate REMOVED names
        for (const name of plan.removed) {
            const key = normalizeRequirementName(name);
            if (removedNames.has(key)) {
                issues.push({
                    level: 'ERROR',
                    path: 'removed',
                    message: `Duplicate requirement in REMOVED: "${name}"`,
                });
            }
            else {
                removedNames.add(key);
            }
        }
        // Validate RENAMED pairs
        for (const { from, to } of plan.renamed) {
            const fromKey = normalizeRequirementName(from);
            const toKey = normalizeRequirementName(to);
            if (renamedFrom.has(fromKey)) {
                issues.push({
                    level: 'ERROR',
                    path: 'renamed',
                    message: `Duplicate FROM in RENAMED: "${from}"`,
                });
            }
            else {
                renamedFrom.add(fromKey);
            }
            if (renamedTo.has(toKey)) {
                issues.push({
                    level: 'ERROR',
                    path: 'renamed',
                    message: `Duplicate TO in RENAMED: "${to}"`,
                });
            }
            else {
                renamedTo.add(toKey);
            }
        }
        // Cross-section conflict detection
        for (const n of modifiedNames) {
            if (removedNames.has(n)) {
                issues.push({
                    level: 'ERROR',
                    path: 'cross-section',
                    message: `Requirement present in both MODIFIED and REMOVED: "${n}"`,
                });
            }
            if (addedNames.has(n)) {
                issues.push({
                    level: 'ERROR',
                    path: 'cross-section',
                    message: `Requirement present in both MODIFIED and ADDED: "${n}"`,
                });
            }
        }
        for (const n of addedNames) {
            if (removedNames.has(n)) {
                issues.push({
                    level: 'ERROR',
                    path: 'cross-section',
                    message: `Requirement present in both ADDED and REMOVED: "${n}"`,
                });
            }
        }
        for (const { from, to } of plan.renamed) {
            const fromKey = normalizeRequirementName(from);
            const toKey = normalizeRequirementName(to);
            if (modifiedNames.has(fromKey)) {
                issues.push({
                    level: 'ERROR',
                    path: 'cross-section',
                    message: `MODIFIED references old name from RENAMED. Use new header for "${to}"`,
                });
            }
            if (addedNames.has(toKey)) {
                issues.push({
                    level: 'ERROR',
                    path: 'cross-section',
                    message: `RENAMED TO collides with ADDED for "${to}"`,
                });
            }
        }
        return createReport(issues, this.strictMode);
    }
    /**
     * Validate implementation against spec and design
     * Three-dimension verification: Completeness, Correctness, Coherence
     * Aligned with spec-superflow: uses language-aware tokenizer
     */
    validateImplementation(diffSummary, specContent, designContent, config) {
        const language = config?.verification?.language ?? 'auto';
        // --- Completeness ---
        const completenessFindings = [];
        const requirements = this.extractRequirementNames(specContent);
        const diffTokens = tokenize(diffSummary, language);
        for (const req of requirements) {
            const reqTokens = tokenize(req, language);
            const allPresent = reqTokens.size === 0 || [...reqTokens].every(t => diffTokens.has(t));
            if (!allPresent) {
                completenessFindings.push({
                    level: 'CRITICAL',
                    dimension: 'Completeness',
                    message: VERIFICATION_MESSAGES.COMPLETENESS_MISSING_REQUIREMENT.replace('{requirement}', req),
                });
            }
        }
        const hasCriticalCompleteness = completenessFindings.some((f) => f.level === 'CRITICAL');
        // --- Correctness ---
        const correctnessFindings = [];
        const placeholderPatterns = ['TODO', 'FIXME', 'HACK', 'XXX', 'PLACEHOLDER'];
        for (const pattern of placeholderPatterns) {
            if (diffSummary.includes(pattern)) {
                correctnessFindings.push({
                    level: 'CRITICAL',
                    dimension: 'Correctness',
                    message: VERIFICATION_MESSAGES.VERIFICATION_PLACEHOLDER_DETECTED,
                });
                break;
            }
        }
        const hasCriticalCorrectness = correctnessFindings.some((f) => f.level === 'CRITICAL');
        // --- Coherence ---
        const coherenceFindings = [];
        const decisionNames = this.extractDecisionNames(designContent);
        for (const name of decisionNames) {
            const decisionTokens = tokenize(name, language);
            const allPresent = decisionTokens.size === 0 || [...decisionTokens].every(t => diffTokens.has(t));
            if (!allPresent) {
                coherenceFindings.push({
                    level: 'IMPORTANT',
                    dimension: 'Coherence',
                    message: VERIFICATION_MESSAGES.COHERENCE_PATTERN_MISSING.replace('{pattern}', name),
                });
            }
        }
        const dimensions = [
            {
                name: 'Completeness',
                status: hasCriticalCompleteness ? 'FAIL' : completenessFindings.length > 0 ? 'WARN' : 'PASS',
                findings: completenessFindings,
            },
            {
                name: 'Correctness',
                status: hasCriticalCorrectness ? 'FAIL' : correctnessFindings.length > 0 ? 'WARN' : 'PASS',
                findings: correctnessFindings,
            },
            {
                name: 'Coherence',
                status: coherenceFindings.length > 0 ? 'WARN' : 'PASS',
                findings: coherenceFindings,
            },
        ];
        const hasCritical = dimensions.some(d => d.status === 'FAIL');
        const hasWarning = dimensions.some(d => d.status === 'WARN');
        const verdict = hasCritical ? 'FAIL' : hasWarning ? 'CONDITIONAL' : 'PASS';
        return { dimensions, verdict };
    }
    /**
     * Detect sync conflicts across multiple delta specs
     * Aligned with spec-superflow: detects requirements modified by multiple changes
     */
    detectSyncConflicts(deltaSpecs) {
        const reqToChanges = new Map();
        for (const { changeName, content } of deltaSpecs) {
            const plan = parseDeltaSpec(content);
            const names = [
                ...plan.modified.map(b => normalizeRequirementName(b.name)),
                ...plan.renamed.map(r => normalizeRequirementName(r.to)),
            ];
            for (const name of names) {
                const existing = reqToChanges.get(name) || [];
                existing.push(changeName);
                reqToChanges.set(name, existing);
            }
        }
        const conflicts = [];
        for (const [requirement, changes] of reqToChanges) {
            if (changes.length >= 2) {
                conflicts.push({ requirement, spec: requirement, changes });
            }
        }
        return { hasConflicts: conflicts.length > 0, conflicts };
    }
    /**
     * Validate a tasks.md file
     */
    validateTasks(content) {
        const issues = [];
        const taskRegex = /- \[.\]\s+([^\n]+)/g;
        let match;
        const tasks = [];
        while ((match = taskRegex.exec(content)) !== null) {
            tasks.push(match[1]);
        }
        if (tasks.length === 0) {
            issues.push({
                level: 'WARNING',
                path: 'tasks.md',
                message: 'No tasks found',
                suggestion: 'Add tasks with completion definitions',
            });
        }
        tasks.forEach((task, index) => {
            if (!task.includes(':') && !task.includes('—') && !task.includes('-')) {
                issues.push({
                    level: 'WARNING',
                    path: `tasks.md:task[${index}]`,
                    message: VALIDATION_MESSAGES.tasks.missingCompletionDefinition,
                    suggestion: 'Add a completion definition (e.g., "Task: description — completion criteria")',
                });
            }
        });
        return createReport(issues, this.strictMode);
    }
    /**
     * Validate a design markdown file
     */
    validateDesign(content) {
        const issues = [];
        const DESIGN_REQUIRED_SECTIONS = [
            { key: 'Architecture Decision', pattern: /## Architecture\b|### Architecture\b/i },
            { key: 'Design Constraints', pattern: /## Constraints\b|## Design Constraints\b/i },
            { key: 'Implementation Approach', pattern: /## Approach\b|## Implementation\b/i },
        ];
        for (const section of DESIGN_REQUIRED_SECTIONS) {
            if (!section.pattern.test(content)) {
                issues.push({
                    level: 'ERROR',
                    path: 'design.md',
                    message: `Missing section: ${section.key}`,
                    suggestion: `Add a section describing ${section.key.toLowerCase()}`,
                });
            }
        }
        return createReport(issues, this.strictMode);
    }
    /**
     * Validate an execution contract
     */
    validateExecutionContract(content) {
        const issues = [];
        const requiredSections = ['Intent Lock', 'Approved Behavior', 'Design Constraints', 'Task Batches'];
        requiredSections.forEach(section => {
            if (!content.includes(section)) {
                issues.push({
                    level: 'ERROR',
                    path: 'execution-contract.md',
                    message: `Missing required section: ${section}`,
                    suggestion: `Add a ## ${section} section to the execution contract`,
                });
            }
        });
        // Check for Test Obligations section header (exact section match, not just keyword presence)
        const hasTestObligationsSection = /^##\s+Test\s+Obligations\s*$/m.test(content);
        if (!hasTestObligationsSection) {
            // Fallback: check for TDD keyword within a dedicated test section
            const hasTddSection = /^##\s+(Testing|Test\s+Plan|Test\s+Strategy)\s*$/im.test(content);
            const hasTddContent = /\bTDD\b/i.test(content);
            if (!hasTddContent || !(content.includes('Test Obligations') || content.includes('Test Plan') || hasTddSection)) {
                issues.push({
                    level: 'WARNING',
                    path: 'execution-contract.md',
                    message: 'No test obligations defined',
                    suggestion: 'Add a ## Test Obligations section to the execution contract',
                });
            }
        }
        return createReport(issues, this.strictMode);
    }
    /**
     * Check if a report is valid
     */
    isValid(report) {
        return report.valid;
    }
    // --- Private helpers ---
    extractRequirementNames(specContent) {
        const regex = /### Requirement:\s*(.+)/g;
        const names = [];
        let match;
        while ((match = regex.exec(specContent)) !== null) {
            names.push(match[1].trim());
        }
        return names;
    }
    extractDecisionNames(designContent) {
        const regex = /- Choice:\s*(.+)/g;
        const names = [];
        let match;
        while ((match = regex.exec(designContent)) !== null) {
            names.push(match[1].trim());
        }
        return names;
    }
}
/**
 * Module-level singleton Validator instance
 * Validator is stateless; reuse the same instance across all tools and hooks.
 */
export const sharedValidator = new Validator();
//# sourceMappingURL=validator.js.map