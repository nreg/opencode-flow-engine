import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'node:path';
import { checkArtifactRootPath } from '../artifact-root-guards.js';

const WORK_DIR = resolve('E:/work/nreg/ai-agent');
const PROJECT_DIR = join(WORK_DIR, 'opencode-flow-engine');

describe('checkArtifactRootPath：工件根写路径守卫', () => {
  it('允许写入 workDir 工件根下的工件', () => {
    const r = checkArtifactRootPath({
      filePath: join(WORK_DIR, '.flow-engine', 'sflow', 'execution-contract.md'),
      workDir: WORK_DIR,
    });
    expect(r.block).toBe(false);
  });

  it('允许写入 workDir 工件根下的嵌套目录', () => {
    const r = checkArtifactRootPath({
      filePath: join(WORK_DIR, '.flow-engine', 'sflow', 'specs', 'auth.md'),
      workDir: WORK_DIR,
    });
    expect(r.block).toBe(false);
  });

  it('阻断在子项目目录（projectDir）下创建 .flow-engine', () => {
    const p = join(PROJECT_DIR, '.flow-engine', 'sflow', 'state.json');
    const r = checkArtifactRootPath({ filePath: p, workDir: WORK_DIR, projectDir: PROJECT_DIR });
    expect(r.block).toBe(true);
    expect(r.blockReason).toContain('.flow-engine');
    expect(r.blockReason).toContain(join(WORK_DIR, '.flow-engine'));
  });

  it('阻断任意 workDir 之外的 .flow-engine 写入（不只 projectDir）', () => {
    const r = checkArtifactRootPath({
      filePath: join('D:/other-project', '.flow-engine', 'sflow', 'state.json'),
      workDir: WORK_DIR,
    });
    expect(r.block).toBe(true);
  });

  it('放行与 .flow-engine 无关的普通写入', () => {
    const r = checkArtifactRootPath({
      filePath: join(PROJECT_DIR, 'src', 'index.ts'),
      workDir: WORK_DIR,
      projectDir: PROJECT_DIR,
    });
    expect(r.block).toBe(false);
  });

  it('放行文件名恰好含 flow-engine 但非 .flow-engine 目录', () => {
    const r = checkArtifactRootPath({
      filePath: join(PROJECT_DIR, 'src', 'flow-engine-utils.ts'),
      workDir: WORK_DIR,
      projectDir: PROJECT_DIR,
    });
    expect(r.block).toBe(false);
  });

  it('相对路径按 workDir 解析', () => {
    const r = checkArtifactRootPath({
      filePath: '.flow-engine/sflow/tasks.md',
      workDir: WORK_DIR,
    });
    expect(r.block).toBe(false);

    const bad = checkArtifactRootPath({
      filePath: 'opencode-flow-engine/.flow-engine/sflow/tasks.md',
      workDir: WORK_DIR,
    });
    expect(bad.block).toBe(true);
  });

  it('空路径 / 无 workDir 时不阻断（交由其它守卫处理）', () => {
    expect(checkArtifactRootPath({ filePath: '', workDir: WORK_DIR }).block).toBe(false);
    expect(checkArtifactRootPath({ filePath: join(PROJECT_DIR, '.flow-engine', 'x.json'), workDir: '' }).block).toBe(false);
  });

  it('大小写不敏感（Windows 路径）', () => {
    const r = checkArtifactRootPath({
      filePath: join(WORK_DIR, '.FLOW-ENGINE', 'sflow', 'x.md'),
      workDir: WORK_DIR,
    });
    expect(r.block).toBe(false);
  });
});