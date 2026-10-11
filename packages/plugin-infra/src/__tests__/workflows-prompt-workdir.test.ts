/**
 * P2-5：workflows 提示词 changeDir 用语同步守卫
 *
 * 背景：4 个工具（contract_validator / artifact_inspector / workflow_router /
 * iflow_router）的 JSON schema 已把参数更名为 `workDir`（required），底层函数
 * （archiveCleanup / addLesson）也已用 `workDir`，但 workflows/** 下 3 个文件
 * 仍指示模型传 `changeDir`——模型按提示词传参会因 schema 不识别而失败。
 *
 * 本守卫防止同类漏改再次发生：workflows 提示词中不得残留 `changeDir` 用语
 * （大小写敏感；`resolveChangeDir` 等标识符含大写 C，不受影响）。
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const WORKFLOWS_ROOT = join(import.meta.dir, '..', '..', '..', '..', 'workflows');

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('P2-5：workflows 提示词不得残留 changeDir 用语', () => {
  it('workflows/** 全部文件不含 changeDir（已统一为 workDir）', async () => {
    const files = await listFiles(WORKFLOWS_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (content.includes('changeDir')) {
        const lineNo = content.split('\n').findIndex((l) => l.includes('changeDir')) + 1;
        offenders.push(`${file}:${lineNo}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('关键提示词已点名 workDir：build-executor 的 saveCheckpoint 与 release-archivist 的 archiveCleanup/addLesson', async () => {
    const buildExecutor = await readFile(
      join(WORKFLOWS_ROOT, 'sflow', 'agents', 'build-executor.ts'),
      'utf-8',
    );
    expect(buildExecutor).toContain('saveCheckpoint(workDir');

    const releaseArchivist = await readFile(
      join(WORKFLOWS_ROOT, 'sflow', 'agents', 'release-archivist.ts'),
      'utf-8',
    );
    expect(releaseArchivist).toContain('archiveCleanup(workDir');
    expect(releaseArchivist).toContain('**workDir**');

    const lessonsNomination = await readFile(
      join(WORKFLOWS_ROOT, 'sflow', 'skills', 'release-archivist', 'references', 'lessons-nomination.md'),
      'utf-8',
    );
    expect(lessonsNomination).toContain('addLesson(workDir');
  });
});
