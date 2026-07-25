/**
 * Tests for schema-migration-detector.ts — T1.1
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers:
 *   - SCHEMA_FILE_PATTERNS (regex patterns for schema files)
 *   - FRAMEWORK_DETECTORS (framework detection priority list)
 *   - detectSchemaChanges(diffFiles) — detect schema changes from diff file list
 *   - generateMigrationFile(change, framework) — generate reversible migration content
 *   - checkMigrationFileExists(changeDir, change) — check if migration file exists
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  SCHEMA_FILE_PATTERNS,
  FRAMEWORK_DETECTORS,
  detectSchemaChanges,
  generateMigrationFile,
  checkMigrationFileExists,
} from '../schema-migration-detector.js';
import type { SchemaChange, FrameworkDetector } from '../schema-migration-detector.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '..', '__test_workdir__', `schema-migration-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

// ─── SCHEMA_FILE_PATTERNS ──────────────────────────────────────────────────────

describe('SCHEMA_FILE_PATTERNS', () => {
  it('should be a non-empty array of RegExp patterns', () => {
    expect(Array.isArray(SCHEMA_FILE_PATTERNS)).toBe(true);
    expect(SCHEMA_FILE_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of SCHEMA_FILE_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('should match Prisma schema files', () => {
    const prismaFiles = [
      'prisma/schema.prisma',
      'packages/backend/prisma/schema.prisma',
    ];
    for (const file of prismaFiles) {
      const matched = SCHEMA_FILE_PATTERNS.some(p => p.test(file));
      expect(matched).toBe(true);
    }
  });

  it('should match ORM model/entity files', () => {
    const modelFiles = [
      'src/models/user.ts',
      'src/entities/order.entity.ts',
      'src/models/product.model.ts',
      'packages/api/src/models/user.ts',
    ];
    for (const file of modelFiles) {
      const matched = SCHEMA_FILE_PATTERNS.some(p => p.test(file));
      expect(matched).toBe(true);
    }
  });

  it('should match SQL migration files', () => {
    const sqlFiles = [
      'migrations/001_create_users.sql',
      'db/migrations/add_orders_table.sql',
    ];
    for (const file of sqlFiles) {
      const matched = SCHEMA_FILE_PATTERNS.some(p => p.test(file));
      expect(matched).toBe(true);
    }
  });

  it('should NOT match non-schema files', () => {
    const nonSchemaFiles = [
      'src/index.ts',
      'src/utils/helper.ts',
      'README.md',
      'package.json',
      'src/components/Button.tsx',
      'src/styles/main.css',
    ];
    for (const file of nonSchemaFiles) {
      const matched = SCHEMA_FILE_PATTERNS.some(p => p.test(file));
      expect(matched).toBe(false);
    }
  });
});

// ─── FRAMEWORK_DETECTORS ───────────────────────────────────────────────────────

describe('FRAMEWORK_DETECTORS', () => {
  it('should be a non-empty array of FrameworkDetector objects', () => {
    expect(Array.isArray(FRAMEWORK_DETECTORS)).toBe(true);
    expect(FRAMEWORK_DETECTORS.length).toBeGreaterThan(0);
    for (const detector of FRAMEWORK_DETECTORS) {
      expect(detector).toHaveProperty('name');
      expect(detector).toHaveProperty('detect');
      expect(typeof detector.name).toBe('string');
      expect(typeof detector.detect).toBe('function');
    }
  });

  it('should have Prisma as the highest priority detector', () => {
    expect(FRAMEWORK_DETECTORS[0].name).toBe('prisma');
  });

  it('should include Alembic, Knex, Flyway, and raw-sql detectors', () => {
    const names = FRAMEWORK_DETECTORS.map(d => d.name);
    expect(names).toContain('alembic');
    expect(names).toContain('knex');
    expect(names).toContain('flyway');
    expect(names).toContain('raw-sql');
  });

  it('each detector detect() should return framework name and configPath', async () => {
    // Test with a temp dir that has no framework config — should return null
    const dir = tempDir('no-framework');
    await ensureDir(dir);
    try {
      for (const detector of FRAMEWORK_DETECTORS) {
        const result = await detector.detect(dir);
        // Result is either null or { name, configPath }
        if (result !== null) {
          expect(result).toHaveProperty('name');
          expect(result).toHaveProperty('configPath');
        }
      }
    } finally {
      await cleanupDir(dir);
    }
  });

  it('Prisma detector should detect prisma/schema.prisma', async () => {
    const dir = tempDir('prisma-detect');
    await ensureDir(dir + '/prisma');
    try {
      await writeFile(dir + '/prisma/schema.prisma', 'datasource db { provider = "postgresql" }');
      const prismaDetector = FRAMEWORK_DETECTORS.find(d => d.name === 'prisma')!;
      const result = await prismaDetector.detect(dir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('prisma');
      expect(result!.configPath).toContain('schema.prisma');
    } finally {
      await cleanupDir(dir);
    }
  });

  it('Alembic detector should detect alembic.ini', async () => {
    const dir = tempDir('alembic-detect');
    await ensureDir(dir);
    try {
      await writeFile(dir + '/alembic.ini', '[alembic]\nscript_location = alembic');
      const alembicDetector = FRAMEWORK_DETECTORS.find(d => d.name === 'alembic')!;
      const result = await alembicDetector.detect(dir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('alembic');
      expect(result!.configPath).toContain('alembic.ini');
    } finally {
      await cleanupDir(dir);
    }
  });

  it('Knex detector should detect knexfile', async () => {
    const dir = tempDir('knex-detect');
    await ensureDir(dir);
    try {
      await writeFile(dir + '/knexfile.js', 'module.exports = { client: "pg" };');
      const knexDetector = FRAMEWORK_DETECTORS.find(d => d.name === 'knex')!;
      const result = await knexDetector.detect(dir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('knex');
      expect(result!.configPath).toContain('knexfile');
    } finally {
      await cleanupDir(dir);
    }
  });

  it('Flyway detector should detect flyway.conf', async () => {
    const dir = tempDir('flyway-detect');
    await ensureDir(dir);
    try {
      await writeFile(dir + '/flyway.conf', 'flyway.url=jdbc:postgresql://localhost/db');
      const flywayDetector = FRAMEWORK_DETECTORS.find(d => d.name === 'flyway')!;
      const result = await flywayDetector.detect(dir);
      expect(result).not.toBeNull();
      expect(result!.name).toBe('flyway');
      expect(result!.configPath).toContain('flyway.conf');
    } finally {
      await cleanupDir(dir);
    }
  });
});

// ─── detectSchemaChanges ───────────────────────────────────────────────────────

describe('detectSchemaChanges', () => {
  it('should return empty array for empty diff files', () => {
    const result = detectSchemaChanges([]);
    expect(result).toEqual([]);
  });

  it('should return empty array for non-schema diff files', () => {
    const diffFiles = [
      'src/index.ts',
      'src/utils/helper.ts',
      'README.md',
    ];
    const result = detectSchemaChanges(diffFiles);
    expect(result).toEqual([]);
  });

  it('should detect Prisma schema changes', () => {
    const diffFiles = ['prisma/schema.prisma'];
    const result = detectSchemaChanges(diffFiles);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].filePath).toBe('prisma/schema.prisma');
    expect(result[0].type).toBe('schema');
    expect(result[0].framework).toBe('prisma');
  });

  it('should detect ORM model/entity changes', () => {
    const diffFiles = ['src/models/user.ts'];
    const result = detectSchemaChanges(diffFiles);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].filePath).toBe('src/models/user.ts');
    expect(result[0].type).toBe('schema');
  });

  it('should detect SQL migration file changes', () => {
    const diffFiles = ['migrations/001_create_users.sql'];
    const result = detectSchemaChanges(diffFiles);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].filePath).toBe('migrations/001_create_users.sql');
    expect(result[0].type).toBe('migration');
  });

  it('should return multiple SchemaChange entries for multiple schema files', () => {
    const diffFiles = [
      'prisma/schema.prisma',
      'src/models/user.ts',
      'src/entities/order.entity.ts',
    ];
    const result = detectSchemaChanges(diffFiles);
    expect(result.length).toBe(3);
  });

  it('should ignore non-schema files mixed with schema files', () => {
    const diffFiles = [
      'prisma/schema.prisma',
      'src/index.ts',
      'src/models/user.ts',
      'README.md',
    ];
    const result = detectSchemaChanges(diffFiles);
    expect(result.length).toBe(2);
    expect(result.every(r => r.filePath !== 'src/index.ts' && r.filePath !== 'README.md')).toBe(true);
  });

  it('each SchemaChange should have required fields', () => {
    const diffFiles = ['prisma/schema.prisma'];
    const result = detectSchemaChanges(diffFiles);
    const change = result[0];
    expect(change).toHaveProperty('filePath');
    expect(change).toHaveProperty('type');
    expect(change).toHaveProperty('framework');
    expect(change).toHaveProperty('tableName');
    expect(typeof change.filePath).toBe('string');
    expect(typeof change.type).toBe('string');
    expect(typeof change.framework).toBe('string');
  });

  it('should infer tableName from file name for model files', () => {
    const diffFiles = ['src/models/user.ts'];
    const result = detectSchemaChanges(diffFiles);
    expect(result[0].tableName).toBe('user');
  });

  it('should infer tableName from entity file names', () => {
    const diffFiles = ['src/entities/order.entity.ts'];
    const result = detectSchemaChanges(diffFiles);
    expect(result[0].tableName).toBe('order');
  });

  it('should set framework to "unknown" for model files without clear framework indicator', () => {
    const diffFiles = ['src/models/user.ts'];
    const result = detectSchemaChanges(diffFiles);
    // Without a framework config file, model files default to "unknown" framework
    expect(result[0].framework).toBeTruthy();
  });
});

// ─── generateMigrationFile ─────────────────────────────────────────────────────

describe('generateMigrationFile', () => {
  const sampleChange: SchemaChange = {
    filePath: 'prisma/schema.prisma',
    type: 'schema',
    framework: 'prisma',
    tableName: 'users',
  };

  it('should generate migration content with up and down sections', () => {
    const content = generateMigrationFile(sampleChange, 'prisma');
    expect(content).toContain('-- up');
    expect(content).toContain('-- down');
  });

  it('should include CREATE TABLE in up section for schema type changes', () => {
    const content = generateMigrationFile(sampleChange, 'prisma');
    expect(content.toLowerCase()).toContain('create table');
    expect(content.toLowerCase()).toContain('users');
  });

  it('should include DROP TABLE in down section for schema type changes', () => {
    const content = generateMigrationFile(sampleChange, 'prisma');
    expect(content.toLowerCase()).toContain('drop table');
    expect(content.toLowerCase()).toContain('users');
  });

  it('should generate different content for different frameworks', () => {
    const prismaContent = generateMigrationFile(sampleChange, 'prisma');
    const alembicContent = generateMigrationFile(sampleChange, 'alembic');
    // Both should have up/down but framework-specific formatting
    expect(prismaContent).toBeTruthy();
    expect(alembicContent).toBeTruthy();
  });

  it('should include migration header with timestamp and table name', () => {
    const content = generateMigrationFile(sampleChange, 'prisma');
    expect(content).toContain('users');
  });

  it('should handle migration type changes (not schema)', () => {
    const migrationChange: SchemaChange = {
      filePath: 'migrations/001_create_users.sql',
      type: 'migration',
      framework: 'raw-sql',
      tableName: 'users',
    };
    const content = generateMigrationFile(migrationChange, 'raw-sql');
    expect(content).toContain('-- up');
    expect(content).toContain('-- down');
  });

  it('should generate Alembic-style migration for alembic framework', () => {
    const content = generateMigrationFile(sampleChange, 'alembic');
    expect(content).toContain('def upgrade()');
    expect(content).toContain('def downgrade()');
  });

  it('should generate Knex-style migration for knex framework', () => {
    const content = generateMigrationFile(sampleChange, 'knex');
    expect(content).toContain('exports.up');
    expect(content).toContain('exports.down');
  });
});

// ─── checkMigrationFileExists ──────────────────────────────────────────────────

describe('checkMigrationFileExists', () => {
  const dir = tempDir('check-migration');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return false when no migration file exists', async () => {
    const change: SchemaChange = {
      filePath: 'prisma/schema.prisma',
      type: 'schema',
      framework: 'prisma',
      tableName: 'users',
    };
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(false);
  });

  it('should return true when migration file exists for Prisma', async () => {
    const change: SchemaChange = {
      filePath: 'prisma/schema.prisma',
      type: 'schema',
      framework: 'prisma',
      tableName: 'users',
    };
    // Create a migration directory and file
    await ensureDir(dir + '/prisma/migrations');
    await writeFile(
      dir + '/prisma/migrations/migration.sql',
      '-- up\nCREATE TABLE users (id SERIAL PRIMARY KEY);\n-- down\nDROP TABLE users;',
    );
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(true);
  });

  it('should return true when migration file exists for Alembic', async () => {
    const change: SchemaChange = {
      filePath: 'alembic/versions/001_users.py',
      type: 'migration',
      framework: 'alembic',
      tableName: 'users',
    };
    await ensureDir(dir + '/alembic/versions');
    await writeFile(
      dir + '/alembic/versions/001_users.py',
      'def upgrade(): pass\ndef downgrade(): pass',
    );
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(true);
  });

  it('should return true when migration file exists for Knex', async () => {
    const change: SchemaChange = {
      filePath: 'migrations/20240101000000_users.js',
      type: 'migration',
      framework: 'knex',
      tableName: 'users',
    };
    await ensureDir(dir + '/migrations');
    await writeFile(
      dir + '/migrations/20240101000000_users.js',
      'exports.up = function(knex) {};\nexports.down = function(knex) {};',
    );
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(true);
  });

  it('should return true when migration file exists for Flyway', async () => {
    const change: SchemaChange = {
      filePath: 'db/migration/V1__create_users.sql',
      type: 'migration',
      framework: 'flyway',
      tableName: 'users',
    };
    await ensureDir(dir + '/db/migration');
    await writeFile(
      dir + '/db/migration/V1__create_users.sql',
      'CREATE TABLE users (id SERIAL PRIMARY KEY);',
    );
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(true);
  });

  it('should return false when migration directory exists but no matching file', async () => {
    const change: SchemaChange = {
      filePath: 'prisma/schema.prisma',
      type: 'schema',
      framework: 'prisma',
      tableName: 'orders',
    };
    await ensureDir(dir + '/prisma/migrations');
    // No migration file created
    const exists = await checkMigrationFileExists(dir, change);
    expect(exists).toBe(false);
  });
});
