# UI Design Generation (Frontend Projects)

When the project is detected as frontend and ui-design.md does not exist, generate it automatically after design.md and tasks.md are complete.

## Prerequisites Check

Before generating ui-design.md, verify:
1. proposal.md exists with UI-related requirements
2. specs/ has at least one spec file describing UI behavior
3. design.md has architecture decisions (component structure, layout approach)
4. tasks.md references UI components in task descriptions

## Generation Process

1. Read existing artifacts and extract UI-relevant information:
   - From specs/: UI requirements, user flows, interaction scenarios
   - From design.md: component hierarchy, layout strategy, state management
   - From tasks.md: component implementation tasks

2. Generate ui-design.md with the following structure:

   ```markdown
   # UI Design: [Change Name]

   ## Design System
   - Color palette
   - Typography (headings, body, code)
   - Spacing system
   - Component variants and states

   ## Component Hierarchy
   [Component tree based on specs and design.md]

   ## Interaction Patterns
   [User flows and UX interactions]

   ## Responsive Breakpoints
   [If applicable]

   ## Accessibility Guidelines
   [WCAG compliance requirements]

   ## Implementation Notes
   [Specific implementation guidance for developers]
   ```

3. Validate the generated ui-design.md:
   - Check it references all UI-related specs
   - Check it aligns with architecture decisions in design.md
   - Check it is referenced by tasks in tasks.md

4. Record DP-2-ui after user approval

5. Transition to bridging: After ui-design.md is approved, run the state transition:
   - Update .flow-engine/sflow/state.json: set state to ui-design
   - The Artifact Preflight Gate will verify all prerequisites
   - Route to contract-builder for execution contract generation

## What If UI Design Is Not Needed

If the frontend change has no UI impact (e.g., API integration, utility function, config change):
- Set .flow-engine/sflow/state.json state explicitly to skip ui-design
- Route directly to bridging
- The Artifact Preflight Gate will respect this override
