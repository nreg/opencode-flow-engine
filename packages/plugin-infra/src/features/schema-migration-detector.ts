/**
 * Schema Migration Detector
 *
 * Detects schema changes from diff file lists, identifies the ORM/migration
 * framework in use, generates reversible migration file content, and checks
 * for existing migration files.
 *
 * Framework detection priority: Prisma → Alembic → Knex → Flyway → raw-sql
 */

import { fileExists, directoryExists, readFile } from '@opencode-flow-engine/shared';
import * as path from 'path';
import { readdir } from 'node:fs/promises';

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Represents a detected schema change from diff file analysis.
 */
export interface SchemaChange {
  /** The file path that triggered the schema change detection */
  filePath: string;
  /** Type of change: "schema" (model/entity definition) or "migration" (SQL migration file) */
  type: 'schema' | 'migration';
  /** Detected or inferred framework name */
  framework: string;
  /** Inferred table name from the file name */
  tableName: string;
}

/**
 * Result of a framework detection check.
 */
export interface FrameworkDetectionResult {
  /** Framework name */
  name: string;
  /** Path to the framework's config file */
  configPath: string;
}

/**
 * A framework detector that checks for the presence of a specific
 * migration/ORM framework in a project directory.
 */
export interface FrameworkDetector {
  /** Framework name identifier */
  name: string;
  /**
   * Detect whether this framework is used in the given directory.
   * Returns null if not detected, or a result with config path if detected.
   */
  detect: (changeDir: string) => Promise<FrameworkDetectionResult | null>;
}

// ─── SCHEMA_FILE_PATTERNS ──────────────────────────────────────────────────────

/**
 * Regex patterns for matching schema-related file paths.
 * Covers: Prisma schema, ORM models/entities, SQL migration files.
 */
export const SCHEMA_FILE_PATTERNS: RegExp[] = [
  // Prisma schema
  /(?:^|\/)prisma\/schema\.prisma$/,

  // ORM model files: src/models/*.ts, src/models/*.js
  /(?:^|\/)models\/[\w-]+\.(ts|js)$/,

  // ORM entity files: src/entities/*.entity.ts, src/entities/*.entity.js
  /(?:^|\/)entities\/[\w-]+\.entity\.(ts|js)$/,

  // ORM model files with .model suffix: src/models/*.model.ts
  /(?:^|\/)models\/[\w-]+\.model\.(ts|js)$/,

  // SQL migration files: migrations/*.sql, db/migrations/*.sql
  /(?:^|\/)(?:migrations?|db\/migrations?)\/[\w-]+\.sql$/,

  // TypeORM entity: src/entity/*.ts (singular "entity" dir)
  /(?:^|\/)entity\/[\w-]+\.(ts|js)$/,

  // Django models: app/models.py
  /(?:^|\/)[\w-]+\/models\.py$/,

  // Rails migrations: db/migrate/*.rb
  /(?:^|\/)db\/migrate\/[\w-]+\.rb$/,
];

// ─── Framework Detection Helpers ───────────────────────────────────────────────

/**
 * Check if a file matching a glob-like pattern exists in the directory.
 * Supports patterns like 'knexfile.*', 'schema.prisma' etc.
 */
