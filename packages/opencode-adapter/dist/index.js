// ../core/src/validation/constants.js
var MIN_WHY_SECTION_LENGTH = 50;
var MAX_WHY_SECTION_LENGTH = 5000;
var MAX_REQUIREMENT_TEXT_LENGTH = 1000;
var MAX_DELTAS_PER_CHANGE = 10;
var VALIDATION_MESSAGES = {
  proposal: {
    whyTooShort: `## Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
    whyTooLong: `## Why section must not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
    whatChangesEmpty: "## What Changes section cannot be empty",
    purposeEmpty: "Purpose statement cannot be empty"
  },
  spec: {
    requirementMissingShall: "Each requirement must contain SHALL or MUST statement",
    requirementMissingScenario: "Each requirement must have at least one scenario",
    requirementTextTooLong: `Requirement text must not exceed ${MAX_REQUIREMENT_TEXT_LENGTH} characters`
  },
  deltaSpec: {
    addedMissingText: "ADDED operation must have requirement text",
    addedMissingScenario: "ADDED operation must have at least one scenario",
    modifiedMissingText: "MODIFIED operation must have requirement text",
    modifiedMissingScenario: "MODIFIED operation must have at least one scenario",
    crossSectionConflict: "Cross-section conflict detected (e.g., MODIFIED and REMOVED in same spec)",
    tooManyDeltas: `Change must not have more than ${MAX_DELTAS_PER_CHANGE} deltas`
  },
  tasks: {
    missingCompletionDefinition: "Each task must have a completion definition"
  },
  general: {
    invalidState: "Invalid state transition",
    missingArtifact: "Required artifact is missing",
    staleContract: "Execution contract is stale and needs regeneration"
  }
};
// ../core/src/validation/validator.js
class Validator {
  strictMode;
  constructor(strictMode = false) {
    this.strictMode = strictMode;
  }
  validateProposal(content) {
    const issues = [];
    const whyMatch = content.match(/## Why\n([\s\S]*?)(?=\n## |$)/);
    if (whyMatch) {
      const whyContent = whyMatch[1].trim();
      if (whyContent.length < MIN_WHY_SECTION_LENGTH) {
        issues.push({
          level: "ERROR",
          path: "proposal.md:## Why",
          message: VALIDATION_MESSAGES.proposal.whyTooShort,
          suggestion: `Add at least ${MIN_WHY_SECTION_LENGTH - whyContent.length} more characters to explain the motivation`
        });
      }
      if (whyContent.length > MAX_WHY_SECTION_LENGTH) {
        issues.push({
          level: "WARNING",
          path: "proposal.md:## Why",
          message: VALIDATION_MESSAGES.proposal.whyTooLong,
          suggestion: "Consider condensing the motivation section"
        });
      }
    } else {
      issues.push({
        level: "ERROR",
        path: "proposal.md:## Why",
        message: "Missing ## Why section",
        suggestion: "Add a ## Why section to explain the motivation"
      });
    }
    const whatChangesMatch = content.match(/## What Changes\n([\s\S]*?)(?=\n## |$)/);
    if (whatChangesMatch) {
      const whatChangesContent = whatChangesMatch[1].trim();
      if (whatChangesContent.length === 0) {
        issues.push({
          level: "ERROR",
          path: "proposal.md:## What Changes",
          message: VALIDATION_MESSAGES.proposal.whatChangesEmpty,
          suggestion: "Add content to describe what changes will be made"
        });
      }
    } else {
      issues.push({
        level: "ERROR",
        path: "proposal.md:## What Changes",
        message: "Missing ## What Changes section",
        suggestion: "Add a ## What Changes section to describe the changes"
      });
    }
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Proposal validation passed" : `Found ${issues.length} issues`
    };
  }
  validateSpec(content, specName) {
    const issues = [];
    const requirementRegex = /(?:SHALL|MUST)\s+([^\n]+)/g;
    let match;
    const requirements = [];
    while ((match = requirementRegex.exec(content)) !== null) {
      requirements.push(match[1]);
    }
    if (requirements.length === 0) {
      issues.push({
        level: "ERROR",
        path: `specs/${specName}/spec.md`,
        message: "No requirements found (SHALL/MUST statements)",
        suggestion: "Add at least one requirement with SHALL or MUST statement"
      });
    }
    const scenarioRegex = /#### Scenario:\s*([^\n]+)/g;
    const scenarios = [];
    while ((match = scenarioRegex.exec(content)) !== null) {
      scenarios.push(match[1]);
    }
    if (requirements.length > 0 && scenarios.length === 0) {
      issues.push({
        level: "ERROR",
        path: `specs/${specName}/spec.md`,
        message: VALIDATION_MESSAGES.spec.requirementMissingScenario,
        suggestion: "Add at least one scenario for each requirement"
      });
    }
    requirements.forEach((req, index) => {
      if (req.length > MAX_REQUIREMENT_TEXT_LENGTH) {
        issues.push({
          level: "WARNING",
          path: `specs/${specName}/spec.md:requirement[${index}]`,
          message: VALIDATION_MESSAGES.spec.requirementTextTooLong,
          suggestion: "Consider shortening the requirement text"
        });
      }
    });
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Spec validation passed" : `Found ${issues.length} issues`
    };
  }
  validateDeltaSpec(content, changeName) {
    const issues = [];
    let deltaCount = 0;
    const addedRegex = /#{2,3} ADDED:\s*([^\n]+)\n([\s\S]*?)(?=\n#{2,3} (?:ADDED|MODIFIED|REMOVED|RENAMED):|\n## |$)/g;
    let match;
    while ((match = addedRegex.exec(content)) !== null) {
      deltaCount++;
      const requirementText = match[2].trim();
      if (requirementText.length === 0) {
        issues.push({
          level: "ERROR",
          path: `changes/${changeName}/specs:ADDED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.addedMissingText,
          suggestion: "Add requirement text for the ADDED operation"
        });
      }
      if (!requirementText.includes("#### Scenario:")) {
        issues.push({
          level: "ERROR",
          path: `changes/${changeName}/specs:ADDED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.addedMissingScenario,
          suggestion: "Add at least one scenario for the ADDED requirement"
        });
      }
    }
    const modifiedRegex = /#{2,3} MODIFIED:\s*([^\n]+)\n([\s\S]*?)(?=\n#{2,3} (?:ADDED|MODIFIED|REMOVED|RENAMED):|\n## |$)/g;
    while ((match = modifiedRegex.exec(content)) !== null) {
      deltaCount++;
      const requirementText = match[2].trim();
      if (requirementText.length === 0) {
        issues.push({
          level: "ERROR",
          path: `changes/${changeName}/specs:MODIFIED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.modifiedMissingText,
          suggestion: "Add requirement text for the MODIFIED operation"
        });
      }
    }
    const removedRegex = /#{2,3} REMOVED:\s*([^\n]+)/g;
    const removedRequirements = [];
    while ((match = removedRegex.exec(content)) !== null) {
      removedRequirements.push(match[1]);
      deltaCount++;
    }
    const modifiedRequirements = [];
    const modifiedRegex2 = /#{2,3} MODIFIED:\s*([^\n]+)/g;
    while ((match = modifiedRegex2.exec(content)) !== null) {
      modifiedRequirements.push(match[1]);
    }
    const conflicts = removedRequirements.filter((req) => modifiedRequirements.includes(req));
    if (conflicts.length > 0) {
      issues.push({
        level: "ERROR",
        path: `changes/${changeName}/specs`,
        message: `${VALIDATION_MESSAGES.deltaSpec.crossSectionConflict}: ${conflicts.join(", ")}`,
        suggestion: "Resolve conflicts by choosing either MODIFIED or REMOVED for each requirement"
      });
    }
    if (deltaCount > MAX_DELTAS_PER_CHANGE) {
      issues.push({
        level: "WARNING",
        path: `changes/${changeName}/specs`,
        message: VALIDATION_MESSAGES.deltaSpec.tooManyDeltas,
        suggestion: "Consider splitting the change into smaller, focused changes"
      });
    }
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Delta spec validation passed" : `Found ${issues.length} issues`
    };
  }
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
        level: "WARNING",
        path: "tasks.md",
        message: "No tasks found",
        suggestion: "Add tasks with completion definitions"
      });
    }
    tasks.forEach((task, index) => {
      if (!task.includes(":") && !task.includes("—") && !task.includes("-")) {
        issues.push({
          level: "WARNING",
          path: `tasks.md:task[${index}]`,
          message: VALIDATION_MESSAGES.tasks.missingCompletionDefinition,
          suggestion: 'Add a completion definition (e.g., "Task: description — completion criteria")'
        });
      }
    });
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Tasks validation passed" : `Found ${issues.length} issues`
    };
  }
  validateExecutionContract(content) {
    const issues = [];
    const requiredSections = ["Intent Lock", "Approved Behavior", "Design Constraints", "Task Batches"];
    requiredSections.forEach((section) => {
      if (!content.includes(section)) {
        issues.push({
          level: "ERROR",
          path: "execution-contract.md",
          message: `Missing required section: ${section}`,
          suggestion: `Add a ## ${section} section to the execution contract`
        });
      }
    });
    if (!content.includes("Test Obligations") && !content.includes("TDD")) {
      issues.push({
        level: "WARNING",
        path: "execution-contract.md",
        message: "No test obligations defined",
        suggestion: "Add test obligations to ensure quality implementation"
      });
    }
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Execution contract validation passed" : `Found ${issues.length} issues`
    };
  }
}
// src/agents/spec-flow.ts
var MODE = "primary";
var createSFlowAgent = (model) => ({
  id: "sflow",
  name: "sFlow",
  model,
  instructions: `# sFlow Agent

You are the main orchestrator for the sFlow workflow. Your job is to:

1. **Detect Current State** - Inspect the current change context and determine the workflow state
2. **Route to Subagents** - Delegate tasks to specialized subagents based on the current state
3. **Manage State Transitions** - Ensure valid state transitions and block invalid ones
4. **Coordinate Execution** - Orchestrate the flow between planning, execution, and closure

## Workflow States

The workflow has 8 states:
- \`exploring\` - Requirement clarification
- \`specifying\` - Artifact generation (proposal, specs, design, tasks)
- \`bridging\` - Creating execution contract
- \`approved-for-build\` - Contract approved, ready for implementation
- \`executing\` - Implementation in progress
- \`debugging\` - Handling bugs during execution
- \`closing\` - Verification and closure
- \`abandoned\` - Change abandoned (terminal state)

## Subagent Delegation

You can delegate to these specialized subagents:

| Subagent | When to Use | Description |
|----------|-------------|-------------|
| need-explorer | Requirements unclear | Clarify requirements with user |
| spec-writer | Need to create artifacts | Generate proposal, specs, design, tasks |
| contract-builder | Ready to bridge | Create execution contract |
| build-executor | Contract approved | Execute implementation with TDD |
| bug-investigator | Execution blocked | Debug and fix issues |
| code-reviewer | Batch complete | Review code quality |
| release-archivist | Ready to close | Verify and archive |
| spec-merger | Delta specs exist | Sync specs to main |

## State Detection Rules

Before routing, inspect the current change folder:
1. Check for \`proposal.md\`, \`specs/\`, \`design.md\`, \`tasks.md\`, \`execution-contract.md\`
2. Determine current state based on artifact existence
3. Check for stale artifacts (content-level detection)
4. Route to appropriate subagent

## Guardrails

- Do NOT allow implementation before planning artifacts exist
- Do NOT allow implementation before \`execution-contract.md\` exists
- Do NOT allow implementation if contract is stale
- Block invalid state transitions
- Ensure proper verification before closure

## Output Format

Always output:
1. Current detected state
2. Why that state was chosen
3. Which subagent should run next

When delegating, use the \`call_omo_agent\` tool with the appropriate \`subagent_type\`.`,
  temperature: 0.6,
  tools: {
    read: true,
    write: false,
    edit: false,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: true,
    task: true,
    skill: true,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
    session_list: true,
    session_read: true,
    session_search: true,
    session_info: true,
    background_output: true,
    background_cancel: true
  }
});
createSFlowAgent.mode = MODE;
// src/agents/need-explorer.ts
var MODE2 = "subagent";
var createNeedExplorerAgent = (model) => ({
  id: "need-explorer",
  name: "Need Explorer",
  model,
  instructions: `# Need Explorer Agent

You are a requirement clarification specialist. Your job is to help users clarify their requirements before implementation.

## Core Responsibilities

1. **Ask One Question at a Time** - Don't overwhelm the user
2. **Compare Options** - Present 2-3 approaches with trade-offs
3. **Recommend Best Approach** - Based on the context and constraints
4. **Record Decisions** - Save clarified requirements to the change directory

## Interview Process

1. Start with open-ended questions about the goal
2. Drill down into specific requirements
3. Identify constraints and edge cases
4. Compare implementation approaches
5. Recommend the best approach with reasoning
6. Record decisions in \`.spec-superflow.yaml\`

## Output Format

When clarifying requirements:
1. Ask ONE question at a time
2. Present options with pros/cons
3. Wait for user response before proceeding
4. Summarize findings after each round

## Guardrails

- Do NOT start implementation without clear requirements
- Do NOT assume user's intent - ask for clarification
- Do NOT skip the interview process
- Record all decisions for traceability

## Tool Usage

You have access to:
- \`read\` - Read existing files
- \`write\` - Write to change directory
- \`glob\` - Search for files
- \`grep\` - Search file contents

Use these to understand the current context before asking questions.`,
  temperature: 0.6,
  tools: {
    read: true,
    write: true,
    edit: false,
    glob: true,
    grep: true,
    bash: false,
    call_omo_agent: false,
    task: false,
    skill: false
  }
});
createNeedExplorerAgent.mode = MODE2;
// src/agents/spec-writer.ts
var MODE3 = "subagent";
var createSpecWriterAgent = (model) => ({
  id: "spec-writer",
  name: "Spec Writer",
  model,
  instructions: `# Spec Writer Agent

You are a specification generation specialist. Your job is to create planning artifacts with schema validation.

## Core Responsibilities

1. **Generate Artifacts** - Create proposal.md, specs/, design.md, tasks.md
2. **Validate Schema** - Run validation on each artifact
3. **Ensure Quality** - Meet all schema requirements
4. **Iterate if Needed** - Fix validation errors

## Artifact Generation

### proposal.md
- **Why section**: Explain motivation (minimum 50 characters)
- **What Changes section**: Describe changes clearly

### specs/
- Each requirement must contain SHALL or MUST statement
- Each requirement must have at least 1 scenario
- Use #### Requirement: Name format

### design.md
- Architecture decisions
- Technical constraints
- Implementation approach

### tasks.md
- Task breakdown with completion definitions
- Dependencies between tasks
- Estimated effort

## Schema Validation

After generating each artifact, run validation:
\`\`\`bash
node scripts/validate-artifacts.js <change-dir>
\`\`\`

Fix any errors before proceeding.

## Output Format

1. Generate artifact content
2. Write to change directory
3. Run validation
4. Report validation results
5. Fix errors if any

## Guardrails

- Do NOT skip schema validation
- Do NOT generate incomplete artifacts
- Do NOT proceed with validation errors
- Ensure all requirements have scenarios

## Tool Usage

You have access to:
- \`read\` - Read existing files
- \`write\` - Write artifacts
- \`edit\` - Edit artifacts
- \`bash\` - Run validation scripts

Use validation scripts to ensure quality.`,
  temperature: 0.6,
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  }
});
createSpecWriterAgent.mode = MODE3;
// src/agents/contract-builder.ts
var MODE4 = "subagent";
var createContractBuilderAgent = (model) => ({
  id: "contract-builder",
  name: "Contract Builder",
  model,
  instructions: `# Contract Builder Agent

You are a bridge contract specialist. Your job is to create execution contracts from planning artifacts.

## Core Responsibilities

1. **Parse Artifacts** - Extract intent, behavior, constraints, and tasks from planning artifacts
2. **Generate Contract** - Create execution-contract.md with all required sections
3. **Validate Contract** - Ensure contract is complete and consistent
4. **Track Changes** - Detect stale contracts and regenerate when needed

## Contract Structure

The execution contract must contain:

### Intent Lock
- Extracted from proposal.md scope
- Defines the boundaries of the change

### Approved Behavior
- Extracted from specs/
- Lists all approved requirements and scenarios

### Design Constraints
- Extracted from design.md
- Technical constraints and architecture decisions

### Task Batches
- Extracted from tasks.md
- Execution order and dependencies

### Test Obligations
- TDD requirements
- Review gates

## Contract Generation Process

1. Read all planning artifacts (proposal.md, specs/, design.md, tasks.md)
2. Extract relevant sections for each contract component
3. Generate execution-contract.md
4. Validate contract completeness
5. Present to user for approval

## Stale Detection

Detect stale contracts by comparing:
- Proposal scope vs contract intent lock
- Specs vs approved behavior
- Design vs constraints
- Tasks vs task batches

If stale, regenerate the contract.

## Output Format

1. Read planning artifacts
2. Extract sections
3. Generate contract
4. Validate
5. Present for approval

## Guardrails

- Do NOT generate incomplete contracts
- Do NOT skip user approval
- Do NOT proceed with stale contracts
- Ensure all sections are present

## Tool Usage

You have access to:
- \`read\` - Read planning artifacts
- \`write\` - Write execution contract
- \`edit\` - Edit contract
- \`bash\` - Run validation scripts`,
  temperature: 0.6,
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  }
});
createContractBuilderAgent.mode = MODE4;
// src/agents/build-executor.ts
var MODE5 = "subagent";
var createBuildExecutorAgent = (model) => ({
  id: "build-executor",
  name: "Build Executor",
  model,
  instructions: `# Build Executor Agent

You are an execution specialist with TDD discipline. Your job is to implement code according to the execution contract.

## Core Responsibilities

1. **Follow Contract** - Implement according to execution-contract.md
2. **TDD Discipline** - Write tests first, then implementation
3. **Review Gates** - Stop for review after meaningful batches
4. **Track Progress** - Update tasks.md as you complete work

## TDD Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**

### RED-GREEN-REFACTOR Cycle

| Phase | Action | Evidence Required |
|-------|--------|-------------------|
| **RED** | Write the failing test | Run it, see it fail for expected reason |
| **GREEN** | Write minimal production code | Run test, see it pass |
| **REFACTOR** | Clean up code | Full suite still passing |

### Red Flags - STOP and return to RED

If you catch yourself thinking:
- "Just a quick implementation first, test later"
- "This is simple enough, I'll test after"
- "Let me write the code and the tests together"

**ALL of these mean: STOP. Write the test first.**

## Execution Process

1. Read execution-contract.md
2. Select next task from task batches
3. Write failing test (RED)
4. Write minimal implementation (GREEN)
5. Refactor if needed (REFACTOR)
6. Update tasks.md
7. Repeat until batch complete

## Review Gates

After completing a batch:
1. Run all tests
2. Check for spec violations
3. Verify code quality
4. Report completion

## Workflow Modes

- **Full**: Standard contract-first execution
- **Hotfix**: Minimal contract, inline execution
- **Tweak**: Direct edit, no contract required

## Guardrails

- Do NOT skip TDD cycle
- Do NOT proceed without failing test
- Do NOT skip review gates
- Do NOT modify contract without approval

## Tool Usage

You have access to:
- \`read\` - Read contract and code
- \`write\` - Write code and tests
- \`edit\` - Edit code
- \`bash\` - Run tests and commands
- \`lsp_diagnostics\` - Check for errors
- \`lsp_goto_definition\` - Navigate code`,
  temperature: 0.7,
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  }
});
createBuildExecutorAgent.mode = MODE5;
// src/agents/bug-investigator.ts
var MODE6 = "subagent";
var createBugInvestigatorAgent = (model) => ({
  id: "bug-investigator",
  name: "Bug Investigator",
  model,
  instructions: `# Bug Investigator Agent

You are a debugging specialist. Your job is to investigate and fix bugs during implementation.

## Core Responsibilities

1. **Root Cause Analysis** - Find the actual cause of the bug
2. **Pattern Analysis** - Identify similar issues in the codebase
3. **Hypothesis Testing** - Form and test hypotheses
4. **Implement Fix** - Apply minimal, targeted fixes

## 4-Phase Debugging Process

### Phase 1: Root Cause Analysis
- Understand the symptoms
- Trace the execution path
- Identify the failure point
- Determine the root cause

### Phase 2: Pattern Analysis
- Search for similar patterns in the codebase
- Check for common anti-patterns
- Review related code for similar issues

### Phase 3: Hypothesis Verification
- Form hypotheses about the cause
- Test each hypothesis
- Confirm the root cause

### Phase 4: Implement Fix
- Design minimal fix
- Implement the fix
- Verify the fix works
- Check for regressions

## Escalation Rules

After 3+ consecutive fix failures:
1. Question the architecture
2. Consider design flaws
3. Escalate to user with recommendations

## Output Format

1. Describe the symptoms
2. Trace the execution
3. Identify root cause
4. Form hypothesis
5. Test hypothesis
6. Implement fix
7. Verify fix

## Guardrails

- Do NOT guess at fixes
- Do NOT skip root cause analysis
- Do NOT apply fixes without verification
- Do NOT ignore pattern analysis

## Tool Usage

You have access to:
- \`read\` - Read code and logs
- \`edit\` - Apply fixes
- \`bash\` - Run tests and commands
- \`grep\` - Search for patterns
- \`lsp_diagnostics\` - Check for errors
- \`lsp_goto_definition\` - Navigate code
- \`lsp_find_references\` - Find usages`,
  temperature: 0.6,
  tools: {
    read: true,
    write: false,
    edit: true,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  }
});
createBugInvestigatorAgent.mode = MODE6;
// src/agents/code-reviewer.ts
var MODE7 = "subagent";
var createCodeReviewerAgent = (model) => ({
  id: "code-reviewer",
  name: "Code Reviewer",
  model,
  instructions: `# Code Reviewer Agent

You are a code review specialist. Your job is to review code quality and spec compliance.

## Core Responsibilities

1. **Spec Compliance** - Verify code matches specifications
2. **Code Quality** - Check for best practices and patterns
3. **Test Coverage** - Ensure adequate test coverage
4. **Security Review** - Identify potential security issues

## Review Process

### 1. Spec Compliance Check
- Compare implementation against specs/
- Verify all requirements are met
- Check for spec violations

### 2. Code Quality Review
- Check for code smells
- Verify naming conventions
- Review function complexity
- Check for proper error handling

### 3. Test Coverage Analysis
- Verify test coverage for new code
- Check for missing test cases
- Review test quality

### 4. Security Review
- Check for common vulnerabilities
- Review input validation
- Check for proper authentication/authorization

## Review Output

### Critical Issues
- Must be fixed before proceeding
- Spec violations
- Security vulnerabilities
- Breaking changes

### Important Issues
- Should be fixed
- Code quality concerns
- Missing tests
- Performance issues

### Minor Issues
- Nice to have
- Style improvements
- Documentation gaps

## Gate Rules

Block progress on:
- Logic defects
- Spec violations
- Missing required tests
- Unintended scope expansion

## Output Format

1. Review code changes
2. Check spec compliance
3. Analyze code quality
4. Review test coverage
5. Check security
6. Provide structured feedback

## Guardrails

- Do NOT approve code with critical issues
- Do NOT skip spec compliance check
- Do NOT ignore security concerns
- Do NOT approve without test coverage

## Tool Usage

You have access to:
- \`read\` - Read code and specs
- \`bash\` - Run tests and commands
- \`grep\` - Search for patterns
- \`lsp_diagnostics\` - Check for errors
- \`lsp_goto_definition\` - Navigate code
- \`lsp_find_references\` - Find usages`,
  temperature: 0.6,
  tools: {
    read: true,
    write: false,
    edit: false,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  }
});
createCodeReviewerAgent.mode = MODE7;
// src/agents/release-archivist.ts
var MODE8 = "subagent";
var createReleaseArchivistAgent = (model) => ({
  id: "release-archivist",
  name: "Release Archivist",
  model,
  instructions: `# Release Archivist Agent

You are a closure and archiving specialist. Your job is to verify completion and archive changes.

## Core Responsibilities

1. **Verify Completion** - Ensure all tasks are complete
2. **Run Tests** - Verify all tests pass
3. **Generate Report** - Create verification report
4. **Archive Change** - Move to archive directory

## Verification Before Completion Iron Law

**NO COMPLETION CLAIMS WITHOUT FRESH EVIDENCE**

### Required Evidence
1. All tests pass
2. All tasks marked complete
3. Spec compliance verified
4. Code review passed

### Verification Process
1. Run full test suite
2. Read test output
3. Confirm all tests pass
4. Check task completion in tasks.md
5. Verify spec compliance

## Closure Process

### 1. Verify All Tasks Complete
- Check tasks.md for unchecked items
- Verify each task has evidence
- Confirm no pending work

### 2. Run Final Tests
- Execute full test suite
- Verify all tests pass
- Check for regressions

### 3. Generate Verification Report
- Document verification results
- List any issues found
- Provide risk summary

### 4. Archive Change
- Move change to archive directory
- Update status to archived
- Generate archive metadata

## Archive Structure

\`\`\`
archive/
├── <change-name>/
│   ├── proposal.md
│   ├── specs/
│   ├── design.md
│   ├── tasks.md
│   ├── execution-contract.md
│   ├── verification-report.md
│   └── archive-metadata.json
\`\`\`

## Output Format

1. Verify task completion
2. Run tests
3. Generate report
4. Archive change
5. Provide summary

## Guardrails

- Do NOT archive incomplete changes
- Do NOT skip test verification
- Do NOT archive without evidence
- Do NOT skip verification report

## Tool Usage

You have access to:
- \`read\` - Read files and reports
- \`write\` - Write verification report and archive
- \`bash\` - Run tests and commands
- \`glob\` - Search for files`,
  temperature: 0.7,
  tools: {
    read: true,
    write: true,
    edit: false,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  }
});
createReleaseArchivistAgent.mode = MODE8;
// src/agents/spec-merger.ts
var MODE9 = "subagent";
var createSpecMergerAgent = (model) => ({
  id: "spec-merger",
  name: "Spec Merger",
  model,
  instructions: `# Spec Merger Agent

You are a specification synchronization specialist. Your job is to merge delta specs into main specs.

## Core Responsibilities

1. **Parse Delta Specs** - Read ADDED/MODIFIED/REMOVED/RENAMED operations
2. **Apply Changes** - Merge deltas into main specs
3. **Detect Conflicts** - Identify conflicting changes
4. **Resolve Conflicts** - Handle merge conflicts appropriately

## Delta Operations

### ADDED
- Add new requirement to spec
- Include requirement text and scenarios

### MODIFIED
- Update existing requirement
- Preserve version history

### REMOVED
- Remove requirement from spec
- Document removal reason

### RENAMED
- Rename requirement
- Update all references

## Merge Process

### 1. Parse Delta Spec
- Read change directory
- Extract delta operations
- Validate delta format

### 2. Read Main Spec
- Load current spec file
- Parse existing requirements
- Identify target requirements

### 3. Apply Changes
- Apply ADDED operations
- Apply MODIFIED operations
- Apply REMOVED operations
- Apply RENAMED operations

### 4. Detect Conflicts
- Check for conflicting operations
- Identify overlapping changes
- Report conflicts to user

### 5. Resolve Conflicts
- Present conflicts to user
- Apply resolution
- Update main spec

## Conflict Detection

### Cross-Section Conflicts
- Same requirement in MODIFIED and REMOVED
- Same requirement in ADDED and MODIFIED

### Overlapping Changes
- Multiple changes to same requirement
- Conflicting requirement text

## Output Format

1. Parse delta spec
2. Read main spec
3. Apply changes
4. Detect conflicts
5. Resolve conflicts
6. Update main spec

## Guardrails

- Do NOT merge without conflict resolution
- Do NOT skip conflict detection
- Do NOT apply invalid deltas
- Do NOT overwrite without user approval

## Tool Usage

You have access to:
- \`read\` - Read specs and deltas
- \`write\` - Write updated specs
- \`edit\` - Edit specs
- \`bash\` - Run validation scripts`,
  temperature: 0.7,
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  }
});
createSpecMergerAgent.mode = MODE9;
// src/agents/config-loader.ts
import { join } from "path";
import { homedir } from "os";
var USER_CONFIG_FILE = join(homedir(), ".sFlow", "config.json");
// src/tools/workflow-router.ts
function createWorkflowRouterTool() {
  return {
    name: "workflow_router",
    description: "Detect current workflow state and route to appropriate skill",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true
      }
    },
    execute: async (params, context) => {
      const { changeDir } = params;
      const validator = new Validator;
      try {
        const artifacts = {
          proposal: await fileExists(`${changeDir}/proposal.md`),
          specs: await directoryExists(`${changeDir}/specs`),
          design: await fileExists(`${changeDir}/design.md`),
          tasks: await fileExists(`${changeDir}/tasks.md`),
          contract: await fileExists(`${changeDir}/execution-contract.md`),
          state: await fileExists(`${changeDir}/.spec-superflow.yaml`)
        };
        let state;
        let skill;
        let reasons = [];
        if (!artifacts.proposal && !artifacts.specs) {
          state = "exploring";
          skill = "need-explorer";
          reasons.push("No planning artifacts found");
        } else if (!artifacts.contract) {
          state = "specifying";
          skill = "spec-writer";
          reasons.push("Planning artifacts exist but contract is missing");
        } else if (!await isContractApproved(changeDir)) {
          state = "bridging";
          skill = "contract-builder";
          reasons.push("Contract exists but not approved");
        } else {
          state = "executing";
          skill = "build-executor";
          reasons.push("Contract approved, ready for implementation");
        }
        if (artifacts.contract) {
          const isStale = await isContractStale(changeDir);
          if (isStale) {
            state = "bridging";
            skill = "contract-builder";
            reasons.push("Contract is stale, needs regeneration");
          }
        }
        return {
          success: true,
          data: {
            state,
            skill,
            reasons,
            artifacts
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: ["Check if the change directory exists", "Verify file permissions"]
        };
      }
    }
  };
}
async function fileExists(path) {
  try {
    await Bun.file(path).exists();
    return true;
  } catch {
    return false;
  }
}
async function directoryExists(path) {
  try {
    const dir = Bun.file(path);
    return await dir.exists();
  } catch {
    return false;
  }
}
async function isContractApproved(changeDir) {
  return false;
}
async function isContractStale(changeDir) {
  return false;
}
// src/tools/contract-validator.ts
function createContractValidatorTool() {
  return {
    name: "contract_validator",
    description: "Validate execution contracts against planning artifacts",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true
      }
    },
    execute: async (params, context) => {
      const { changeDir } = params;
      const validator = new Validator;
      try {
        const contractContent = await readFile(`${changeDir}/execution-contract.md`);
        if (!contractContent) {
          return {
            success: true,
            data: {
              validation: { valid: false, issues: [] },
              isStale: false,
              recommendations: ["execution-contract.md not found - run contract-builder to create the contract"]
            }
          };
        }
        const report = validator.validateExecutionContract(contractContent);
        const proposalContent = await readFile(`${changeDir}/proposal.md`);
        const isStale = await checkContractStaleness(changeDir, contractContent, proposalContent);
        return {
          success: true,
          data: {
            validation: report,
            isStale,
            recommendations: generateRecommendations(report, isStale)
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: ["Check file permissions", "Verify file format"]
        };
      }
    }
  };
}
async function readFile(path) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}
async function checkContractStaleness(changeDir, contractContent, proposalContent) {
  if (!proposalContent) {
    return false;
  }
  return false;
}
function generateRecommendations(report, isStale) {
  const recommendations = [];
  if (isStale) {
    recommendations.push("Contract is stale - regenerate with contract-builder");
  }
  if (!report.valid) {
    recommendations.push("Fix validation errors before proceeding");
  }
  report.issues.filter((issue) => issue.level === "ERROR").forEach((issue) => {
    recommendations.push(`Fix: ${issue.message}`);
  });
  return recommendations;
}
// src/tools/artifact-inspector.ts
function createArtifactInspectorTool() {
  return {
    name: "artifact_inspector",
    description: "Inspect planning artifacts for completeness and consistency",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true
      },
      artifactType: {
        type: "string",
        description: "Type of artifact to inspect (proposal, specs, design, tasks)",
        required: false
      }
    },
    execute: async (params, context) => {
      const { changeDir, artifactType } = params;
      const validator = new Validator;
      try {
        const results = {};
        if (!artifactType || artifactType === "proposal") {
          const proposalContent = await readFile2(`${changeDir}/proposal.md`);
          if (proposalContent) {
            results.proposal = validator.validateProposal(proposalContent);
          } else {
            results.proposal = { valid: false, error: "File not found" };
          }
        }
        if (!artifactType || artifactType === "specs") {
          const specsDir = `${changeDir}/specs`;
          const specFiles = await listFiles(specsDir);
          results.specs = {};
          for (const specFile of specFiles) {
            const specContent = await readFile2(`${specsDir}/${specFile}`);
            if (specContent) {
              results.specs[specFile] = validator.validateSpec(specContent, specFile.replace(".md", ""));
            }
          }
        }
        if (!artifactType || artifactType === "design") {
          const designContent = await readFile2(`${changeDir}/design.md`);
          if (designContent) {
            results.design = { valid: true, message: "Design file exists" };
          } else {
            results.design = { valid: false, error: "File not found" };
          }
        }
        if (!artifactType || artifactType === "tasks") {
          const tasksContent = await readFile2(`${changeDir}/tasks.md`);
          if (tasksContent) {
            results.tasks = validator.validateTasks(tasksContent);
          } else {
            results.tasks = { valid: false, error: "File not found" };
          }
        }
        const summary = generateInspectionSummary(results);
        return {
          success: true,
          data: {
            results,
            summary,
            recommendations: generateInspectionRecommendations(results)
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: ["Check file permissions", "Verify directory structure"]
        };
      }
    }
  };
}
async function readFile2(path) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}
async function listFiles(dirPath) {
  try {
    const dir = Bun.dir(dirPath);
    const files = [];
    for await (const file of dir) {
      if (file.isFile() && file.name.endsWith(".md")) {
        files.push(file.name);
      }
    }
    return files;
  } catch {
    return [];
  }
}
function generateInspectionSummary(results) {
  const issues = [];
  const proposal = results.proposal;
  if (proposal && !proposal.valid) {
    issues.push(`Proposal: ${proposal.issues?.length || 0} issues`);
  }
  const specs = results.specs;
  if (specs) {
    const specIssues = Object.values(specs).filter((s) => !s.valid).length;
    if (specIssues > 0) {
      issues.push(`Specs: ${specIssues} files with issues`);
    }
  }
  const tasks = results.tasks;
  if (tasks && !tasks.valid) {
    issues.push(`Tasks: ${tasks.issues?.length || 0} issues`);
  }
  if (issues.length === 0) {
    return "All artifacts are valid";
  }
  return `Found issues: ${issues.join(", ")}`;
}
function generateInspectionRecommendations(results) {
  const recommendations = [];
  const proposal = results.proposal;
  if (proposal && !proposal.valid) {
    recommendations.push("Fix proposal issues before proceeding");
  }
  const specs = results.specs;
  if (specs) {
    const specIssues = Object.values(specs).filter((s) => !s.valid).length;
    if (specIssues > 0) {
      recommendations.push("Fix spec issues before proceeding");
    }
  }
  const tasks = results.tasks;
  if (tasks && !tasks.valid) {
    recommendations.push("Fix task issues before proceeding");
  }
  return recommendations;
}
// src/hooks/state-transition.ts
var VALID_TRANSITIONS = {
  exploring: ["specifying", "abandoned"],
  specifying: ["bridging", "exploring", "abandoned"],
  bridging: ["approved-for-build", "specifying", "abandoned"],
  "approved-for-build": ["executing", "bridging", "abandoned"],
  executing: ["debugging", "closing", "abandoned"],
  debugging: ["executing", "abandoned"],
  closing: ["abandoned"],
  abandoned: []
};
function createStateTransitionHook() {
  return {
    name: "state_transition",
    description: "Manage workflow state transitions and validate transitions",
    execute: async (context) => {
      const { changeDir, action, data } = context;
      try {
        const currentState = await getCurrentState(changeDir);
        const newState = data?.newState;
        if (!newState) {
          return { success: true, data: { currentState: await getCurrentState(changeDir) } };
        }
        if (!currentState) {
          await updateState(changeDir, newState);
          return {
            success: true,
            data: { from: null, to: newState, timestamp: new Date().toISOString() }
          };
        }
        const validTransitions = VALID_TRANSITIONS[currentState] || [];
        if (!validTransitions.includes(newState)) {
          return {
            success: false,
            error: `Invalid transition from ${currentState} to ${newState}`,
            block: true,
            blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${validTransitions.join(", ")}`
          };
        }
        await updateState(changeDir, newState);
        return {
          success: true,
          data: {
            from: currentState,
            to: newState,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
async function getCurrentState(changeDir) {
  if (!changeDir)
    return null;
  const stateFilePath = `${changeDir}/.sflow/state.json`;
  try {
    const file = Bun.file(stateFilePath);
    if (await file.exists()) {
      const content = await file.text();
      const state = JSON.parse(content);
      return state.state || state.currentState || "exploring";
    }
  } catch {}
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
  } else {
    state = { mode: "full", createdAt: now };
  }
  state.state = newState;
  state.updatedAt = now;
  await Bun.write(stateFilePath, JSON.stringify(state, null, 2));
}
// src/hooks/artifact-validation.ts
function createArtifactValidationHook() {
  return {
    name: "artifact_validation",
    description: "Validate artifacts when transitioning between states",
    execute: async (context) => {
      const { changeDir, action, data } = context;
      const validator = new Validator;
      try {
        const newState = data?.newState;
        switch (newState) {
          case "specifying":
            return await validateForSpecifying(changeDir, validator);
          case "bridging":
            return await validateForBridging(changeDir, validator);
          case "approved-for-build":
            return await validateForExecution(changeDir, validator);
          case "closing":
            return await validateForClosing(changeDir, validator);
          default:
            return { success: true };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
async function validateForSpecifying(changeDir, validator) {
  const proposalContent = await readFile3(`${changeDir}/proposal.md`);
  if (!proposalContent) {
    return {
      success: false,
      error: "Proposal file not found",
      block: true,
      blockReason: "Cannot enter specifying state without a proposal"
    };
  }
  const report = validator.validateProposal(proposalContent);
  if (!report.valid) {
    return {
      success: false,
      error: "Proposal validation failed",
      block: true,
      blockReason: `Proposal has ${report.issues.filter((i) => i.level === "ERROR").length} errors`
    };
  }
  return { success: true };
}
async function validateForBridging(changeDir, validator) {
  const specsDir = `${changeDir}/specs`;
  const specFiles = await listFiles2(specsDir);
  if (specFiles.length === 0) {
    return {
      success: false,
      error: "No spec files found",
      block: true,
      blockReason: "Cannot enter bridging state without specs"
    };
  }
  for (const specFile of specFiles) {
    const specContent = await readFile3(`${specsDir}/${specFile}`);
    if (specContent) {
      const report = validator.validateSpec(specContent, specFile.replace(".md", ""));
      if (!report.valid) {
        return {
          success: false,
          error: `Spec validation failed: ${specFile}`,
          block: true,
          blockReason: `Spec ${specFile} has ${report.issues.filter((i) => i.level === "ERROR").length} errors`
        };
      }
    }
  }
  return { success: true };
}
async function validateForExecution(changeDir, validator) {
  const contractContent = await readFile3(`${changeDir}/execution-contract.md`);
  if (!contractContent) {
    return {
      success: false,
      error: "Execution contract not found",
      block: true,
      blockReason: "Cannot enter execution state without an execution contract"
    };
  }
  const report = validator.validateExecutionContract(contractContent);
  if (!report.valid) {
    return {
      success: false,
      error: "Execution contract validation failed",
      block: true,
      blockReason: `Execution contract has ${report.issues.filter((i) => i.level === "ERROR").length} errors`
    };
  }
  return { success: true };
}
async function validateForClosing(changeDir, validator) {
  const tasksContent = await readFile3(`${changeDir}/tasks.md`);
  if (!tasksContent) {
    return {
      success: false,
      error: "Tasks file not found",
      block: true,
      blockReason: "Cannot enter closing state without tasks"
    };
  }
  const report = validator.validateTasks(tasksContent);
  if (!report.valid) {
    return {
      success: false,
      error: "Tasks validation failed",
      block: true,
      blockReason: `Tasks has ${report.issues.filter((i) => i.level === "ERROR").length} errors`
    };
  }
  return { success: true };
}
async function readFile3(path) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}
async function listFiles2(dirPath) {
  try {
    const dir = Bun.dir(dirPath);
    const files = [];
    for await (const file of dir) {
      if (file.isFile() && file.name.endsWith(".md")) {
        files.push(file.name);
      }
    }
    return files;
  } catch {
    return [];
  }
}
// src/hooks/guard.ts
function createGuardHook() {
  return {
    name: "guard",
    description: "Guard state transitions and block invalid operations",
    execute: async (context) => {
      const { changeDir, action, data } = context;
      try {
        const guards = [
          await checkArtifactExistence(changeDir),
          await checkContractStaleness2(changeDir),
          await checkTaskCompletion(changeDir),
          await checkDebuggingState(changeDir)
        ];
        const blockingGuards = guards.filter((g) => g.block);
        if (blockingGuards.length > 0) {
          return {
            success: false,
            error: "Guard conditions not met",
            block: true,
            blockReason: blockingGuards.map((g) => g.blockReason).join("; ")
          };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
async function checkArtifactExistence(changeDir) {
  if (!changeDir)
    return { success: true };
  const dirExists = await fileExists2(changeDir);
  if (!dirExists)
    return { success: true };
  const requiredArtifacts = ["proposal.md", "specs", "design.md", "tasks.md"];
  const missingArtifacts = [];
  for (const artifact of requiredArtifacts) {
    const exists = await fileExists2(`${changeDir}/${artifact}`);
    if (!exists) {
      missingArtifacts.push(artifact);
    }
  }
  if (missingArtifacts.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `Missing required artifacts: ${missingArtifacts.join(", ")}`
    };
  }
  return { success: true };
}
async function checkContractStaleness2(changeDir) {
  return { success: true };
}
async function checkTaskCompletion(changeDir) {
  return { success: true };
}
async function checkDebuggingState(changeDir) {
  return { success: true };
}
async function fileExists2(path) {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}
// src/features/workflow-manager.ts
function createWorkflowManager(config = { enabled: true }) {
  return {
    name: "workflow_manager",
    config,
    async initialize() {
      if (!config.enabled) {
        return { success: true, data: { message: "Workflow manager disabled" } };
      }
      console.log("Workflow manager initialized");
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
            state: "exploring",
            message: "Workflow started"
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async getState(changeDir) {
      try {
        const state = await readStateFile(changeDir);
        return {
          success: true,
          data: state
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async transitionState(changeDir, newState) {
      try {
        const currentState = await readStateFile(changeDir);
        const validTransitions = getValidTransitions(currentState.state);
        if (!validTransitions.includes(newState)) {
          return {
            success: false,
            error: `Invalid transition from ${currentState.state} to ${newState}`
          };
        }
        await updateStateFile(changeDir, {
          ...currentState,
          state: newState,
          updatedAt: new Date().toISOString()
        });
        return {
          success: true,
          data: {
            from: currentState.state,
            to: newState,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
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
            message: "Workflow completed and archived"
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
async function createChangeDirectory(changeDir) {
  const stateDir = `${changeDir}/.sflow`;
  await Bun.write(`${stateDir}/state.json`, JSON.stringify({
    state: "exploring",
    mode: "full",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, null, 2));
}
async function initializeStateFile(changeDir) {
  const stateDir = `${changeDir}/.sflow`;
  const stateFile = `${stateDir}/state.json`;
  const file = Bun.file(stateFile);
  if (!await file.exists()) {
    await Bun.write(stateFile, JSON.stringify({
      state: "exploring",
      mode: "full",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, null, 2));
  }
}
async function readStateFile(changeDir) {
  const stateFile = `${changeDir}/.sflow/state.json`;
  const file = Bun.file(stateFile);
  if (await file.exists()) {
    const content = await file.text();
    return JSON.parse(content);
  }
  return {
    state: "exploring",
    mode: "full",
    updatedAt: new Date().toISOString()
  };
}
async function updateStateFile(changeDir, state) {
  const stateFile = `${changeDir}/.sflow/state.json`;
  await Bun.write(stateFile, JSON.stringify(state, null, 2));
}
async function archiveChange(changeDir) {
  const archiveDir = `${changeDir}/.sflow/archive`;
  await Bun.write(`${archiveDir}/archived-at.txt`, new Date().toISOString());
}
function getValidTransitions(currentState) {
  const transitions = {
    exploring: ["specifying", "abandoned"],
    specifying: ["bridging", "exploring", "abandoned"],
    bridging: ["approved-for-build", "specifying", "abandoned"],
    "approved-for-build": ["executing", "bridging", "abandoned"],
    executing: ["debugging", "closing", "abandoned"],
    debugging: ["executing", "abandoned"],
    closing: ["abandoned"],
    abandoned: []
  };
  return transitions[currentState] || [];
}
// src/features/state-manager.ts
function createStateManager(config = { enabled: true }) {
  return {
    name: "state_manager",
    config,
    async initialize() {
      if (!config.enabled) {
        return { success: true, data: { message: "State manager disabled" } };
      }
      console.log("State manager initialized");
      return { success: true };
    },
    async getState(changeDir) {
      try {
        const state = await readStateFile2(changeDir);
        return {
          success: true,
          data: state
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async updateState(changeDir, updates) {
      try {
        const currentState = await readStateFile2(changeDir);
        const newState = { ...currentState, ...updates, updatedAt: new Date().toISOString() };
        await writeStateFile(changeDir, newState);
        return {
          success: true,
          data: newState
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async isContractApproved(changeDir) {
      try {
        const state = await readStateFile2(changeDir);
        return {
          success: true,
          data: {
            approved: state.contractApproved || false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async approveContract(changeDir) {
      try {
        const state = await readStateFile2(changeDir);
        const newState = {
          ...state,
          contractApproved: true,
          contractApprovedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await writeStateFile(changeDir, newState);
        return {
          success: true,
          data: {
            approved: true,
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async isContractStale(changeDir) {
      try {
        return {
          success: true,
          data: {
            stale: false
          }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
async function readStateFile2(changeDir) {
  return {
    state: "exploring",
    mode: "full",
    contractApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
async function writeStateFile(changeDir, state) {
  console.log(`Writing state file in: ${changeDir}`, state);
}
// ../shared/src/deep-merge.js
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];
      if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue);
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }
  }
  return result;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ../shared/src/file-utils.js
async function fileExists3(path) {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}
async function readFile4(path) {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}
async function writeFile(path, content) {
  try {
    await Bun.write(path, content);
    return true;
  } catch {
    return false;
  }
}
async function listFiles3(dirPath, extension) {
  try {
    const dir = Bun.dir(dirPath);
    const files = [];
    for await (const file of dir) {
      if (file.isFile()) {
        if (!extension || file.name.endsWith(extension)) {
          files.push(file.name);
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}
// src/index.ts
var PLUGIN_ID = "opencode-sflow";
var PLUGIN_VERSION = "0.1.0";
function createSFlowPlugin(ctx) {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    async initialize() {
      console.log(`[sFlow] Initializing plugin v${PLUGIN_VERSION}`);
      return { success: true };
    },
    getInfo() {
      return {
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        name: "sFlow",
        description: "OpenSpec planning engine + Superpowers execution discipline",
        agents: [
          "sflow",
          "need-explorer",
          "spec-writer",
          "contract-builder",
          "build-executor",
          "bug-investigator",
          "code-reviewer",
          "release-archivist",
          "spec-merger"
        ],
        tools: [
          "workflow_router",
          "contract_validator",
          "artifact_inspector"
        ],
        hooks: [
          "state_transition",
          "artifact_validation",
          "guard"
        ],
        features: [
          "workflow_manager",
          "state_manager"
        ]
      };
    }
  };
}
var src_default = createSFlowPlugin;
export {
  writeFile,
  readFile4 as readFile,
  listFiles3 as listFiles,
  fileExists3 as fileExists,
  src_default as default,
  deepMerge,
  createWorkflowRouterTool,
  createWorkflowManager,
  createStateTransitionHook,
  createStateManager,
  createSpecWriterAgent,
  createSpecMergerAgent,
  createSFlowPlugin,
  createSFlowAgent,
  createReleaseArchivistAgent,
  createNeedExplorerAgent,
  createGuardHook,
  createContractValidatorTool,
  createContractBuilderAgent,
  createCodeReviewerAgent,
  createBuildExecutorAgent,
  createBugInvestigatorAgent,
  createArtifactValidationHook,
  createArtifactInspectorTool,
  Validator,
  PLUGIN_VERSION,
  PLUGIN_ID
};
