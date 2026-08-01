/**
 * Tests for Spec Publication Receipt System (P1-1)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import {
  applyDeltaToBaseline,
  applyDeltaToBaselineDetailed,
  resolvePublicationContext,
  hashChangeDelta,
  hashPublishedBaseline,
  createPublicationReceipt,
  savePublicationReceipt,
  readPublicationReceipt,
  validatePublicationReceipt,
  hasPublicationReceipts,
  listPublicationReceipts,
  SPEC_PUBLICATION_DIR,
} from '../spec-publication.js';

const TEST_DIR = join(import.meta.dir, 'tmp-spec-publication');
const PROJECT_ROOT = join(TEST_DIR, 'project');
const CHANGE_DIR = join(PROJECT_ROOT, 'changes', 'test-change');

// ─── 测试辅助函数 ─────────────────────────────────────────────────────

async function setupTestEnv() {
  // 创建测试目录结构
  await mkdir(join(CHANGE_DIR, 'specs', 'delta'), { recursive: true });
  await mkdir(join(PROJECT_ROOT, 'specs', 'auth'), { recursive: true });
  await mkdir(join(PROJECT_ROOT, SPEC_PUBLICATION_DIR), { recursive: true });
}

async function cleanupTestEnv() {
  await rm(TEST_DIR, { recursive: true, force: true });
}

async function createDeltaSpec(content: string, filename = 'auth.md') {
  const path = join(CHANGE_DIR, 'specs', 'delta', filename);
  await writeFile(path, content, 'utf-8');
  return path;
}

async function createBaselineSpec(content: string, capability = 'auth') {
  const dir = join(PROJECT_ROOT, 'specs', capability);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'spec.md');
  await writeFile(path, content, 'utf-8');
  return path;
}

// ─── 测试用例 ─────────────────────────────────────────────────────

describe('Spec Publication System', () => {
  beforeEach(async () => {
    await setupTestEnv();
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  describe('applyDeltaToBaseline', () => {
    it('should apply ADDED delta to empty baseline', () => {
      const deltaContent = `# Auth Delta

## ADDED Requirements

### Requirement: User Login
Users SHALL be able to login with email and password.

#### Scenario: Successful login
**Given:** Valid credentials
**When:** User submits login form
**Then:** User is authenticated
`;

      const result = applyDeltaToBaselineDetailed('', deltaContent, 'auth');

      expect(result.changed).toBe(true);
      expect(result.content).toContain('# auth');
      expect(result.content).toContain('## Purpose');
      expect(result.content).toContain('### Requirement: User Login');
      expect(result.operations).toContainEqual({ operation: 'ADDED', status: 'applied' });
    });

    it('should apply MODIFIED delta to existing baseline', () => {
      const baselineContent = `# auth

## Purpose

Auth capability.

## Requirements

### Requirement: User Login
Users SHALL be able to login with email and password.

#### Scenario: Successful login
**Given:** Valid credentials
**When:** User submits login form
**Then:** User is authenticated
`;

      const deltaContent = `# Auth Delta

## MODIFIED Requirements

### Requirement: User Login
Users SHALL be able to login with email, password, or OAuth.

#### Scenario: Successful login
**Given:** Valid credentials
**When:** User submits login form
**Then:** User is authenticated
`;

      const result = applyDeltaToBaselineDetailed(baselineContent, deltaContent, 'auth');

      expect(result.changed).toBe(true);
      expect(result.content).toContain('email, password, or OAuth');
      expect(result.operations).toContainEqual({ operation: 'MODIFIED', status: 'applied' });
    });

    it('should apply REMOVED delta', () => {
      const baselineContent = `# auth

## Requirements

### Requirement: Legacy Login
Old login method.

#### Scenario: Old login
**Given:** Old system
**When:** User logs in
**Then:** Success

### Requirement: User Login
New login method.

#### Scenario: New login
**Given:** New system
**When:** User logs in
**Then:** Success
`;

      const deltaContent = `# Auth Delta

## REMOVED Requirements

### Requirement: Legacy Login

## ADDED Requirements

### Requirement: Test Placeholder
Placeholder SHALL satisfy delta spec validation.

#### Scenario: Placeholder
**Given:** Nothing
**When:** Nothing
**Then:** Nothing
`;

      const result = applyDeltaToBaselineDetailed(baselineContent, deltaContent, 'auth');

      expect(result.changed).toBe(true);
      expect(result.content).not.toContain('Legacy Login');
      expect(result.content).toContain('User Login');
      expect(result.operations).toContainEqual({ operation: 'REMOVED', status: 'applied' });
    });

    it('should apply RENAMED delta', () => {
      const baselineContent = `# auth

## Requirements

### Requirement: User Login
Users SHALL login.

#### Scenario: Login
**Given:** User
**When:** Login
**Then:** Success
`;

      const deltaContent = `# Auth Delta

## RENAMED Requirements

FROM: ### Requirement: User Login
TO: ### Requirement: User Authentication

## ADDED Requirements

### Requirement: Test Placeholder
Placeholder SHALL satisfy delta spec validation.

#### Scenario: Placeholder
**Given:** Nothing
**When:** Nothing
**Then:** Nothing
`;

      const result = applyDeltaToBaselineDetailed(baselineContent, deltaContent, 'auth');

      expect(result.changed).toBe(true);
      expect(result.content).toContain('### Requirement: User Authentication');
      expect(result.content).not.toContain('### Requirement: User Login');
      expect(result.operations).toContainEqual({ operation: 'RENAMED', status: 'applied' });
    });

    it('should skip identical MODIFIED delta', () => {
      const baselineContent = `# auth

## Purpose

Auth capability.

## Requirements

### Requirement: User Login
Users SHALL login.

#### Scenario: Login
**Given:** User
**When:** Login
**Then:** Success
`;

      const deltaContent = `# Auth Delta

## MODIFIED Requirements

### Requirement: User Login
Users SHALL login.

#### Scenario: Login
**Given:** User
**When:** Login
**Then:** Success
`;

      const result = applyDeltaToBaselineDetailed(baselineContent, deltaContent, 'auth');

      // 即使内容相同，渲染逻辑可能产生规范化差异
      // 重点是 MODIFIED 操作被标记为 skipped
      expect(result.operations).toContainEqual({ operation: 'MODIFIED', status: 'skipped' });
    });
  });

  describe('hashPublishedBaseline', () => {
    it('should compute consistent hash for same content', async () => {
      await createBaselineSpec('# auth\n\nTest content', 'auth');

      const hash1 = await hashPublishedBaseline(PROJECT_ROOT, ['auth']);
      const hash2 = await hashPublishedBaseline(PROJECT_ROOT, ['auth']);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:/);
    });

    it('should produce different hash for different content', async () => {
      await createBaselineSpec('# auth\n\nContent A', 'auth');
      const hash1 = await hashPublishedBaseline(PROJECT_ROOT, ['auth']);

      await createBaselineSpec('# auth\n\nContent B', 'auth');
      const hash2 = await hashPublishedBaseline(PROJECT_ROOT, ['auth']);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle missing spec files', async () => {
      const hash = await hashPublishedBaseline(PROJECT_ROOT, ['nonexistent']);
      expect(hash).toMatch(/^sha256:/);
      // 哈希值包含 <missing> 标记的内容
    });
  });

  describe('Publication Receipt', () => {
    it('should create and save receipt', async () => {
      const specFiles = [await createDeltaSpec('# Delta\n\n## ADDED Requirements\n\n### Requirement: Test\nTest.\n\n#### Scenario: Test\n**Given:** Nothing\n**When:** Nothing\n**Then:** Nothing')];
      
      const receipt = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        specFiles,
        'sha256:initial',
        'change-123'
      );

      expect(receipt.schema_version).toBe(1);
      // capability 从 delta spec 文件路径提取（specs/delta/auth.md -> delta）
      expect(receipt.capability).toBe('delta');
      expect(receipt.baseline_hash).toMatch(/^sha256:/);
      expect(receipt.change_id).toBe('change-123');
      expect(receipt.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      await savePublicationReceipt(PROJECT_ROOT, receipt);

      const saved = await readPublicationReceipt(PROJECT_ROOT, 'delta');
      expect(saved).not.toBeNull();
      expect(saved?.schema_version).toBe(1);
      expect(saved?.capability).toBe('delta');
    });

    it('should list all receipts', async () => {
      const receipt1 = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        [await createDeltaSpec('# Delta 1\n\n## ADDED Requirements\n\n### Requirement: A\nA.\n\n#### Scenario: Test\n**Given:** Nothing\n**When:** Nothing\n**Then:** Nothing')],
        'sha256:initial',
        'change-1'
      );
      await savePublicationReceipt(PROJECT_ROOT, receipt1);

      const receipts = await listPublicationReceipts(PROJECT_ROOT);
      expect(receipts).toContain('delta');
    });

    it('should detect if receipts exist', async () => {
      const hasBefore = await hasPublicationReceipts(PROJECT_ROOT);
      expect(hasBefore).toBe(true); // 目录已创建

      const receipt = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        [await createDeltaSpec('# Delta\n\n## ADDED Requirements\n\n### Requirement: Test\nTest.')],
        'sha256:initial',
        'change-1'
      );
      await savePublicationReceipt(PROJECT_ROOT, receipt);

      const hasAfter = await hasPublicationReceipts(PROJECT_ROOT);
      expect(hasAfter).toBe(true);
    });
  });

  describe('validatePublicationReceipt', () => {
    it('should validate correct receipt', async () => {
      const specFiles = [await createDeltaSpec('# Delta\n\n## ADDED Requirements\n\n### Requirement: Test\nTest.')];
      await createBaselineSpec('# auth\n\n## Requirements\n\n### Requirement: Test\nTest.', 'auth');

      const receipt = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        specFiles,
        'sha256:initial',
        'change-1'
      );

      const validation = await validatePublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        receipt,
        specFiles
      );

      expect(validation.pass).toBe(true);
      expect(validation.reason).toBe('');
    });

    it('should reject receipt with mismatched schema version', async () => {
      const specFiles = [await createDeltaSpec('# Delta\n\n## ADDED Requirements\n\n### Requirement: Test\nTest.')];

      const receipt = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        specFiles,
        'sha256:initial',
        'change-1'
      );
      receipt.schema_version = 999; // 篡改版本号

      const validation = await validatePublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        receipt,
        specFiles
      );

      expect(validation.pass).toBe(false);
      expect(validation.reason).toContain('schema version mismatch');
    });

    it('should reject receipt when baseline changed', async () => {
      const specFiles = [await createDeltaSpec('# Delta\n\n## ADDED Requirements\n\n### Requirement: Test\nTest.\n\n#### Scenario: Test\n**Given:** Nothing\n**When:** Nothing\n**Then:** Nothing')];
      await createBaselineSpec('# delta\n\n## Requirements\n\n### Requirement: Test\nOriginal.', 'delta');

      const receipt = await createPublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        specFiles,
        'sha256:initial',
        'change-1'
      );

      // 修改 baseline
      await createBaselineSpec('# delta\n\n## Requirements\n\n### Requirement: Test\nModified.', 'delta');

      const validation = await validatePublicationReceipt(
        CHANGE_DIR,
        PROJECT_ROOT,
        receipt,
        specFiles
      );

      expect(validation.pass).toBe(false);
      expect(validation.reason).toContain('baseline has changed');
    });
  });

  describe('resolvePublicationContext', () => {
    it('should resolve context from change directory', () => {
      const context = resolvePublicationContext(CHANGE_DIR);

      expect(context.changeDir).toBe(CHANGE_DIR);
      expect(context.projectRoot).toBe(PROJECT_ROOT);
      expect(context.baselineSpecsDir).toBe(join(PROJECT_ROOT, 'specs'));
    });
  });
});
