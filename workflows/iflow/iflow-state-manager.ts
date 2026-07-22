/**
 * IFlow State Manager - State persistence engine for IFlow workflow
 *
 * Manages state.json read/write and checkpoint lifecycle for the
 * GSD-style cyclic workflow: discussing → researching → planning →
 * executing → verifying → shipping
 *
 * All file mutations are serialized through stateFileMutex to prevent
 * concurrent write corruption within a single OpenCode process.
 */

import {
  stateFileMutex,
  ensureDir,
  writeJsonFile,
  readJsonFile,
  fileExists,
} from '../../packages/shared/src/index.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** IFlow state directory relative to workDir */
const IFLOW_DIR = '.flow-engine/iflow';

/** Checkpoint sub-directory relative to IFLOW_DIR */
const CHECKPOINT_DIR = 'checkpoints';

/** Maximum length for summary fields (characters) */
const MAX_SUMMARY_LENGTH = 200;

// ─── Type Definitions ───────────────────────────────────────────────────────

/** Valid IFlow workflow states */
export type IFlowStateName =
  | 'discussing'
  | 'researching'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'shipping';

/** IFlow state.json schema */
export interface IFlowStateFile {
  /** Current workflow state */
  state: IFlowStateName;
  /** Current iteration cycle number (1-based) */
  cycleNumber: number;
  /** ISO 8601 timestamp when current state was entered */
  enteredAt: string;
  /** Artifact file paths produced in the current cycle */
  artifactPaths: string[];
  /** Decision log entries */
  decisionLog: IFlowDecisionLogEntry[];
}

/** A single decision log entry */
export interface IFlowDecisionLogEntry {
  /** Decision point identifier (e.g. "dp-1") */
  dp: string;
  /** Decision content summary */
  decision: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/** IFlow checkpoint file schema */
export interface IFlowCheckpointFile {
  /** Sub-agent task ID */
  taskId: string;
  /** Workflow state at checkpoint time */
  state: IFlowStateName;
  /** Cycle number at checkpoint time */
  cycleNumber: number;
  /** Sub-agent type (e.g. "iflow-plan-executor") */
  subagentType: string;
  /** Input summary (truncated to 200 chars) */
  inputSummary: string;
  /** Output summary (truncated to 200 chars) */
  outputSummary: string;
  /** ISO 8601 start timestamp */
  startedAt: string;
  /** ISO 8601 completion timestamp */
  completedAt: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Execution status */
  status: 'running' | 'completed' | 'failed';
}

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Resolve the absolute path to state.json for a given workDir.
 */
function stateFilePath(workDir: string): string {
  return `${workDir}/${IFLOW_DIR}/state.json`;
}

/**
 * Resolve the absolute path to the checkpoints directory for a given workDir.
 */
function checkpointsDirPath(workDir: string): string {
  return `${workDir}/${IFLOW_DIR}/${CHECKPOINT_DIR}`;
}

/**
 * Resolve the absolute path to a specific checkpoint file.
 */
function checkpointFilePath(workDir: string, taskId: string): string {
  return `${checkpointsDirPath(workDir)}/${taskId}.json`;
}

/**
 * Truncate a string to maxLength, appending "..." if truncated.
 */
function truncateSummary(text: string, maxLength: number = MAX_SUMMARY_LENGTH): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Create the default initial state for a new IFlow session.
 */
function createDefaultState(): IFlowStateFile {
  return {
    state: 'discussing',
    cycleNumber: 1,
    enteredAt: new Date().toISOString(),
    artifactPaths: [],
    decisionLog: [],
  };
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Read the IFlow state.json file.
 *
 * Returns `null` if the file does not exist.
 * Throws on corrupt JSON to distinguish "missing" from "broken".
 */
export async function readIFlowState(workDir: string): Promise<IFlowStateFile | null> {
  const filePath = stateFilePath(workDir);
  const exists = await fileExists(filePath);
  if (!exists) return null;
  return readJsonFile<IFlowStateFile>(filePath);
}

/**
 * Write the IFlow state.json file.
 *
 * Serialized through stateFileMutex to prevent concurrent writes.
 * Ensures the parent directory exists before writing.
 */
export async function writeIFlowState(workDir: string, state: IFlowStateFile): Promise<void> {
  const filePath = stateFilePath(workDir);
  const dirPath = `${workDir}/${IFLOW_DIR}`;
  await stateFileMutex.runExclusive(async () => {
    await ensureDir(dirPath);
    await writeJsonFile(filePath, state);
  });
}

/**
 * Save an IFlow checkpoint file.
 *
 * - Truncates inputSummary and outputSummary to 200 characters.
 * - Serialized through stateFileMutex.
 * - Creates the checkpoints directory if it does not exist.
 */
export async function saveIFlowCheckpoint(
  workDir: string,
  checkpoint: IFlowCheckpointFile,
): Promise<void> {
  const cpDir = checkpointsDirPath(workDir);
  const filePath = checkpointFilePath(workDir, checkpoint.taskId);

  // Apply truncation to summary fields
  const sanitized: IFlowCheckpointFile = {
    ...checkpoint,
    inputSummary: truncateSummary(checkpoint.inputSummary),
    outputSummary: truncateSummary(checkpoint.outputSummary),
  };

  await stateFileMutex.runExclusive(async () => {
    await ensureDir(cpDir);
    await writeJsonFile(filePath, sanitized);
  });
}

/**
 * Read a specific IFlow checkpoint by taskId.
 *
 * Returns `null` if the checkpoint file does not exist.
 */
export async function readIFlowCheckpoint(
  workDir: string,
  taskId: string,
): Promise<IFlowCheckpointFile | null> {
  const filePath = checkpointFilePath(workDir, taskId);
  const exists = await fileExists(filePath);
  if (!exists) return null;
  return readJsonFile<IFlowCheckpointFile>(filePath);
}

/**
 * Recover the IFlow workflow state.
 *
 * - If state.json exists, reads and returns it.
 * - If state.json does not exist, creates and persists the default
 *   initial state (discussing, cycle 1) and returns it.
 *
 * This ensures the state file always exists after recovery, providing
 * a consistent starting point for the workflow.
 */
export async function recoverIFlowState(workDir: string): Promise<IFlowStateFile> {
  const existing = await readIFlowState(workDir);
  if (existing !== null) {
    return existing;
  }

  // No state file found — bootstrap with defaults
  const defaultState = createDefaultState();
  await writeIFlowState(workDir, defaultState);
  return defaultState;
}
