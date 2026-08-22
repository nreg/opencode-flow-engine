/**
 * Test for Defect 1: DP state progression fix
 * 
 * Validates that record_decision_point updates the top-level state field
 * after appending to decisionPoints array.
 * 
 * Expected behavior (from execution-contract.md):
 * - After calling record_decision_point, state.json top-level "state" field
 *   should be updated to target_state (e.g., dp-3 → approved-for-build)
 * - Must pass through guard check to ensure state transition is valid
 * - If writeStateFile fails, decisionPoints should not be updated
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createWorkflowTools } from '../builtin-mcp.js';
import type { ToolContext } from '@opencode-ai/plugin';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecisionPoint } from '@opencode-flow-engine/core';

describe('record_decision_point state progression', () => {
  const testDir = join(process.cwd(), '.test-dp-state-fix');
  const stateDir = join(testDir, '.flow-engine', 'sflow');
  const statePath = join(stateDir, 'state.json');

  beforeEach(async () => {
    // Clean up and create test directory
    await rm(testDir, { recursive: true, force: true });
    await mkdir(stateDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it('should update top-level state to target_state after recording DP', async () => {
    // Setup: Create initial state.json
    const initialState = {
      state: 'bridging',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    // Create tool context
    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    // Get record_decision_point tool
    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Record DP-3 (bridging → approved-for-build)
    const result = await recordDP.execute!(
      {
        dp_id: 'dp-3',
        state: 'bridging',
        target_state: 'approved-for-build',
        metadata: 'contract validated by user',
        change_dir: testDir,
      },
      context
    );

    // Parse result
    const output = JSON.parse(result.output);

    // Verify: Tool should succeed
    expect(output.success).toBe(true);
    expect(output.dp.id).toBe('dp-3');

    // Read updated state.json
    const stateContent = await readFile(statePath, 'utf-8');
    const updatedState = JSON.parse(stateContent);

    // CRITICAL ASSERTION: Top-level state should be updated to target_state
    // This is the defect we're testing for - currently this will FAIL
    expect(updatedState.state).toBe('approved-for-build');

    // Verify decisionPoints was also updated
    expect(Array.isArray(updatedState.decisionPoints)).toBe(true);
    const dps = updatedState.decisionPoints as DecisionPoint[];
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
    expect(dp3?.targetState).toBe('approved-for-build');
  });

  it('should not update decisionPoints if state transition fails', async () => {
    // Setup: Create initial state.json
    const initialState = {
      state: 'exploring',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Try invalid transition (exploring → approved-for-build is invalid)
    // This should fail guard check and NOT update decisionPoints
    const result = await recordDP.execute!(
      {
        dp_id: 'dp-3',
        state: 'exploring',
        target_state: 'approved-for-build', // Invalid: must go through specifying, bridging first
        metadata: 'invalid transition test',
        change_dir: testDir,
      },
      context
    );

    const output = JSON.parse(result.output);

    // Verify: Should fail due to invalid transition
    expect(output.success).toBe(false);
    expect(output.error).toBeDefined();

    // Read state.json - should be unchanged
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);

    // State should remain unchanged
    expect(state.state).toBe('exploring');

    // decisionPoints should NOT have been updated
    expect(state.decisionPoints).toBeUndefined();
  });

  it('should handle DP-0 transition (exploring → specifying)', async () => {
    // Setup
    const initialState = {
      state: 'exploring',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Record DP-0 (exploring → specifying)
    const result = await recordDP.execute!(
      {
        dp_id: 'dp-0',
        state: 'exploring',
        target_state: 'specifying',
        metadata: 'requirements clarified',
        change_dir: testDir,
      },
      context
    );

    const output = JSON.parse(result.output);

    // Verify
    expect(output.success).toBe(true);

    const stateContent = await readFile(statePath, 'utf-8');
    const updatedState = JSON.parse(stateContent);

    // Top-level state should be updated
    expect(updatedState.state).toBe('specifying');

    // DP-0 should be recorded
    const dps = updatedState.decisionPoints as DecisionPoint[];
    const dp0 = dps.find(dp => dp.id === 'dp-0');
    expect(dp0).toBeDefined();
  });

  it('should handle write errors gracefully', async () => {
    // Setup: Create initial state.json
    const initialState = {
      state: 'bridging',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Record DP-3 with valid transition
    const result = await recordDP.execute!(
      {
        dp_id: 'dp-3',
        state: 'bridging',
        target_state: 'approved-for-build',
        metadata: 'contract validated by user',
        change_dir: testDir,
      },
      context
    );

    const output = JSON.parse(result.output);

    // Verify: Should succeed
    expect(output.success).toBe(true);

    // Read state.json - should be updated
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);

    // State should be updated
    expect(state.state).toBe('approved-for-build');

    // decisionPoints should have been updated
    expect(state.decisionPoints).toBeDefined();
    const dps = state.decisionPoints as DecisionPoint[];
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
  });

  it('should handle concurrent calls safely (mutex atomicity)', async () => {
    // Setup: Create initial state.json
    const initialState = {
      state: 'exploring',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Concurrent calls - DP-0 (exploring → specifying) and then DP-1 (specifying → bridging)
    // They must be sequential because DP-1 depends on DP-0 completing first
    const result1 = await recordDP.execute!(
      {
        dp_id: 'dp-0',
        state: 'exploring',
        target_state: 'specifying',
        metadata: 'requirements clarified',
        change_dir: testDir,
      },
      context
    );

    const output1 = JSON.parse(result1.output);
    expect(output1.success).toBe(true);

    const result2 = await recordDP.execute!(
      {
        dp_id: 'dp-1',
        state: 'specifying',
        target_state: 'bridging',
        metadata: 'specs approved',
        change_dir: testDir,
      },
      context
    );

    const output2 = JSON.parse(result2.output);
    expect(output2.success).toBe(true);

    // Read state.json
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);

    // State should be updated to the final target state
    expect(state.state).toBe('bridging');

    // Both DPs should be recorded
    const dps = state.decisionPoints as DecisionPoint[];
    expect(dps.length).toBe(2);
    expect(dps.find(dp => dp.id === 'dp-0')).toBeDefined();
    expect(dps.find(dp => dp.id === 'dp-1')).toBeDefined();
  });

  it('should handle duplicate DP recording (update existing entry)', async () => {
    // Setup: Create initial state.json with an existing DP-3
    const initialState = {
      state: 'bridging',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: new Date().toISOString(),
      decisionPoints: [
        {
          id: 'dp-3',
          name: 'dp-3',
          confirmedInState: 'bridging',
          targetState: 'approved-for-build',
          timestamp: new Date().toISOString(),
          metadata: 'initial attempt',
        },
      ],
    };
    await writeFile(statePath, JSON.stringify(initialState, null, 2));

    const context: ToolContext = {
      directory: testDir,
    } as ToolContext;

    const tools = createWorkflowTools();
    const recordDP = tools.record_decision_point;

    // Execute: Record DP-3 again with different metadata
    const result = await recordDP.execute!(
      {
        dp_id: 'dp-3',
        state: 'bridging',
        target_state: 'approved-for-build',
        metadata: 'updated attempt',
        change_dir: testDir,
      },
      context
    );

    const output = JSON.parse(result.output);

    // Verify: Should succeed
    expect(output.success).toBe(true);

    // Read state.json
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);

    // State should be updated
    expect(state.state).toBe('approved-for-build');

    // DP-3 should be updated (not duplicated)
    const dps = state.decisionPoints as DecisionPoint[];
    const dp3Entries = dps.filter(dp => dp.id === 'dp-3');
    expect(dp3Entries.length).toBeGreaterThanOrEqual(1);

    // The latest entry should have the updated metadata
    const latestDp3 = dp3Entries[dp3Entries.length - 1];
    expect(latestDp3.metadata).toBe('updated attempt');
  });
});
