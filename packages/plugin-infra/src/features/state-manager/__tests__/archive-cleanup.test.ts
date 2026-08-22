/**
 * Unit tests for archive-cleanup.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { archiveCleanup, listArchives } from '../archive-cleanup';

const TEST_DIR = join(__dirname, '.test-archive-cleanup');
const SFLOW_DIR = join(TEST_DIR, '.flow-engine', 'sflow');

async function createTestStructure() {
  // Create sflow directory structure
  await mkdir(SFLOW_DIR, { recursive: true });
  await mkdir(join(SFLOW_DIR, 'specs'), { recursive: true });
  await mkdir(join(SFLOW_DIR, 'subagent-store'), { recursive: true });
  await mkdir(join(SFLOW_DIR, 'notifications'), { recursive: true });
  
  // Create active artifacts
  await writeFile(join(SFLOW_DIR, 'proposal.md'), '# Proposal');
  await writeFile(join(SFLOW_DIR, 'design.md'), '# Design');
  await writeFile(join(SFLOW_DIR, 'tasks.md'), '# Tasks');
  await writeFile(join(SFLOW_DIR, 'execution-contract.md'), '# Contract');
  await writeFile(join(SFLOW_DIR, 'specs', 'feature.md'), '# Feature Spec');
  
  // Create state.json
  await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({
    state: 'closing',
    changeName: 'test-change-001',
    mode: 'full',
    batches_completed: 2,
    last_transition: '2026-08-23T10:00:00Z'
  }, null, 2));
  
  // Create preserved assets
  await writeFile(join(SFLOW_DIR, 'lessons.md'), '# Lessons');
  await writeFile(join(SFLOW_DIR, 'verification-report.md'), '# Verification');
  await writeFile(join(SFLOW_DIR, 'archive-metadata.json'), '{}');
}

async function cleanupTestDir() {
  try {
    await rm(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('archiveCleanup', () => {
  beforeEach(async () => {
    await cleanupTestDir();
    await createTestStructure();
  });
  
  afterEach(async () => {
    await cleanupTestDir();
  });
  
  it('should move active artifacts to archive directory', async () => {
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    expect(result.archivedFiles).toContain('proposal.md');
    expect(result.archivedFiles).toContain('design.md');
    expect(result.archivedFiles).toContain('tasks.md');
    expect(result.archivedFiles).toContain('execution-contract.md');
    expect(result.archivedFiles).toContain('specs/');
    expect(result.changeName).toBe('test-change-001');
  });
  
  it('should preserve cross-change assets', async () => {
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    expect(result.preservedAssets).toContain('lessons.md');
    expect(result.preservedAssets).toContain('subagent-store');
    expect(result.preservedAssets).toContain('notifications');
    expect(result.preservedAssets).toContain('verification-report.md');
    expect(result.preservedAssets).toContain('archive-metadata.json');
  });
  
  it('should reset state.json to exploring', async () => {
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    
    const statePath = join(SFLOW_DIR, 'state.json');
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);
    
    expect(state.state).toBe('exploring');
    expect(state.changeName).toBe('');
    expect(state.batches_completed).toBe(0);
  });
  
  it('should preserve original mode (P1-4)', async () => {
    // Create state.json with hotfix mode
    await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({
      state: 'closing',
      changeName: 'test-hotfix',
      mode: 'hotfix',
      batches_completed: 1,
      last_transition: '2026-08-23T10:00:00Z'
    }, null, 2));
    
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    
    const statePath = join(SFLOW_DIR, 'state.json');
    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent);
    
    expect(state.mode).toBe('hotfix');
  });
  
  it('should use timestamp if changeName is empty', async () => {
    // Create state.json with empty changeName
    await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({
      state: 'closing',
      changeName: '',
      mode: 'full',
      batches_completed: 0,
      last_transition: '2026-08-23T10:00:00Z'
    }, null, 2));
    
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    expect(result.changeName).toMatch(/^change-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
  
  it('should use override changeName if provided', async () => {
    const result = await archiveCleanup(TEST_DIR, 'custom-change-name');
    
    expect(result.success).toBe(true);
    expect(result.changeName).toBe('custom-change-name');
  });
  
  it('should handle missing artifacts gracefully', async () => {
    // Remove some artifacts
    await rm(join(SFLOW_DIR, 'proposal.md'));
    await rm(join(SFLOW_DIR, 'design.md'));
    
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    expect(result.archivedFiles).not.toContain('proposal.md');
    expect(result.archivedFiles).not.toContain('design.md');
    expect(result.archivedFiles).toContain('tasks.md');
  });
  
  it('should handle boulder-state.json if present', async () => {
    // Create boulder-state.json
    await writeFile(join(SFLOW_DIR, 'boulder-state.json'), JSON.stringify({
      active: true
    }));
    
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    expect(result.archivedFiles).toContain('boulder-state.json');
  });
  
  it('should create archive directory structure', async () => {
    const result = await archiveCleanup(TEST_DIR);
    
    expect(result.success).toBe(true);
    
    const archiveDir = join(SFLOW_DIR, 'archive', 'test-change-001');
    const entries = await readdir(archiveDir);
    
    expect(entries).toContain('proposal.md');
    expect(entries).toContain('design.md');
    expect(entries).toContain('specs');
  });
  
  it('should be idempotent (running twice should not fail)', async () => {
    const result1 = await archiveCleanup(TEST_DIR);
    expect(result1.success).toBe(true);
    
    // Recreate some artifacts
    await writeFile(join(SFLOW_DIR, 'proposal.md'), '# Proposal 2');
    await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({
      state: 'closing',
      changeName: 'test-change-002',
      mode: 'full'
    }, null, 2));
    
    const result2 = await archiveCleanup(TEST_DIR);
    expect(result2.success).toBe(true);
    expect(result2.changeName).toBe('test-change-002');
  });
});

describe('listArchives', () => {
  beforeEach(async () => {
    await cleanupTestDir();
    await createTestStructure();
  });
  
  afterEach(async () => {
    await cleanupTestDir();
  });
  
  it('should list archive directories sorted by most recent', async () => {
    // Create multiple archives
    await archiveCleanup(TEST_DIR, 'change-2026-08-20');
    await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({ state: 'closing', changeName: 'change-2026-08-21' }));
    await archiveCleanup(TEST_DIR, 'change-2026-08-21');
    await writeFile(join(SFLOW_DIR, 'state.json'), JSON.stringify({ state: 'closing', changeName: 'change-2026-08-22' }));
    await archiveCleanup(TEST_DIR, 'change-2026-08-22');
    
    const archives = await listArchives(TEST_DIR);
    
    expect(archives).toHaveLength(3);
    expect(archives[0]).toBe('change-2026-08-22');
    expect(archives[1]).toBe('change-2026-08-21');
    expect(archives[2]).toBe('change-2026-08-20');
  });
  
  it('should return empty array if no archives', async () => {
    const archives = await listArchives(TEST_DIR);
    expect(archives).toEqual([]);
  });
});
