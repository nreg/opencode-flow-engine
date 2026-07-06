/**
 * File Utils Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { atomicWriteFile, atomicWriteJsonFile, Mutex, readJsonFile, fileExists, ensureDir } from '../file-utils.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

describe('Mutex', () => {
  it('should serialize concurrent operations', async () => {
    const mutex = new Mutex();
    const results: number[] = [];

    await Promise.all([
      mutex.runExclusive(async () => {
        await new Promise(r => setTimeout(r, 30));
        results.push(1);
      }),
      mutex.runExclusive(async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(2);
      }),
    ]);

    // Mutex ensures first operation completes before second starts
    expect(results).toEqual([1, 2]);
  });

  it('should handle errors without deadlock', async () => {
    const mutex = new Mutex();

    await mutex.runExclusive(async () => {
      throw new Error('test error');
    }).catch(() => {});

    // Lock should be released after error
    const result = await mutex.runExclusive(async () => 'success');
    expect(result).toBe('success');
  });
});

describe('atomicWriteFile', () => {
  const dir = tempDir('atomic-write');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should write file atomically', async () => {
    const filePath = join(dir, 'test.txt');
    const result = await atomicWriteFile(filePath, 'hello world');
    expect(result).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('hello world');
  });

  it('should overwrite existing file atomically', async () => {
    const filePath = join(dir, 'test.txt');
    await atomicWriteFile(filePath, 'original content');
    const result = await atomicWriteFile(filePath, 'new content');
    expect(result).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('new content');
  });
});

describe('readJsonFile', () => {
  const dir = tempDir('read-json');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return null for missing file', async () => {
    const result = await readJsonFile(join(dir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('should parse valid JSON file', async () => {
    await atomicWriteFile(join(dir, 'data.json'), JSON.stringify({ key: 'value', num: 42 }));
    const result = await readJsonFile<{ key: string; num: number }>(join(dir, 'data.json'));
    expect(result).not.toBeNull();
    expect(result!.key).toBe('value');
    expect(result!.num).toBe(42);
  });

  it('should throw on malformed JSON', async () => {
    await atomicWriteFile(join(dir, 'bad.json'), '{ invalid json }');
    await expect(readJsonFile(join(dir, 'bad.json'))).rejects.toThrow();
  });
});
