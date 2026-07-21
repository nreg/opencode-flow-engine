/**
 * SFlow workflow - Agent factory exports
 * OpenSpec planning engine + Superpowers execution discipline
 */
export { createSFlowAgent } from './agents/spec-flow.js';
export { createNeedExplorerAgent } from './agents/need-explorer.js';
export { createSpecWriterAgent } from './agents/spec-writer.js';
export { createContractBuilderAgent } from './agents/contract-builder.js';
export { createBuildExecutorAgent } from './agents/build-executor.js';
export { createBugInvestigatorAgent } from './agents/bug-investigator.js';
export { createCodeReviewerAgent } from './agents/code-reviewer.js';
export { createReleaseArchivistAgent } from './agents/release-archivist.js';
export { createSpecMergerAgent } from './agents/spec-merger.js';
export { createUiDirectorAgent } from './agents/ui-director.js';
export { createUiImplementerAgent } from './agents/ui-implementer.js';
/** SFlow agent names for registration */
export declare const SFLOW_AGENT_NAMES: readonly ["sFlow", "need-explorer", "spec-writer", "contract-builder", "build-executor", "bug-investigator", "code-reviewer", "release-archivist", "spec-merger", "ui-director", "ui-implementer"];
/** SFlow workflow directory name */
export declare const SFLOW_DIR = ".flow-engine/sflow";
