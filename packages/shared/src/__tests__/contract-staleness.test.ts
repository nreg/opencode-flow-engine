/**
 * Contract Staleness Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { isContractStale, getContractStalenessReport } from '../contract-staleness.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

describe('Contract Staleness', () => {
  const dir = tempDir('contract-staleness');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return false when no contract exists', async () => {
    const result = await isContractStale(dir);
    expect(result).toBe(false);
  });

  it('should return false when no proposal exists', async () => {
    await writeFile(join(dir, 'execution-contract.md'), '# Contract', 'utf-8');
    const result = await isContractStale(dir);
    expect(result).toBe(false);
  });

  it('should return false when contract is newer than proposal', async () => {
    // Write proposal first (older), then contract (newer)
    await writeFile(join(dir, 'proposal.md'), '# Proposal', 'utf-8');
    // Small delay to ensure different mtime
    await new Promise(r => setTimeout(r, 50));
    await writeFile(join(dir, 'execution-contract.md'), '# Contract', 'utf-8');
    const result = await isContractStale(dir);
    expect(result).toBe(false);
  });

  it('should return true when proposal is newer than contract', async () => {
    // Write contract first (older), then proposal (newer)
    await writeFile(join(dir, 'execution-contract.md'), '# Contract', 'utf-8');
    await new Promise(r => setTimeout(r, 50));
    await writeFile(join(dir, 'proposal.md'), '# Proposal', 'utf-8');
    const result = await isContractStale(dir);
    expect(result).toBe(true);
  });

  it('should provide detailed staleness report', async () => {
    await writeFile(join(dir, 'execution-contract.md'), '# Contract', 'utf-8');
    await new Promise(r => setTimeout(r, 50));
    await writeFile(join(dir, 'proposal.md'), '# Proposal', 'utf-8');
    const report = await getContractStalenessReport(dir);
    expect(report.stale).toBe(true);
    expect(report.reason).toContain('Proposal was modified');
    expect(report.contractMtime).toBeDefined();
    expect(report.proposalMtime).toBeDefined();
    expect(report.proposalMtime! > report.contractMtime!).toBe(true);
  });
});
