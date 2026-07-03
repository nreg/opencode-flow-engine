/**
 * Contract Staleness Checker — Single source of truth
 *
 * Replaces duplicate implementations in:
 * - packages/opencode-adapter/src/tools/workflow-router.ts (checkContractStaleness)
 * - packages/opencode-adapter/src/features/state-manager.ts (isContractStaleness)
 */

import { fileExists } from "./file-utils.js";

/**
 * Check if execution-contract.md is stale relative to proposal.md.
 * A contract is stale if proposal.md was modified after the contract was created.
 *
 * This is the single source of truth for staleness detection.
 * All consumers (workflow-router, state-manager, guard hook) must use this function.
 */
export async function isContractStale(changeDir: string): Promise<boolean> {
  const contractPath = `${changeDir}/execution-contract.md`;
  const proposalPath = `${changeDir}/proposal.md`;

  const contractExists = await fileExists(contractPath);
  const proposalExists = await fileExists(proposalPath);
  if (!contractExists || !proposalExists) return false;

  try {
    const { stat } = await import("fs/promises");
    const contractStats = await stat(contractPath);
    const proposalStats = await stat(proposalPath);
    return proposalStats.mtimeMs > contractStats.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Detailed staleness report for debugging and user-facing messages.
 */
export interface StalenessReport {
  stale: boolean;
  reason?: string;
  contractMtime?: number;
  proposalMtime?: number;
}

export async function getContractStalenessReport(
  changeDir: string,
): Promise<StalenessReport> {
  const contractPath = `${changeDir}/execution-contract.md`;
  const proposalPath = `${changeDir}/proposal.md`;

  const contractExists = await fileExists(contractPath);
  if (!contractExists) {
    return { stale: false, reason: "Contract file not found" };
  }

  const proposalExists = await fileExists(proposalPath);
  if (!proposalExists) {
    return { stale: false, reason: "Proposal file not found" };
  }

  try {
    const { stat } = await import("fs/promises");
    const contractStats = await stat(contractPath);
    const proposalStats = await stat(proposalPath);
    const stale = proposalStats.mtimeMs > contractStats.mtimeMs;
    return {
      stale,
      reason: stale
        ? "Proposal was modified after contract was created"
        : undefined,
      contractMtime: contractStats.mtimeMs,
      proposalMtime: proposalStats.mtimeMs,
    };
  } catch (error) {
    return {
      stale: false,
      reason: `Error checking staleness: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
