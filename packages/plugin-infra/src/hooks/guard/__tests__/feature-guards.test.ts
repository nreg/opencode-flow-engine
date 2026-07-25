/**
 * Feature Guards Tests — F2: Schema Migration Guard BLOCK behavior
 *
 * TDD RED phase: Tests verify that checkSchemaMigrationGuard blocks
 * (not just warns) when schema changes lack corresponding migration files.
 *
 * Test coverage:
 *   1. Schema change without migration → { success: false, block: true }
 *   2. blockReason contains table name, framework, and change type
 *   3. Non executing/debugging state → does NOT trigger
 *   4. No schema change → pass
 *   5. Migration file already exists → pass
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkSchemaMigrationGuard } from '../feature-guards.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '..', '..', '..', '__test_workdir__', `feature-guards-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(data, null, 2));
}

// ─── F2: checkSchemaMigrationGuard BLOCK behavior ──────────────────────────────

describe('checkSchemaMigrationGuard — F2 BLOCK behavior', () => {
  const dir = tempDir('schema-migration-block');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should BLOCK when schema change has no migration file (not just warn)', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    // Write a schema file (Prisma model)
    const schemaDir = dir + '/prisma';
    await ensureDir(schemaDir);
    await writeFile(schemaDir + '/schema.prisma', 'datasource db { provider = "postgresql" }');

    // No migration file created

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'prisma/schema.prisma',
    });

    // F2: Must BLOCK, not just warn
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toBeDefined();
    expect(result.blockReason).toContain('[SFLOW] Schema migration guard');
  });

  it('should include table name, framework, and change type in blockReason', async () => {
    // Setup: debugging state
    await writeStateFile(dir, { state: 'debugging' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'edit',
      filePath: 'src/models/user.ts',
    });

    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    // blockReason must contain the table name, framework, and type info
    expect(result.blockReason).toContain('user');
    expect(result.blockReason).toMatch(/unknown|typeorm|prisma/i);
    expect(result.blockReason).toContain('schema');
  });

  it('should NOT trigger for non executing/debugging states', async () => {
    // Setup: exploring state (not executing/debugging)
    await writeStateFile(dir, { state: 'exploring' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'src/models/user.ts',
    });

    // Should pass — guard only applies in executing/debugging
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should pass when no schema changes are detected', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    // Non-schema file
    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'src/utils/helper.ts',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should pass when migration file already exists for the schema change', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    // Create migration directory with a matching migration file
    const migrationsDir = dir + '/prisma/migrations';
    await ensureDir(migrationsDir);
    await writeFile(
      migrationsDir + '/migration.sql',
      '-- up\nCREATE TABLE schema (id SERIAL PRIMARY KEY);\n-- down\nDROP TABLE schema;',
    );

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'prisma/schema.prisma',
    });

    // Should pass — migration file exists
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should NOT trigger when toolName is not write or edit', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'read',
      filePath: 'src/models/user.ts',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should NOT trigger when filePath is empty', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: '',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should NOT trigger when data is undefined', async () => {
    await writeStateFile(dir, { state: 'executing' });

    const result = await checkSchemaMigrationGuard(dir, undefined);

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should block for debugging state as well as executing', async () => {
    // Setup: debugging state
    await writeStateFile(dir, { state: 'debugging' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'src/entities/order.entity.ts',
    });

    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('order');
  });

  it('should NOT return warnings array when blocking (use blockReason instead)', async () => {
    // Setup: executing state
    await writeStateFile(dir, { state: 'executing' });

    const result = await checkSchemaMigrationGuard(dir, {
      toolName: 'write',
      filePath: 'src/models/user.ts',
    });

    // F2: When blocking, must use blockReason, not warnings
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toBeDefined();
    // Should NOT have warnings when blocking
    expect(result.warnings).toBeUndefined();
  });
});
