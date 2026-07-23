/**
 * Tests for NotificationManager
 *
 * Covers:
 * - writeNotification (sync_completed / async_completed)
 * - consumeNotifications (消费 + 去重 + 空目录 + 目录不存在)
 * - getPendingNotifications
 * - 写入失败不阻塞
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdir, rm, writeFile, readFile, exists } from 'fs/promises';
import { createNotificationManager } from '../notification-manager.js';
import type { WriteNotificationParams } from '../notification-manager.js';

// ─── 测试临时目录 ──────────────────────────────────────────────────────────

const TEST_TMP = join(import.meta.dir, '__nm_test_tmp__');

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

function makeWriteParams(overrides: Partial<WriteNotificationParams> = {}): WriteNotificationParams {
  return {
    type: 'sync_completed',
    subagent: 'build-executor',
    task_id: 'sf_1700000000_1',
    session_id: 'sess_abc',
    summary: 'Build completed successfully',
    ...overrides,
  };
}

// ─── 测试用例 ──────────────────────────────────────────────────────────────

describe('NotificationManager', () => {
  let nm: ReturnType<typeof createNotificationManager>;

  beforeEach(async () => {
    // 清理并创建临时目录
    await rm(TEST_TMP, { recursive: true, force: true });
    await mkdir(TEST_TMP, { recursive: true });
    nm = createNotificationManager({ changeDir: TEST_TMP });
  });

  afterEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
  });

  // ─── writeNotification ──────────────────────────────────────────────────

  describe('writeNotification', () => {
    it('should write a sync_completed notification file', async () => {
      const params = makeWriteParams({ type: 'sync_completed' });
      await nm.writeNotification(params);

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const files = await Array.prototype.filter.call(
        await import('fs/promises').then(m => m.readdir(notifDir)),
        (f: string) => f.endsWith('.json'),
      );
      expect(files.length).toBe(1);
      expect(files[0]).toBe('sf_1700000000_1.json');

      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));
      expect(content.type).toBe('sync_completed');
      expect(content.subagent).toBe('build-executor');
      expect(content.task_id).toBe('sf_1700000000_1');
      expect(content.session_id).toBe('sess_abc');
      expect(content.summary).toBe('Build completed successfully');
      expect(content.completed_at).toBeTruthy();
    });

    it('should write an async_completed notification file', async () => {
      const params = makeWriteParams({ type: 'async_completed' });
      await nm.writeNotification(params);

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const { readdir } = await import('fs/promises');
      const files = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      expect(files.length).toBe(1);

      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));
      expect(content.type).toBe('async_completed');
    });

    it('should auto-generate completed_at timestamp', async () => {
      const before = new Date().toISOString();
      const params = makeWriteParams();
      await nm.writeNotification(params);
      const after = new Date().toISOString();

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const { readdir } = await import('fs/promises');
      const files = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));

      expect(content.completed_at >= before).toBe(true);
      expect(content.completed_at <= after).toBe(true);
    });

    it('should not throw when write fails (graceful degradation)', async () => {
      // Create a NotificationManager pointing to a read-only path (will fail)
      const badNm = createNotificationManager({ changeDir: '/nonexistent-root-path-that-cannot-be-created/__test__' });
      // Should not throw
      await expect(badNm.writeNotification(makeWriteParams())).resolves.toBeUndefined();
    });

    it('should write notification with has_completion_signal field', async () => {
      const params = makeWriteParams({ has_completion_signal: true });
      await nm.writeNotification(params);

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const { readdir } = await import('fs/promises');
      const files = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));

      expect(content.has_completion_signal).toBe(true);
    });

    it('should write notification without has_completion_signal when not provided', async () => {
      const params = makeWriteParams();
      await nm.writeNotification(params);

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const { readdir } = await import('fs/promises');
      const files = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));

      expect(content.has_completion_signal).toBeUndefined();
    });

    it('should write notification with has_completion_signal=false', async () => {
      const params = makeWriteParams({ has_completion_signal: false });
      await nm.writeNotification(params);

      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const { readdir } = await import('fs/promises');
      const files = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      const content = JSON.parse(await readFile(join(notifDir, files[0]), 'utf-8'));

      expect(content.has_completion_signal).toBe(false);
    });
  });

  // ─── getPendingNotifications ────────────────────────────────────────────

  describe('getPendingNotifications', () => {
    it('should return empty array when no notifications exist', async () => {
      const pending = await nm.getPendingNotifications();
      expect(pending).toEqual([]);
    });

    it('should return empty array when directory does not exist', async () => {
      const badNm = createNotificationManager({ changeDir: join(TEST_TMP, 'nonexistent') });
      const pending = await badNm.getPendingNotifications();
      expect(pending).toEqual([]);
    });

    it('should return pending notifications', async () => {
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_001_1' }));
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_002_1' }));

      const pending = await nm.getPendingNotifications();
      expect(pending.length).toBe(2);
      const taskIds = pending.map(n => n.task_id).sort();
      expect(taskIds).toEqual(['sf_001_1', 'sf_002_1']);
    });

    it('should include all notification fields', async () => {
      await nm.writeNotification(makeWriteParams());

      const pending = await nm.getPendingNotifications();
      expect(pending.length).toBe(1);
      const n = pending[0];
      expect(n.type).toBe('sync_completed');
      expect(n.subagent).toBe('build-executor');
      expect(n.task_id).toBe('sf_1700000000_1');
      expect(n.session_id).toBe('sess_abc');
      expect(n.completed_at).toBeTruthy();
      expect(n.summary).toBe('Build completed successfully');
    });
  });

  // ─── consumeNotifications ───────────────────────────────────────────────

  describe('consumeNotifications', () => {
    it('should consume pending notifications and move them to consumed/', async () => {
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_100_1' }));
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_100_2' }));

      const consumed = await nm.consumeNotifications();
      expect(consumed.length).toBe(2);

      // Files should be moved to consumed/
      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const consumedDir = join(notifDir, 'consumed');
      const { readdir } = await import('fs/promises');

      const rootFiles = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      expect(rootFiles.length).toBe(0);

      const consumedFiles = (await readdir(consumedDir)).filter((f: string) => f.endsWith('.json'));
      expect(consumedFiles.length).toBe(2);
    });

    it('should return empty array when no pending notifications', async () => {
      const consumed = await nm.consumeNotifications();
      expect(consumed).toEqual([]);
    });

    it('should return empty array when directory does not exist', async () => {
      const badNm = createNotificationManager({ changeDir: join(TEST_TMP, 'nonexistent') });
      const consumed = await badNm.consumeNotifications();
      expect(consumed).toEqual([]);
    });

    it('should skip already consumed notifications (dedup)', async () => {
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_200_1' }));

      // Pre-create the same file in consumed/
      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const consumedDir = join(notifDir, 'consumed');
      await mkdir(consumedDir, { recursive: true });
      await writeFile(
        join(consumedDir, 'sf_200_1.json'),
        JSON.stringify({ type: 'sync_completed', task_id: 'sf_200_1' }),
      );

      const consumed = await nm.consumeNotifications();
      // Should skip the duplicate
      expect(consumed.length).toBe(0);

      // Root file should be cleaned up
      const { readdir } = await import('fs/promises');
      const rootFiles = (await readdir(notifDir)).filter((f: string) => f.endsWith('.json'));
      expect(rootFiles.length).toBe(0);
    });

    it('should consume new notification alongside existing consumed ones', async () => {
      // Pre-create a consumed notification
      const notifDir = join(TEST_TMP, '.flow-engine/sflow/notifications');
      const consumedDir = join(notifDir, 'consumed');
      await mkdir(consumedDir, { recursive: true });
      await writeFile(
        join(consumedDir, 'sf_100_1.json'),
        JSON.stringify({ type: 'sync_completed', task_id: 'sf_100_1' }),
      );

      // Write a new notification
      await nm.writeNotification(makeWriteParams({ task_id: 'sf_200_1' }));

      const consumed = await nm.consumeNotifications();
      expect(consumed.length).toBe(1);
      expect(consumed[0].task_id).toBe('sf_200_1');

      // sf_100_1 should still exist in consumed/
      const { readdir } = await import('fs/promises');
      const consumedFiles = (await readdir(consumedDir)).filter((f: string) => f.endsWith('.json'));
      expect(consumedFiles.sort()).toEqual(['sf_100_1.json', 'sf_200_1.json']);
    });

    it('should format consumed notifications with content', async () => {
      await nm.writeNotification(makeWriteParams({
        type: 'async_completed',
        subagent: 'verifier',
        task_id: 'sf_300_1',
        session_id: 'sess_xyz',
        summary: 'Verification passed',
      }));

      const consumed = await nm.consumeNotifications();
      expect(consumed.length).toBe(1);
      const c = consumed[0];
      expect(c.type).toBe('async_completed');
      expect(c.subagent).toBe('verifier');
      expect(c.task_id).toBe('sf_300_1');
      expect(c.session_id).toBe('sess_xyz');
      expect(c.summary).toBe('Verification passed');
      expect(c.completed_at).toBeTruthy();
    });
  });
});
