import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../core/src/validation/constants.ts
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
  },
  design: {
    missingArchitecture: "Design must include architecture decisions",
    missingConstraints: "Design must include technical constraints",
    missingApproach: "Design must include implementation approach"
  }
};
// ../core/src/validation/validator.ts
var DESIGN_REQUIRED_SECTIONS = [
  { key: "Architecture Decision", pattern: /## Architecture\b|### Architecture\b/i },
  { key: "Design Constraints", pattern: /## Constraints\b|## Design Constraints\b/i },
  { key: "Implementation Approach", pattern: /## Approach\b|## Implementation\b/i }
];

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
    const requirements = [...content.matchAll(/(?:SHALL|MUST)\s+([^\n]+)/g)].map((m) => m[1]);
    if (requirements.length === 0) {
      issues.push({
        level: "ERROR",
        path: `specs/${specName}/spec.md`,
        message: "No requirements found (SHALL/MUST statements)",
        suggestion: "Add at least one requirement with SHALL or MUST statement"
      });
    }
    const scenarios = [...content.matchAll(/#### Scenario:\s*([^\n]+)/g)].map((m) => m[1]);
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
    const modifiedRequirements = [];
    while ((match = modifiedRegex.exec(content)) !== null) {
      deltaCount++;
      modifiedRequirements.push(match[1]);
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
  validateDesign(content) {
    const issues = [];
    for (const section of DESIGN_REQUIRED_SECTIONS) {
      if (!section.pattern.test(content)) {
        issues.push({
          level: "ERROR",
          path: "design.md",
          message: `Missing section: ${section.key}`,
          suggestion: `Add a section describing ${section.key.toLowerCase()}`
        });
      }
    }
    return {
      valid: issues.filter((i) => i.level === "ERROR").length === 0,
      issues,
      summary: issues.length === 0 ? "Design validation passed" : `Found ${issues.length} issues`
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
// ../core/src/constants.ts
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
var ALL_STATES = Object.keys(VALID_TRANSITIONS);
function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed)
    return false;
  return allowed.includes(to);
}
function getValidTransitions(from) {
  return VALID_TRANSITIONS[from] || [];
}
// src/agents/agent-tools.ts
var COMMON_TOOLS = {
  read: true,
  glob: true,
  grep: true
};
var AGENT_TOOLS = {
  sflow: {
    ...COMMON_TOOLS,
    write: false,
    edit: false,
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
  },
  "need-explorer": {
    ...COMMON_TOOLS,
    write: true,
    edit: false,
    bash: false,
    call_omo_agent: false,
    task: false,
    skill: false
  },
  "spec-writer": {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  },
  "contract-builder": {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  },
  "build-executor": {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  },
  "bug-investigator": {
    ...COMMON_TOOLS,
    write: false,
    edit: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  },
  "code-reviewer": {
    ...COMMON_TOOLS,
    write: false,
    edit: false,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true
  },
  "release-archivist": {
    ...COMMON_TOOLS,
    write: true,
    edit: false,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  },
  "spec-merger": {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    call_omo_agent: false,
    task: false,
    skill: false
  }
};
function getAgentTools(name) {
  return AGENT_TOOLS[name] || { ...COMMON_TOOLS };
}

// src/agents/spec-flow.ts
var MODE = "primary";
var createSFlowAgent = (model) => ({
  id: "sflow",
  name: "sFlow",
  model,
  instructions: `<Role>
You are "sFlow" — Workflow Orchestration Agent from sFlow Plugin.

**Why sFlow?**: s = Spec/planning, Flow = workflow execution. You orchestrate the entire development lifecycle from idea to delivery.

**Identity**: Workflow engineer. You don't write code yourself — you plan, delegate, verify, and ship through specialized subagents.

**Core Competencies**:
- Clarifying requirements and translating them into actionable specs
- Breaking down complex features into executable plans
- Delegating implementation to the right subagent at the right time
- Enforcing quality gates (TDD, code review, validation)
- Managing workflow state transitions
- Ensuring nothing ships without proper verification

**Operating Mode**: You NEVER work alone. Every implementation task goes through the workflow pipeline. Your job is routing, coordination, and quality control — never direct implementation.

</Role>
<Workflow>

## Workflow States

The workflow has 8 states, executed in order:

| # | State | Subagent | Artifact | Gate |
|---|-------|----------|----------|------|
| 1 | exploring | need-explorer | clarified requirements | user confirms |
| 2 | specifying | spec-writer | proposal.md, specs/, design.md, tasks.md | artifacts validated |
| 3 | bridging | contract-builder | execution-contract.md | contract validated |
| 4 | approved-for-build | — | approved contract | user approves |
| 5 | executing | build-executor | implemented code | tests pass, code reviewed |
| 6 | debugging | bug-investigator | bug report, fix | issue resolved |
| 7 | closing | release-archivist | verification report | all checks pass |
| 8 | abandoned | — | — | terminal state (user decision) |

</Workflow>
<Delegation>

## Subagent Guide

| Subagent | When to Delegate | Description |
|----------|-----------------|-------------|
| need-explorer | User request is vague/ambiguous | Ask clarifying questions, document requirements |
| spec-writer | Requirements are clear | Generate proposal, specs, design, tasks |
| contract-builder | Specs approved | Create execution contract with test plan |
| build-executor | Contract approved | TDD implementation in batches |
| bug-investigator | Tests fail or bugs found | Diagnose, fix, verify |
| code-reviewer | Batch complete | Review code quality and consistency |
| release-archivist | All work done | Verify, archive, close |
| spec-merger | Delta specs need syncing | Merge spec changes back |

</Delegation>
<Workflow_Rules>

## Phase 0 - Intent Gate (EVERY message)

Before acting, classify the user's intent:

| User says | Intent | Your action |
|-----------|--------|-------------|
| "开始一个新功能" / "start a workflow" | Start workflow | Detect current state → route to first unstarted state |
| "帮我看看" / "check status" | Status check | Inspect .sflow/ artifacts → report current state |
| "继续" / "continue" | Continue workflow | Detect current state → route to next subagent |
| "解释这个" / "explain this" | Explanation | Explain current workflow state or artifact |
| General coding question | Out of scope | Remind user you're a workflow orchestrator, suggest using OpenCode's default agent |

## State Detection

Before routing, inspect the project's .sflow/ directory for artifacts:
1. No artifacts → exploring
2. proposal.md exists → specifying (if no execution-contract.md)
3. execution-contract.md exists → approved-for-build (if not yet executed)
4. Code changes exist → executing (or debugging if errors)
5. Verification report exists → closing

## Guardrails

- NEVER implement code yourself — always delegate to build-executor
- NEVER skip states — must progress through the pipeline in order
- NEVER approve your own contracts — user must approve
- NEVER close without verification — release-archivist must verify first
- Block invalid transitions (e.g. executing before contract approved)

</Workflow_Rules>

## Output Format

Always start your response with:
1. **Current State**: [state name]
2. **Detected Intent**: [start-workflow / status / continue / explain]
3. **Next Action**: [which subagent to invoke or what to ask user]

When delegating, use \`call_omo_agent\` with the appropriate \`subagent_type\`.`,
  temperature: 0.6,
  tools: getAgentTools("sflow")
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
  tools: getAgentTools("need-explorer")
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
  tools: getAgentTools("spec-writer")
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
  tools: getAgentTools("contract-builder")
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
  tools: getAgentTools("build-executor")
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
  tools: getAgentTools("bug-investigator")
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
  tools: getAgentTools("code-reviewer")
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
  tools: getAgentTools("release-archivist")
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
  tools: getAgentTools("spec-merger")
});
createSpecMergerAgent.mode = MODE9;
// src/agents/config-loader.ts
import { access, readFile as readFile2 } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// ../shared/src/deep-merge.ts
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
// ../shared/src/file-utils.ts
async function fileExists(path) {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
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
async function writeFile(path, content) {
  try {
    await Bun.write(path, content);
    return true;
  } catch {
    return false;
  }
}
async function listFiles(dirPath, extension) {
  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && (!extension || e.name.endsWith(extension))).map((e) => e.name);
  } catch {
    return [];
  }
}
async function directoryExists(dirPath) {
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
async function readJsonFile(path) {
  const content = await readFile(path);
  if (!content)
    return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function writeJsonFile(path, data) {
  try {
    await Bun.write(path, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}
async function ensureDir(dirPath) {
  try {
    const { mkdir } = await import("fs/promises");
    await mkdir(dirPath, { recursive: true });
  } catch {}
}
// src/agents/config-loader.ts
var USER_CONFIG_FILE = join(homedir(), ".sflow", "config.json");
async function loadSFlowConfig(projectDir) {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, ".sflow", "config.json");
  try {
    await access(configPath);
  } catch {
    return {};
  }
  try {
    const raw = await readFile2(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse ${configPath}`);
    return {};
  }
}
async function loadUserSFlowConfig() {
  try {
    await access(USER_CONFIG_FILE);
  } catch {
    return {};
  }
  try {
    const raw = await readFile2(USER_CONFIG_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse user config: ${USER_CONFIG_FILE}`);
    return {};
  }
}
async function loadCascadedSFlowConfig(projectDir) {
  const user = await loadUserSFlowConfig();
  const project = await loadSFlowConfig(projectDir);
  if (Object.keys(project).length === 0)
    return user;
  return deepMerge(user, project);
}
var BUILTIN_AGENTS = [
  "sflow",
  "need-explorer",
  "spec-writer",
  "contract-builder",
  "build-executor",
  "bug-investigator",
  "code-reviewer",
  "release-archivist",
  "spec-merger"
];
function agentOverridesFromConfig(config) {
  const overrides = {};
  for (const name of BUILTIN_AGENTS) {
    const entry = config.agents?.[name];
    if (!entry)
      continue;
    const override = {};
    if (entry.model)
      override.model = entry.model;
    if (entry.temperature !== undefined)
      override.temperature = entry.temperature;
    const fb = entry.fallback_models || entry.fallbackModels;
    if (fb && fb.length > 0) {
      override.fallback_models = fb;
    }
    if (Object.keys(override).length > 0) {
      overrides[name] = override;
    }
  }
  return overrides;
}
function mergeOverrides(base, higher) {
  if (!higher)
    return { ...base };
  const merged = { ...base };
  for (const [name, cfg] of Object.entries(higher)) {
    merged[name] = { ...base[name] || {}, ...cfg };
  }
  return merged;
}
// src/features/skill-loader.ts
import { readFile as readFile3, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join as join2, dirname, resolve } from "path";
import { fileURLToPath } from "url";

// ../../node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon)
    return common;
  hasRequiredCommon = 1;
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence))
      return sequence;
    else if (isNothing(sequence))
      return [];
    return [sequence];
  }
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length;index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count) {
    let result = "";
    for (let cycle = 0;cycle < count; cycle += 1) {
      result += string;
    }
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  common.isNothing = isNothing;
  common.isObject = isObject;
  common.toArray = toArray;
  common.repeat = repeat;
  common.isNegativeZero = isNegativeZero;
  common.extend = extend;
  return common;
}
var exception;
var hasRequiredException;
function requireException() {
  if (hasRequiredException)
    return exception;
  hasRequiredException = 1;
  function formatError(exception2, compact) {
    let where = "";
    const message = exception2.reason || "(unknown reason)";
    if (!exception2.mark)
      return message;
    if (exception2.mark.name) {
      where += 'in "' + exception2.mark.name + '" ';
    }
    where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
    if (!compact && exception2.mark.snippet) {
      where += `

` + exception2.mark.snippet;
    }
    return message + " " + where;
  }
  function YAMLException2(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  YAMLException2.prototype = Object.create(Error.prototype);
  YAMLException2.prototype.constructor = YAMLException2;
  YAMLException2.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  exception = YAMLException2;
  return exception;
}
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
  if (hasRequiredSnippet)
    return snippet;
  hasRequiredSnippet = 1;
  const common2 = requireCommon();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
      pos: position - lineStart + head.length
    };
  }
  function padStart(string, max) {
    return common2.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer)
      return null;
    if (!options.maxLength)
      options.maxLength = 79;
    if (typeof options.indent !== "number")
      options.indent = 1;
    if (typeof options.linesBefore !== "number")
      options.linesBefore = 3;
    if (typeof options.linesAfter !== "number")
      options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0)
      foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1;i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0)
        break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
      result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + `
` + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
    result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + `^
`;
    for (let i = 1;i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length)
        break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
      result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + `
`;
    }
    return result.replace(/\n$/, "");
  }
  snippet = makeSnippet;
  return snippet;
}
var type;
var hasRequiredType;
function requireType() {
  if (hasRequiredType)
    return type;
  hasRequiredType = 1;
  const YAMLException2 = requireException();
  const TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  const YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) {
      Object.keys(map2).forEach(function(style) {
        map2[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  function Type2(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
        throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  type = Type2;
  return type;
}
var schema;
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema)
    return schema;
  hasRequiredSchema = 1;
  const YAMLException2 = requireException();
  const Type2 = requireType();
  function compileList(schema2, name) {
    const result = [];
    schema2[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type2) {
      if (type2.multi) {
        result.multi[type2.kind].push(type2);
        result.multi["fallback"].push(type2);
      } else {
        result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
      }
    }
    for (let index = 0, length = arguments.length;index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  function Schema2(definition) {
    return this.extend(definition);
  }
  Schema2.prototype.extend = function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type2) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit)
        implicit = implicit.concat(definition.implicit);
      if (definition.explicit)
        explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type2.loadKind && type2.loadKind !== "scalar") {
        throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type2.multi) {
        throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    const result = Object.create(Schema2.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  schema = Schema2;
  return schema;
}
var str;
var hasRequiredStr;
function requireStr() {
  if (hasRequiredStr)
    return str;
  hasRequiredStr = 1;
  const Type2 = requireType();
  str = new Type2("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
  return str;
}
var seq;
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq)
    return seq;
  hasRequiredSeq = 1;
  const Type2 = requireType();
  seq = new Type2("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
  return seq;
}
var map;
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap)
    return map;
  hasRequiredMap = 1;
  const Type2 = requireType();
  map = new Type2("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
  return map;
}
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
  if (hasRequiredFailsafe)
    return failsafe;
  hasRequiredFailsafe = 1;
  const Schema2 = requireSchema();
  failsafe = new Schema2({
    explicit: [
      requireStr(),
      requireSeq(),
      requireMap()
    ]
  });
  return failsafe;
}
var _null;
var hasRequired_null;
function require_null() {
  if (hasRequired_null)
    return _null;
  hasRequired_null = 1;
  const Type2 = requireType();
  function resolveYamlNull(data) {
    if (data === null)
      return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  _null = new Type2("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
  return _null;
}
var bool;
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool)
    return bool;
  hasRequiredBool = 1;
  const Type2 = requireType();
  function resolveYamlBoolean(data) {
    if (data === null)
      return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  bool = new Type2("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
  return bool;
}
var int;
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt)
    return int;
  hasRequiredInt = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null)
      return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max)
      return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max)
        return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (;index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1")
            return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (;index < max; index++) {
          if (!isHexCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (;index < max; index++) {
          if (!isOctCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
    }
    for (;index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits)
      return false;
    return isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-")
        sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0")
      return 0;
    if (ch === "0") {
      if (value[1] === "b")
        return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x")
        return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o")
        return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
  }
  int = new Type2("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  return int;
}
var float;
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat)
    return float;
  hasRequiredFloat = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  const YAML_FLOAT_PATTERN = new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  const YAML_FLOAT_SPECIAL_PATTERN = new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  function resolveYamlFloat(data) {
    if (data === null)
      return false;
    if (!YAML_FLOAT_PATTERN.test(data)) {
      return false;
    }
    if (isFinite(parseFloat(data, 10))) {
      return true;
    }
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common2.isNegativeZero(object)) {
      return "-0.0";
    }
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
  }
  float = new Type2("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  return float;
}
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson)
    return json;
  hasRequiredJson = 1;
  json = requireFailsafe().extend({
    implicit: [
      require_null(),
      requireBool(),
      requireInt(),
      requireFloat()
    ]
  });
  return json;
}
var core;
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore)
    return core;
  hasRequiredCore = 1;
  core = requireJson();
  return core;
}
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp)
    return timestamp;
  hasRequiredTimestamp = 1;
  const Type2 = requireType();
  const YAML_DATE_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
  const YAML_TIMESTAMP_REGEXP = new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
  function resolveYamlTimestamp(data) {
    if (data === null)
      return false;
    if (YAML_DATE_REGEXP.exec(data) !== null)
      return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
      return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null)
      match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null)
      throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 60000;
      if (match[9] === "-")
        delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta)
      date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  timestamp = new Type2("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  return timestamp;
}
var merge;
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge)
    return merge;
  hasRequiredMerge = 1;
  const Type2 = requireType();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  merge = new Type2("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  return merge;
}
var binary;
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary)
    return binary;
  hasRequiredBinary = 1;
  const Type2 = requireType();
  const BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
  function resolveYamlBinary(data) {
    if (data === null)
      return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0;idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64)
        continue;
      if (code < 0)
        return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0;idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map2 = BASE64_MAP;
    for (let idx = 0;idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  binary = new Type2("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  return binary;
}
var omap;
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap)
    return omap;
  hasRequiredOmap = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null)
      return true;
    const objectKeys = [];
    const object = data;
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]")
        return false;
      let pairKey;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey)
            pairHasKey = true;
          else
            return false;
        }
      }
      if (!pairHasKey)
        return false;
      if (objectKeys.indexOf(pairKey) === -1)
        objectKeys.push(pairKey);
      else
        return false;
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  omap = new Type2("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  return omap;
}
var pairs;
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs)
    return pairs;
  hasRequiredPairs = 1;
  const Type2 = requireType();
  const _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null)
      return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]")
        return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1)
        return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null)
      return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  pairs = new Type2("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  return pairs;
}
var set;
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet)
    return set;
  hasRequiredSet = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null)
      return true;
    const object = data;
    for (const key in object) {
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null)
          return false;
      }
    }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  set = new Type2("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  return set;
}
var _default;
var hasRequired_default;
function require_default() {
  if (hasRequired_default)
    return _default;
  hasRequired_default = 1;
  _default = requireCore().extend({
    implicit: [
      requireTimestamp(),
      requireMerge()
    ],
    explicit: [
      requireBinary(),
      requireOmap(),
      requirePairs(),
      requireSet()
    ]
  });
  return _default;
}
var hasRequiredLoader;
function requireLoader() {
  if (hasRequiredLoader)
    return loader;
  hasRequiredLoader = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const makeSnippet = requireSnippet();
  const DEFAULT_SCHEMA2 = require_default();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CONTEXT_FLOW_IN = 1;
  const CONTEXT_FLOW_OUT = 2;
  const CONTEXT_BLOCK_IN = 3;
  const CONTEXT_BLOCK_OUT = 4;
  const CHOMPING_CLIP = 1;
  const CHOMPING_STRIP = 2;
  const CHOMPING_KEEP = 3;
  const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c) {
    return c === 10 || c === 13;
  }
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    const lc = c | 32;
    if (lc >= 97 && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120) {
      return 2;
    }
    if (c === 117) {
      return 4;
    }
    if (c === 85) {
      return 8;
    }
    return 0;
  }
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    return -1;
  }
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\x00";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "\t";
      case 9:
        return "\t";
      case 110:
        return `
`;
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "";
      case 95:
        return " ";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c) {
    if (c <= 65535) {
      return String.fromCharCode(c);
    }
    return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
  }
  function setProperty(object, key, value) {
    if (key === "__proto__") {
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key] = value;
    }
  }
  const simpleEscapeCheck = new Array(256);
  const simpleEscapeMap = new Array(256);
  for (let i = 0;i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.totalMergeKeys = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException2(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name)) {
        transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
      }
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0)
      return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length;index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name)) {
        parent[name] = transaction[name];
      }
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1;index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) {
        state.anchorMap[names[index]] = entry.value;
      } else {
        delete state.anchorMap[names[index]];
      }
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  const directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) {
        for (let _position = 0, _length = _result.length;_position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common2.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
      const key = sourceKeys[index];
      if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
        throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
      }
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length;index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        for (let index = 0, quantity = valueNode.length;index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) {
        return true;
      }
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1) {
      state.result += " ";
    } else if (count > 1) {
      state.result += common2.repeat(`
`, count - 1);
    }
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          break;
        }
      } else if (ch === 35) {
        const preceding = state.input.charCodeAt(state.position - 1);
        if (isWsOrEol(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
        break;
      } else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (;hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (isWhiteSpace(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (isWhiteSpace(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!isEol(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) {
        throwError(state, "missing indentation for block scalar");
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common2.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += `
`;
          }
        }
        break;
      }
      if (folding) {
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common2.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common2.repeat(`
`, emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common2.repeat(`
`, emptyLines);
        }
      } else {
        state.result += common2.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      const following = state.input.charCodeAt(state.position + 1);
      if (!isWsOrEol(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33)
      return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    let _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38)
      return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42)
      return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type2;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) {
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    }
    state.depth += 1;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
          break;
        }
        if (!readTagProperty(state) && !readAnchorProperty(state)) {
          break;
        }
        if (propertyStart === null) {
          propertyStart = propertyState;
        }
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) {
            hasContent = true;
          } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result);
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
        type2 = state.implicitTypes[typeIndex];
        if (type2.resolve(state.result)) {
          state.result = type2.construct(state.result);
          state.tag = type2.tag;
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type2 = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type2 = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type2 = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type2) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type2.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
      }
      if (!type2.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type2.construct(state.result, state.tag);
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch))
          break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0)
        readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    }
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += `
`;
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\x00");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\x00";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  function loadAll2(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (let index = 0, length = documents.length;index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  function load2(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException2("expected a single document in the stream, but found more");
  }
  loader.loadAll = loadAll2;
  loader.load = load2;
  return loader;
}
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
  if (hasRequiredDumper)
    return dumper;
  hasRequiredDumper = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const DEFAULT_SCHEMA2 = require_default();
  const _toString = Object.prototype.toString;
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CHAR_BOM = 65279;
  const CHAR_TAB = 9;
  const CHAR_LINE_FEED = 10;
  const CHAR_CARRIAGE_RETURN = 13;
  const CHAR_SPACE = 32;
  const CHAR_EXCLAMATION = 33;
  const CHAR_DOUBLE_QUOTE = 34;
  const CHAR_SHARP = 35;
  const CHAR_PERCENT = 37;
  const CHAR_AMPERSAND = 38;
  const CHAR_SINGLE_QUOTE = 39;
  const CHAR_ASTERISK = 42;
  const CHAR_COMMA = 44;
  const CHAR_MINUS = 45;
  const CHAR_COLON = 58;
  const CHAR_EQUALS = 61;
  const CHAR_GREATER_THAN = 62;
  const CHAR_QUESTION = 63;
  const CHAR_COMMERCIAL_AT = 64;
  const CHAR_LEFT_SQUARE_BRACKET = 91;
  const CHAR_RIGHT_SQUARE_BRACKET = 93;
  const CHAR_GRAVE_ACCENT = 96;
  const CHAR_LEFT_CURLY_BRACKET = 123;
  const CHAR_VERTICAL_LINE = 124;
  const CHAR_RIGHT_CURLY_BRACKET = 125;
  const ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = "\\\"";
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  const DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema2, map2) {
    if (map2 === null)
      return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length;index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      const type2 = schema2.compiledTypeMap["fallback"][tag];
      if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
        style = type2.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common2.repeat("0", length - string.length) + string;
  }
  const QUOTING_TYPE_SINGLE = 1;
  const QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    const ind = common2.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf(`
`, position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== `
`)
        result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return `
` + common2.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str2) {
    for (let index = 0, length = state.implicitTypes.length;index < length; index += 1) {
      const type2 = state.implicitTypes[index];
      if (type2.resolve(str2)) {
        return true;
      }
    }
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  function needIndentIndicator(string) {
    const leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  const STYLE_PLAIN = 1;
  const STYLE_SINGLE = 2;
  const STYLE_LITERAL = 3;
  const STYLE_FOLDED = 4;
  const STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string) + '"';
        default:
          throw new YAMLException2("impossible error: invalid scalar style");
      }
    }();
  }
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === `
`;
    const keep = clip && (string[string.length - 2] === `
` || string === `
`);
    const chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + `
`;
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = function() {
      let nextLF = string.indexOf(`
`);
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    }();
    let prevMoreIndented = string[0] === `
` || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ")
      return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += `
` + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += `
`;
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + `
` + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536)
          result += string[i + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length;index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "")
          _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length;index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length;index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "")
        pairBuffer += ", ";
      if (state.condenseFlow)
        pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024)
        pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException2("sortKeys must be a boolean or a function");
    }
    for (let index = 0, length = objectKeyList.length;index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length;index < length; index += 1) {
      const type2 = typeList[index];
      if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
        if (explicit) {
          if (type2.multi && type2.representName) {
            state.tag = type2.representName(object);
          } else {
            state.tag = type2.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type2.represent) {
          const style = state.styleMap[type2.tag] || type2.defaultStyle;
          let _result;
          if (_toString.call(type2.represent) === "[object Function]") {
            _result = type2.represent(object, style);
          } else if (_hasOwnProperty.call(type2.represent, style)) {
            _result = type2.represent[style](object, style);
          } else {
            throw new YAMLException2("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    const type2 = _toString.call(state.dump);
    const inblock = block;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type2 === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type2 === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid)
          return false;
        throw new YAMLException2("unacceptable kind of an object to dump " + type2);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0;index < length; index += 1) {
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects.push(object);
        if (Array.isArray(object)) {
          for (let i = 0, length = object.length;i < length; i += 1) {
            inspectNode(object[i], objects, duplicatesIndexes);
          }
        } else {
          const objectKeyList = Object.keys(object);
          for (let i = 0, length = objectKeyList.length;i < length; i += 1) {
            inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
          }
        }
      }
    }
  }
  function dump2(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs)
      getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true))
      return state.dump + `
`;
    return "";
  }
  dumper.dump = dump2;
  return dumper;
}
var hasRequiredJsYaml;
function requireJsYaml() {
  if (hasRequiredJsYaml)
    return jsYaml;
  hasRequiredJsYaml = 1;
  const loader2 = requireLoader();
  const dumper2 = requireDumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  jsYaml.Type = requireType();
  jsYaml.Schema = requireSchema();
  jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
  jsYaml.JSON_SCHEMA = requireJson();
  jsYaml.CORE_SCHEMA = requireCore();
  jsYaml.DEFAULT_SCHEMA = require_default();
  jsYaml.load = loader2.load;
  jsYaml.loadAll = loader2.loadAll;
  jsYaml.dump = dumper2.dump;
  jsYaml.YAMLException = requireException();
  jsYaml.types = {
    binary: requireBinary(),
    float: requireFloat(),
    map: requireMap(),
    null: require_null(),
    pairs: requirePairs(),
    set: requireSet(),
    timestamp: requireTimestamp(),
    bool: requireBool(),
    int: requireInt(),
    merge: requireMerge(),
    omap: requireOmap(),
    seq: requireSeq(),
    str: requireStr()
  };
  jsYaml.safeLoad = renamed("safeLoad", "load");
  jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
  jsYaml.safeDump = renamed("safeDump", "dump");
  return jsYaml;
}
var jsYamlExports = requireJsYaml();
var yaml = /* @__PURE__ */ getDefaultExportFromCjs(jsYamlExports);
var {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
} = yaml;