async function findFileByPattern(dir: string, patterns: string[]): Promise<string | null> {
  for (const pattern of patterns) {
    if (pattern.endsWith('.*')) {
      // Glob pattern: e.g. 'knexfile.*' → prefix = 'knexfile.'
      const prefix = pattern.slice(0, -2);
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.startsWith(prefix)) {
            return path.join(dir, entry.name);
          }
        }
      } catch {
        // Directory might not exist
      }
    } else {
      // Exact match
      const fullPath = path.join(dir, pattern);
      if (await fileExists(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

// ─── FRAMEWORK_DETECTORS ───────────────────────────────────────────────────────

/**
 * Framework detection priority list.
 * Order matters: first match wins. Prisma → Alembic → Knex → Flyway → raw-sql.
 */
export const FRAMEWORK_DETECTORS: FrameworkDetector[] = [
  {
    name: 'prisma',
    detect: async (changeDir: string) => {
      const configPath = await findFileByPattern(changeDir, ['prisma/schema.prisma']);
      if (configPath) {
        return { name: 'prisma', configPath };
      }
      return null;
    },
  },
  {
    name: 'alembic',
    detect: async (changeDir: string) => {
      const configPath = await findFileByPattern(changeDir, ['alembic.ini']);
      if (configPath) {
        return { name: 'alembic', configPath };
      }
      return null;
    },
  },
  {
    name: 'knex',
    detect: async (changeDir: string) => {
      const configPath = await findFileByPattern(changeDir, ['knexfile.*']);
      if (configPath) {
        return { name: 'knex', configPath };
      }
      return null;
    },
  },
  {
    name: 'flyway',
    detect: async (changeDir: string) => {
      const configPath = await findFileByPattern(changeDir, ['flyway.conf']);
      if (configPath) {
        return { name: 'flyway', configPath };
      }
      return null;
    },
  },
  {
    name: 'raw-sql',
    detect: async (changeDir: string) => {
      // Raw SQL is always "detected" as a fallback — any project can have SQL files
      const migrationsDir = path.join(changeDir, 'migrations');
      const dbMigrationsDir = path.join(changeDir, 'db/migrations');
      if (await directoryExists(migrationsDir) || await directoryExists(dbMigrationsDir)) {
        return { name: 'raw-sql', configPath: await directoryExists(migrationsDir) ? migrationsDir : dbMigrationsDir };
      }
      return null;
    },
  },
];

// ─── detectSchemaChanges ───────────────────────────────────────────────────────

/**
 * Infer the table name from a schema file path.
 *
 * Examples:
 *   src/models/user.ts → "user"
 *   src/entities/order.entity.ts → "order"
 *   prisma/schema.prisma → "schema" (generic)
 *   migrations/001_create_users.sql → "users" (extracted from migration name)
 */
function inferTableName(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));

  // Entity file: order.entity → "order"
  if (basename.includes('.entity')) {
    return basename.split('.entity')[0] || basename;
  }

  // Model file with .model suffix: user.model → "user"
  if (basename.includes('.model')) {
    return basename.split('.model')[0] || basename;
  }

  // Prisma schema.prisma → generic "schema"
  if (filePath.endsWith('schema.prisma')) {
    return 'schema';
  }

  // SQL migration: extract table name from common patterns
  // 001_create_users.sql → "users"
  // add_orders_table.sql → "orders"
  const sqlNameMatch = basename.match(
    /(?:create|add|alter|drop|rename)_([\w]+)(?:_table)?$/i,
  );
  if (sqlNameMatch && sqlNameMatch[1]) {
    return sqlNameMatch[1];
  }

  // Django/Rails: just use the basename
  // Default: use the basename as-is
  return basename;
}

/**
 * Infer the framework from a file path.
 * Uses directory structure and file naming conventions.
 */
function inferFrameworkFromPath(filePath: string): string {
  // Prisma
  if (filePath.includes('prisma/')) return 'prisma';

  // Alembic
  if (filePath.includes('alembic/')) return 'alembic';

  // Knex
  if (filePath.includes('knex') || /^\d{14}_/.test(path.basename(filePath))) return 'knex';

  // Flyway
  if (/V\d+__/.test(path.basename(filePath)) || filePath.includes('flyway')) return 'flyway';

  // Django
  if (filePath.endsWith('models.py')) return 'django';

  // Rails
  if (filePath.includes('db/migrate/')) return 'rails';

  // SQL migration files
  if (filePath.endsWith('.sql')) return 'raw-sql';

  // TypeORM / generic ORM model/entity
  if (filePath.includes('/entity/') || filePath.includes('/entities/')) return 'typeorm';
  if (filePath.includes('/models/')) return 'unknown';

  return 'unknown';
}

/**
 * Determine the change type from the file path.
 * "schema" = model/entity definition file
 * "migration" = SQL migration file
 */
function inferChangeType(filePath: string): 'schema' | 'migration' {
  if (filePath.endsWith('.sql') || filePath.includes('/migrations/') || filePath.includes('/migrate/')) {
    return 'migration';
  }
  return 'schema';
}

/**
 * Detect schema changes from a list of diff file paths.
 *
 * Filters the diff files against SCHEMA_FILE_PATTERNS, then enriches
 * each match with type, framework, and tableName metadata.
 *
 * @param diffFiles - List of file paths from a git diff
 * @returns Array of SchemaChange objects for matched files
 */
export function detectSchemaChanges(diffFiles: string[]): SchemaChange[] {
  const changes: SchemaChange[] = [];

  for (const filePath of diffFiles) {
    const isSchemaFile = SCHEMA_FILE_PATTERNS.some(pattern => pattern.test(filePath));
    if (!isSchemaFile) continue;

    changes.push({
      filePath,
      type: inferChangeType(filePath),
      framework: inferFrameworkFromPath(filePath),
      tableName: inferTableName(filePath),
    });
  }

  return changes;
}

// ─── generateMigrationFile ─────────────────────────────────────────────────────

/**
 * Generate a timestamp-based migration file name.
 */
function generateMigrationFileName(tableName: string, framework: string): string {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  switch (framework) {
    case 'knex':
      return timestamp + '_' + tableName + '.js';
    case 'flyway':
      return 'V' + timestamp.slice(0, 8) + '__create_' + tableName + '.sql';
    case 'alembic':
      return timestamp + '_create_' + tableName + '.py';
    case 'prisma':
      return 'migration.sql';
    default:
      return timestamp + '_create_' + tableName + '.sql';
  }
}

/**
 * Generate reversible migration file content for a schema change.
 *
 * Produces framework-specific migration content with both up (apply)
 * and down (rollback) SQL statements.
 *
 * @param change - The detected schema change
 * @param framework - The target migration framework
 * @returns Migration file content as a string
 */
export function generateMigrationFile(change: SchemaChange, framework: string): string {
  const tableName = change.tableName;
  const fileName = generateMigrationFileName(tableName, framework);

  switch (framework) {
    case 'prisma':
      return [
        '-- Migration: ' + fileName,
        '-- Table: ' + tableName,
        '',
        '-- up',
        'CREATE TABLE "' + tableName + '" (',
        '  "id" SERIAL PRIMARY KEY,',
        '  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),',
        '  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()',
        ');',
        '',
        '-- down',
        'DROP TABLE IF EXISTS "' + tableName + '";',
      ].join('\n');

    case 'alembic':
      return [
        '"""create ' + tableName + ' table',
        '',
        'Revision ID: ' + Date.now(),
        'Revises: ',
        'Create Date: ' + new Date().toISOString(),
        '"""',
        'from alembic import op',
        'import sqlalchemy as sa',
        '',
        '',
        '# revision identifiers, used by Alembic.',
        'revision = ' + JSON.stringify(String(Date.now())),
        'down_revision = None',
        'branch_labels = None',
        'depends_on = None',
        '',
        '',
        'def upgrade() -> None:',
        '    op.create_table(',
        '        ' + JSON.stringify(tableName) + ',',
        '        sa.Column("id", sa.Integer(), nullable=False),',
        '        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),',
        '        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),',
        '        sa.PrimaryKeyConstraint("id"),',
        '    )',
        '',
        '',
        'def downgrade() -> None:',
        '    op.drop_table(' + JSON.stringify(tableName) + ')',
      ].join('\n');

    case 'knex':
      return [
        '/**',
        ' * @param { import("knex").Knex } knex',
        ' * @returns { Promise<void> }',
        ' */',
        'exports.up = function(knex) {',
        '  return knex.schema.createTable(' + JSON.stringify(tableName) + ', function(table) {',
        '    table.increments("id").primary();',
        '    table.timestamp("created_at").defaultTo(knex.fn.now());',
        '    table.timestamp("updated_at").defaultTo(knex.fn.now());',
        '  });',
        '};',
        '',
        '/**',
        ' * @param { import("knex").Knex } knex',
        ' * @returns { Promise<void> }',
        ' */',
        'exports.down = function(knex) {',
        '  return knex.schema.dropTableIfExists(' + JSON.stringify(tableName) + ');',
        '};',
      ].join('\n');

    case 'flyway':
      return [
        '-- Migration: ' + fileName,
        '-- Table: ' + tableName,
        '',
        '-- up',
        'CREATE TABLE "' + tableName + '" (',
        '  "id" SERIAL PRIMARY KEY,',
        '  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),',
        '  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()',
        ');',
        '',
        '-- down',
        'DROP TABLE IF EXISTS "' + tableName + '";',
      ].join('\n');

    case 'raw-sql':
    default:
      return [
        '-- Migration: ' + fileName,
        '-- Table: ' + tableName,
        '',
        '-- up',
        'CREATE TABLE "' + tableName + '" (',
        '  "id" SERIAL PRIMARY KEY,',
        '  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),',
        '  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()',
        ');',
        '',
        '-- down',
        'DROP TABLE IF EXISTS "' + tableName + '";',
      ].join('\n');
  }
}

// ─── checkMigrationFileExists ──────────────────────────────────────────────────

/**
 * Check if a migration file already exists for the given schema change.
 *
 * Searches framework-specific migration directories for files that match
 * the table name pattern.
 *
 * @param changeDir - The project root directory
 * @param change - The schema change to check for
 * @returns true if a matching migration file exists, false otherwise
 */
export async function checkMigrationFileExists(
  changeDir: string,
  change: SchemaChange,
): Promise<boolean> {
  const tableName = change.tableName;
  const framework = change.framework;

  // Define framework-specific migration directories to search
  const searchDirs: string[] = [];

  switch (framework) {
    case 'prisma':
      searchDirs.push(
        path.join(changeDir, 'prisma/migrations'),
      );
      break;
    case 'alembic':
      searchDirs.push(
        path.join(changeDir, 'alembic/versions'),
      );
      break;
    case 'knex':
      searchDirs.push(
        path.join(changeDir, 'migrations'),
        path.join(changeDir, 'db/migrations'),
      );
      break;
    case 'flyway':
      searchDirs.push(
        path.join(changeDir, 'db/migration'),
        path.join(changeDir, 'migrations'),
      );
      break;
    case 'raw-sql':
    default:
      searchDirs.push(
        path.join(changeDir, 'migrations'),
        path.join(changeDir, 'db/migrations'),
        path.join(changeDir, 'db/migration'),
      );
      break;
  }

  // Search each directory for files containing the table name
  for (const searchDir of searchDirs) {
    if (!(await directoryExists(searchDir))) continue;

    try {
      const entries = await readdir(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          // Check if the file name contains the table name
          const nameLower = entry.name.toLowerCase();
          if (nameLower.includes(tableName.toLowerCase())) {
            return true;
          }
          // For frameworks where migration files don't contain table names in filename
          // (e.g. Prisma's migration.sql), check file content for the table name
          if (framework === 'prisma' || framework === 'raw-sql') {
            const content = await readFile(path.join(searchDir, entry.name));
            if (content && content.toLowerCase().includes(tableName.toLowerCase())) {
              return true;
            }
          }
        } else if (entry.isDirectory()) {
          // For Prisma: subdirectories like "20240101_create_users" contain the table name
          // Also check for migration.sql inside the subdirectory
          const dirNameLower = entry.name.toLowerCase();
          if (dirNameLower.includes(tableName.toLowerCase())) {
            return true;
          }
          // Check if subdirectory contains a migration.sql (Prisma-style)
          if (framework === 'prisma') {
            try {
              const subDirPath = path.join(searchDir, entry.name);
              const subEntries = await readdir(subDirPath, { withFileTypes: true });
              for (const se of subEntries) {
                if (se.isFile() && se.name === 'migration.sql') {
                  // Check content for table name
                  const content = await readFile(path.join(subDirPath, se.name));
                  if (content && content.toLowerCase().includes(tableName.toLowerCase())) {
                    return true;
                  }
                }
              }
            } catch {
              // Subdirectory not readable
            }
          }
        }
      }
    } catch {
      // Directory might not be readable
    }
  }

  return false;
}