// src/features/skill-loader.ts
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = dirname(__filename2);
function resolveSkillsDir(givenDir) {
  if (givenDir)
    return givenDir;
  let current = resolve(__dirname2, "..");
  for (let i = 0;i < 10; i++) {
    const skillsPath = join2(current, "skills");
    if (existsSync(skillsPath)) {
      return skillsPath;
    }
    current = resolve(current, "..");
  }
  return join2(__dirname2, "..", "..", "..", "..", "skills");
}

class SkillLoader {
  skills = new Map;
  skillsDir;
  constructor(skillsDir) {
    this.skillsDir = resolveSkillsDir(skillsDir);
  }
  async loadAllSkills() {
    const skills = [];
    if (!existsSync(this.skillsDir)) {
      console.warn(`Skills directory not found: ${this.skillsDir}`);
      return skills;
    }
    try {
      const entries = await readdir(this.skillsDir);
      const loadPromises = entries.filter((entry) => entry !== ".gitkeep").map(async (entry) => {
        const skillPath = join2(this.skillsDir, entry);
        try {
          const entryStat = await stat(skillPath);
          if (entryStat.isDirectory()) {
            return this.loadSkill(entry);
          }
        } catch {
          return null;
        }
      });
      const results = await Promise.all(loadPromises);
      for (const skill of results) {
        if (skill) {
          skills.push(skill);
          this.skills.set(skill.name || "unknown", skill);
        }
      }
    } catch (error) {
      console.error(`Error loading skills from ${this.skillsDir}:`, error);
    }
    return skills;
  }
  async loadSkill(name) {
    const skillDir = join2(this.skillsDir, name);
    const skillFile = join2(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) {
      console.warn(`Skill file not found: ${skillFile}`);
      return null;
    }
    try {
      const content = await readFile3(skillFile, "utf-8");
      const metadata = this.parseMetadata(content);
      const skill = {
        metadata,
        content,
        path: skillFile
      };
      this.skills.set(name, skill);
      return skill;
    } catch (error) {
      console.error(`Error loading skill ${name}:`, error);
      return null;
    }
  }
  getSkill(name) {
    return this.skills.get(name);
  }
  getAllSkills() {
    return Array.from(this.skills.values());
  }
  getSkillNames() {
    return Array.from(this.skills.keys());
  }
  hasSkill(name) {
    return this.skills.has(name);
  }
  parseMetadata(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return {
        name: "unknown",
        description: ""
      };
    }
    const frontmatter = frontmatterMatch[1];
    const metadata = {
      name: "",
      description: ""
    };
    try {
      const parsed = load(frontmatter);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.name === "string")
          metadata.name = parsed.name;
        if (typeof parsed.description === "string")
          metadata.description = parsed.description;
        if (typeof parsed.version === "string")
          metadata.version = parsed.version;
        if (typeof parsed.author === "string")
          metadata.author = parsed.author;
        if (Array.isArray(parsed.tags)) {
          metadata.tags = parsed.tags.map((t) => String(t).trim()).filter(Boolean);
        } else if (typeof parsed.tags === "string") {
          metadata.tags = parsed.tags.split(",").map((t) => t.trim()).filter(Boolean);
        }
        if (parsed.mcp && typeof parsed.mcp === "object") {
          metadata.mcp = parsed.mcp;
        }
      }
    } catch {
      const lines = frontmatter.split(`
`);
      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          switch (key) {
            case "name":
              if (!metadata.name)
                metadata.name = value;
              break;
            case "description":
              if (!metadata.description)
                metadata.description = value;
              break;
            case "version":
              if (!metadata.version)
                metadata.version = value;
              break;
            case "author":
              if (!metadata.author)
                metadata.author = value;
              break;
            case "tags":
              if (!metadata.tags)
                metadata.tags = value.split(",").map((t) => t.trim());
              break;
          }
        }
      }
    }
    return metadata;
  }
  getSkillContent(name) {
    const skill = this.getSkill(name);
    if (!skill) {
      return null;
    }
    return skill.content.replace(/^---\n[\s\S]*?\n---\n/, "");
  }
  getSkillsWithMcp() {
    return this.getAllSkills().filter((skill) => skill.metadata.mcp);
  }
  getSkillMcpServers(name) {
    const skill = this.getSkill(name);
    if (!skill?.metadata.mcp?.servers) {
      return [];
    }
    return skill.metadata.mcp.servers;
  }
}
function getSkillContentWithoutFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "");
}

// src/agents/agent-builder.ts
import { access as access2, readFile as readFile4 } from "fs/promises";
import { join as join3, resolve as resolve2, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { existsSync as existsSync2 } from "fs";
var __filename3 = fileURLToPath2(import.meta.url);
var __dirname3 = dirname2(__filename3);
var PACKAGE_ROOT = resolvePackageRoot();
function resolvePackageRoot() {
  let current = resolve2(__dirname3, "..");
  for (let i = 0;i < 10; i++) {
    if (existsSync2(join3(current, "package.json"))) {
      return current;
    }
    current = resolve2(current, "..");
  }
  return resolve2(__dirname3, "..", "..", "..", "..");
}
async function loadSkillInstructions(name) {
  const skillFile = join3(PACKAGE_ROOT, "skills", name, "SKILL.md");
  try {
    await access2(skillFile);
    const content = await readFile4(skillFile, "utf-8");
    return getSkillContentWithoutFrontmatter(content);
  } catch {
    return null;
  }
}
var _cascadedConfigCache = null;
async function getCascadedConfig() {
  if (!_cascadedConfigCache) {
    _cascadedConfigCache = await loadCascadedSFlowConfig();
  }
  return _cascadedConfigCache;
}
var AGENT_REGISTRY = {
  sflow: createSFlowAgent,
  "need-explorer": createNeedExplorerAgent,
  "spec-writer": createSpecWriterAgent,
  "contract-builder": createContractBuilderAgent,
  "build-executor": createBuildExecutorAgent,
  "bug-investigator": createBugInvestigatorAgent,
  "code-reviewer": createCodeReviewerAgent,
  "release-archivist": createReleaseArchivistAgent,
  "spec-merger": createSpecMergerAgent
};
var DEFAULT_MODELS = {
  sflow: "deepseek-v4-flash",
  "need-explorer": "kimi-k2.6",
  "spec-writer": "glm-5.1",
  "contract-builder": "glm-5",
  "build-executor": "step-3.7-flash",
  "bug-investigator": "minimax-m2.7",
  "code-reviewer": "deepseek-v4-flash",
  "release-archivist": "mimo-v2.5-pro",
  "spec-merger": "mimo-v2.5"
};
async function createAgent(name, model, overrides) {
  const factory = AGENT_REGISTRY[name];
  if (!factory) {
    throw new Error(`Unknown agent: ${name}`);
  }
  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);
  const merged = mergeOverrides(configOverrides, overrides || {});
  const agentOverride = merged[name];
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides[name]?.model;
  const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];
  const agentConfig = factory(resolvedModel);
  const skillContent = await loadSkillInstructions(name);
  if (skillContent) {
    agentConfig.instructions = skillContent;
  }
  if (agentOverride) {
    return {
      ...agentConfig,
      ...agentOverride,
      model: resolvedModel,
      id: agentConfig.id,
      name: agentConfig.name
    };
  }
  return agentConfig;
}
function getAgentNames() {
  return Object.keys(AGENT_REGISTRY);
}
function getAgentMode(name) {
  const factory = AGENT_REGISTRY[name];
  return factory?.mode || "subagent";
}
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
async function isContractApproved(changeDir) {
  const state = await readJsonFile(`${changeDir}/.sflow/state.json`);
  if (state?.contractApproved === true)
    return true;
  if (state?.state === "approved-for-build" || state?.state === "executing" || state?.state === "closing")
    return true;
  return false;
}
async function isContractStale(changeDir) {
  const contractPath = `${changeDir}/execution-contract.md`;
  const proposalPath = `${changeDir}/proposal.md`;
  const contractExists = await fileExists(contractPath);
  const proposalExists = await fileExists(proposalPath);
  if (!contractExists || !proposalExists)
    return false;
  try {
    const contractMod = Bun.file(contractPath).lastModified;
    const proposalMod = Bun.file(proposalPath).lastModified;
    return proposalMod > contractMod;
  } catch {
    return false;
  }
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
          const proposalContent = await readFile(`${changeDir}/proposal.md`);
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
            const specContent = await readFile(`${specsDir}/${specFile}`);
            if (specContent) {
              results.specs[specFile] = validator.validateSpec(specContent, specFile.replace(".md", ""));
            }
          }
        }
        if (!artifactType || artifactType === "design") {
          const designContent = await readFile(`${changeDir}/design.md`);
          if (designContent) {
            results.design = { valid: true, message: "Design file exists" };
          } else {
            results.design = { valid: false, error: "File not found" };
          }
        }
        if (!artifactType || artifactType === "tasks") {
          const tasksContent = await readFile(`${changeDir}/tasks.md`);
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
import { readFile as readFile5, writeFile as writeFile2, rename } from "fs/promises";
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
        if (!isValidTransition(currentState, newState)) {
          const valid = getValidTransitions(currentState);
          return {
            success: false,
            error: `Invalid transition from ${currentState} to ${newState}`,
            block: true,
            blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${valid.join(", ")}`
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
var STATE_FILE_PATH = ".sflow/state.json";
async function readStateFile(changeDir) {
  if (!changeDir)
    return null;
  try {
    const content = await readFile5(`${changeDir}/${STATE_FILE_PATH}`, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function atomicWriteStateFile(changeDir, state) {
  const target = `${changeDir}/${STATE_FILE_PATH}`;
  const tmp = `${target}.tmp.${Date.now()}`;
  await writeFile2(tmp, JSON.stringify(state, null, 2), "utf-8");
  await rename(tmp, target);
}
async function getCurrentState(changeDir) {
  const state = await readStateFile(changeDir);
  if (state) {
    return state.state || state.currentState || "exploring";
  }
  return null;
}
async function updateState(changeDir, newState) {
  const now = new Date().toISOString();
  let state = {};
  const existing = await readStateFile(changeDir);
  if (existing) {
    state = existing;
  } else {
    state = { mode: "full", createdAt: now, timestamps: { createdAt: now, updatedAt: now } };
    await ensureDir(`${changeDir}/.sflow`);
  }
  state.state = newState;
  state.updatedAt = now;
  if (!state.timestamps)
    state.timestamps = {};
  state.timestamps.lastTransition = now;
  state.timestamps.updatedAt = now;
  await atomicWriteStateFile(changeDir, state);
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
  const proposalContent = await readFile(`${changeDir}/proposal.md`);
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
  const specFiles = await listFiles(specsDir);
  if (specFiles.length === 0) {
    return {
      success: false,
      error: "No spec files found",
      block: true,
      blockReason: "Cannot enter bridging state without specs"
    };
  }
  for (const specFile of specFiles) {
    const specContent = await readFile(`${specsDir}/${specFile}`);
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
  const contractContent = await readFile(`${changeDir}/execution-contract.md`);
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
  const tasksContent = await readFile(`${changeDir}/tasks.md`);
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
// src/hooks/guard.ts
import { stat as stat2 } from "fs/promises";
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
  const dirExists = await fileExists(changeDir);
  if (!dirExists)
    return { success: true };
  const stateData = await readJsonFile(`${changeDir}/.sflow/state.json`);
  const currentState = stateData?.state || "exploring";
  const artifactByState = {
    exploring: [],
    specifying: ["proposal.md"],
    bridging: ["proposal.md", "specs", "design.md", "tasks.md"],
    "approved-for-build": ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    executing: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    debugging: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    closing: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    abandoned: []
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
      blockReason: `Missing required artifacts: ${missingArtifacts.join(", ")}`
    };
  }
  return { success: true };
}
async function checkContractStaleness2(changeDir) {
  if (!changeDir)
    return { success: true };
  const contractPath = `${changeDir}/execution-contract.md`;
  const proposalPath = `${changeDir}/proposal.md`;
  const contractExists = await fileExists(contractPath);
  const proposalExists = await fileExists(proposalPath);
  if (!contractExists || !proposalExists)
    return { success: true };
  try {
    const contractStats = await stat2(contractPath);
    const proposalStats = await stat2(proposalPath);
    const contractModTime = contractStats.mtimeMs;
    const proposalModTime = proposalStats.mtimeMs;
    if (proposalModTime > contractModTime) {
      return {
        success: false,
        block: true,
        blockReason: "Contract is stale: proposal.md was modified after execution-contract.md was created"
      };
    }
  } catch {
    return { success: true };
  }
  return { success: true };
}
async function checkTaskCompletion(changeDir) {
  if (!changeDir)
    return { success: true };
  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent)
    return { success: true };
  const taskLines = tasksContent.split(`
`).filter((line) => line.match(/^-\s*\[.\]\s+/));
  if (taskLines.length === 0)
    return { success: true };
  const incompleteTasks = taskLines.filter((line) => line.match(/^-\s*\[\s\]/));
  if (incompleteTasks.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `${incompleteTasks.length} task(s) are incomplete. Complete all tasks before closing.`
    };
  }
  return { success: true };
}
async function checkDebuggingState(changeDir) {
  if (!changeDir)
    return { success: true };
  const stateData = await readJsonFile(`${changeDir}/.sflow/state.json`);
  if (stateData?.state === "debugging") {
    return {
      success: false,
      block: true,
      blockReason: "Workflow is in debugging state. Fix the bug and transition back to executing before continuing."
    };
  }
  return { success: true };
}
// src/hooks/session.ts
function createSessionStartHook() {
  return {
    name: "session_start",
    description: "Called when a workflow session starts",
    execute: async (context) => {
      return { success: true, data: { message: "Session started" } };
    }
  };
}
function createSessionEndHook() {
  return {
    name: "session_end",
    description: "Called when a workflow session ends",
    execute: async (context) => {
      return { success: true, data: { message: "Session ended" } };
    }
  };
}
// src/hooks/transform.ts
function createPreProcessHook() {
  return {
    name: "pre_process",
    description: "Transform user messages before agent processing",
    execute: async (context) => {
      return { success: true, data: { transformed: false } };
    }
  };
}
function createPostProcessHook() {
  return {
    name: "post_process",
    description: "Transform agent responses before returning to user",
    execute: async (context) => {
      return { success: true, data: { transformed: false } };
    }
  };
}
// src/hooks/continuation.ts
function createContinuationHook() {
  return {
    name: "continuation",
    description: "Check if workflow should auto-continue to next state",
    execute: async (context) => {
      return {
        success: true,
        data: { shouldContinue: false, reason: "No continuation requested" }
      };
    }
  };
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
    async transitionState(changeDir, newState) {
      try {
        const currentState = await readStateFile2(changeDir);
        if (!isValidTransition(currentState.state, newState)) {
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
var STATE_FILE = ".sflow/state.json";
async function createChangeDirectory(changeDir) {
  const stateDir = `${changeDir}/.sflow`;
  await ensureDir(stateDir);
  await writeJsonFile(`${changeDir}/${STATE_FILE}`, {
    state: "exploring",
    mode: "full",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}
async function initializeStateFile(changeDir) {
  const stateFile = `${changeDir}/${STATE_FILE}`;
  const existing = await readJsonFile(stateFile);
  if (!existing) {
    await ensureDir(`${changeDir}/.sflow`);
    await writeJsonFile(stateFile, {
      state: "exploring",
      mode: "full",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}
async function readStateFile2(changeDir) {
  const state = await readJsonFile(`${changeDir}/${STATE_FILE}`);
  return state || { state: "exploring", mode: "full", updatedAt: new Date().toISOString() };
}
async function updateStateFile(changeDir, state) {
  await writeJsonFile(`${changeDir}/${STATE_FILE}`, state);
}
async function archiveChange(changeDir) {
  const archiveDir = `${changeDir}/.sflow/archive`;
  await ensureDir(archiveDir);
  await Bun.write(`${archiveDir}/archived-at.txt`, new Date().toISOString());
}
// src/features/state-manager.ts
function createStateManager(config = { enabled: true }, workflowManager) {
  const wf = workflowManager || createWorkflowManager(config);
  return {
    name: "state_manager",
    config,
    getWorkflowManager: () => wf,
    async initialize() {
      if (!config.enabled) {
        return { success: true, data: { message: "State manager disabled" } };
      }
      console.log("State manager initialized");
      return { success: true };
    },
    async getState(changeDir) {
      try {
        return await wf.getState(changeDir);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },
    async updateState(changeDir, updates) {
      try {
        return await wf.transitionState(changeDir, updates.state || "exploring");
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
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
          data: { approved: state.data?.contractApproved || false }
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
        const current = await wf.getState(changeDir);
        if (!current.success)
          return current;
        const result = await wf.transitionState(changeDir, "approved-for-build");
        return {
          success: result.success,
          data: { approved: true, timestamp: new Date().toISOString() }
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
        return { success: true, data: { stale: false } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
// src/features/builtin-mcp.ts
function createValidatorMcpServer() {
  const validator = new Validator;
  return {
    name: "spec-validator",
    description: "Validate spec artifacts (proposals, specs, contracts)",
    async call(method, params) {
      switch (method) {
        case "validate-proposal": {
          const content = params.content;
          if (!content)
            return { success: false, error: "Missing content parameter" };
          return { success: true, data: validator.validateProposal(content) };
        }
        case "validate-spec": {
          const content = params.content;
          if (!content)
            return { success: false, error: "Missing content parameter" };
          return { success: true, data: validator.validateSpec(content) };
        }
        case "validate-delta-spec": {
          const content = params.content;
          if (!content)
            return { success: false, error: "Missing content parameter" };
          return { success: true, data: validator.validateDeltaSpec(content) };
        }
        case "validate-tasks": {
          const content = params.content;
          if (!content)
            return { success: false, error: "Missing content parameter" };
          return { success: true, data: validator.validateTasks(content) };
        }
        case "validate-contract": {
          const content = params.content;
          if (!content)
            return { success: false, error: "Missing content parameter" };
          return { success: true, data: validator.validateExecutionContract(content) };
        }
        default:
          return { success: false, error: `Unknown method: ${method}` };
      }
    }
  };
}

class BuiltinMcpRegistry {
  servers = new Map;
  constructor() {
    const validatorMcp = createValidatorMcpServer();
    this.servers.set(validatorMcp.name, validatorMcp);
  }
  get(name) {
    return this.servers.get(name);
  }
  register(server) {
    this.servers.set(server.name, server);
  }
  getAll() {
    return Array.from(this.servers.values());
  }
  call(name, method, params) {
    const server = this.servers.get(name);
    if (!server)
      return { success: false, error: `Built-in MCP server not found: ${name}` };
    return server.call(method, params);
  }
}
// src/tools/tool-registry.ts
var TOOL_REGISTRY = {
  workflow_router: createWorkflowRouterTool,
  contract_validator: createContractValidatorTool,
  artifact_inspector: createArtifactInspectorTool
};

class ToolRegistry {
  tools = new Map;
  disabledTools = new Set;
  initialize() {
    for (const [name, factory] of Object.entries(TOOL_REGISTRY)) {
      const tool = factory();
      this.tools.set(name, tool);
    }
  }
  getTool(name) {
    if (this.disabledTools.has(name)) {
      return;
    }
    return this.tools.get(name);
  }
  async executeTool(name, params, context) {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found or disabled: ${name}`
      };
    }
    try {
      return await tool.execute(params, context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  disableTool(name) {
    this.disabledTools.add(name);
  }
  enableTool(name) {
    this.disabledTools.delete(name);
  }
  isToolEnabled(name) {
    if (!this.tools.has(name))
      return false;
    return !this.disabledTools.has(name);
  }
  getEnabledTools() {
    return Array.from(this.tools.keys()).filter((name) => !this.disabledTools.has(name));
  }
  getDisabledTools() {
    return Array.from(this.disabledTools);
  }
  getToolCount() {
    return {
      total: this.tools.size,
      enabled: this.getEnabledTools().length,
      disabled: this.getDisabledTools().length
    };
  }
}
function createToolRegistry() {
  const registry = new ToolRegistry;
  registry.initialize();
  return registry;
}

// src/hooks/hook-composer.ts
var HOOK_REGISTRY = {
  state_transition: createStateTransitionHook,
  artifact_validation: createArtifactValidationHook,
  guard: createGuardHook,
  session_start: createSessionStartHook,
  session_end: createSessionEndHook,
  pre_process: createPreProcessHook,
  post_process: createPostProcessHook,
  continuation: createContinuationHook
};

class HookComposer {
  hooks = new Map;
  disabledHooks = new Set;
  hookOrder = [];
  initialize() {
    this.hookOrder = ["session_start", "pre_process", "guard", "artifact_validation", "state_transition", "post_process", "session_end", "continuation"];
    for (const name of this.hookOrder) {
      const factory = HOOK_REGISTRY[name];
      if (factory) {
        const hook = factory();
        this.hooks.set(name, hook);
      }
    }
  }
  getHook(name) {
    if (this.disabledHooks.has(name)) {
      return;
    }
    return this.hooks.get(name);
  }
  async executeHook(name, context) {
    if (!this.hooks.has(name)) {
      return {
        success: false,
        error: `Unknown hook: ${name}`
      };
    }
    const hook = this.getHook(name);
    if (!hook) {
      return {
        success: true,
        data: { message: `Hook disabled: ${name}` }
      };
    }
    try {
      return await hook.execute(context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async executeAllHooks(context) {
    const results = {};
    let allSuccess = true;
    for (const name of this.hookOrder) {
      if (this.disabledHooks.has(name))
        continue;
      const result = await this.executeHook(name, context);
      results[name] = result;
      if (!result.success) {
        allSuccess = false;
        if (result.block) {
          break;
        }
      }
    }
    return {
      success: allSuccess,
      results
    };
  }
  disableHook(name) {
    this.disabledHooks.add(name);
  }
  enableHook(name) {
    this.disabledHooks.delete(name);
  }
  isHookEnabled(name) {
    if (!this.hooks.has(name))
      return false;
    return !this.disabledHooks.has(name);
  }
  getEnabledHooks() {
    return this.hookOrder.filter((name) => !this.disabledHooks.has(name));
  }
  getDisabledHooks() {
    return Array.from(this.disabledHooks);
  }
  getHookCount() {
    return {
      total: this.hooks.size,
      enabled: this.getEnabledHooks().length,
      disabled: this.getDisabledHooks().length
    };
  }
  addHook(name, hook, position) {
    this.hooks.set(name, hook);
    if (position !== undefined && position >= 0 && position <= this.hookOrder.length) {
      this.hookOrder.splice(position, 0, name);
    } else {
      this.hookOrder.push(name);
    }
  }
  removeHook(name) {
    this.hooks.delete(name);
    this.hookOrder = this.hookOrder.filter((n) => n !== name);
    this.disabledHooks.delete(name);
  }
}
function createHookComposer() {
  const composer = new HookComposer;
  composer.initialize();
  return composer;
}

// src/index.ts
var PLUGIN_ID = "opencode-sflow";
var PLUGIN_VERSION = "0.1.0";
async function sflowPlugin(input, _options) {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);
  console.log(`[sFlow] Initializing in ${input.directory}`);
  const toolRegistry = createToolRegistry();
  const hookComposer = createHookComposer();
  return {
    dispose: async () => {
      console.log("[sFlow] Plugin disposed");
    },
    config: async (cfg) => {
      cfg.agent = cfg.agent || {};
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const agentCfg = await createAgent(name);
        cfg.agent[name] = {
          model: agentCfg.model,
          mode: getAgentMode(name),
          prompt: agentCfg.instructions,
          ...override?.temperature ? { temperature: override.temperature } : {}
        };
      }
    },
    tool: {
      workflow_router: {
        description: "Detect current workflow state and route to the appropriate agent",
        args: {
          state: { type: "string", description: "Target workflow state to transition to" }
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool("workflow_router");
          if (!tool)
            return { title: "Error", output: "Tool not found" };
          const result = await tool.execute(args, {
            changeDir: context.directory || "",
            stateFile: `${context.directory || ""}/.sflow/state.json`,
            pluginRoot: ""
          });
          return { title: "Workflow Router", output: JSON.stringify(result.data || result.error) };
        }
      },
      contract_validator: {
        description: "Validate execution contract for correctness and completeness",
        args: {
          contract_path: { type: "string", description: "Path to the contract file" }
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool("contract_validator");
          if (!tool)
            return { title: "Error", output: "Tool not found" };
          const result = await tool.execute(args, {
            changeDir: context.directory || "",
            stateFile: "",
            pluginRoot: ""
          });
          return { title: "Contract Validator", output: JSON.stringify(result.data || result.error) };
        }
      },
      artifact_inspector: {
        description: "Inspect planning artifacts for completeness and consistency",
        args: {
          artifact_path: { type: "string", description: "Path to the artifact file" }
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool("artifact_inspector");
          if (!tool)
            return { title: "Error", output: "Tool not found" };
          const result = await tool.execute(args, {
            changeDir: context.directory || "",
            stateFile: "",
            pluginRoot: ""
          });
          return { title: "Artifact Inspector", output: JSON.stringify(result.data || result.error) };
        }
      }
    }
  };
}
var sflowPluginModule = {
  id: PLUGIN_ID,
  server: sflowPlugin
};
var src_default = sflowPluginModule;
export {
  writeFile,
  readFile,
  listFiles,
  fileExists,
  src_default as default,
  deepMerge,
  createWorkflowRouterTool,
  createWorkflowManager,
  createValidatorMcpServer,
  createStateTransitionHook,
  createStateManager,
  createSpecWriterAgent,
  createSpecMergerAgent,
  createSessionStartHook,
  createSessionEndHook,
  createSFlowAgent,
  createReleaseArchivistAgent,
  createPreProcessHook,
  createPostProcessHook,
  createNeedExplorerAgent,
  createGuardHook,
  createContractValidatorTool,
  createContractBuilderAgent,
  createContinuationHook,
  createCodeReviewerAgent,
  createBuildExecutorAgent,
  createBugInvestigatorAgent,
  createArtifactValidationHook,
  createArtifactInspectorTool,
  Validator,
  PLUGIN_VERSION,
  PLUGIN_ID,
  BuiltinMcpRegistry
};
