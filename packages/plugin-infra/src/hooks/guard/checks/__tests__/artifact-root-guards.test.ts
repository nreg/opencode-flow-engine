import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'node:path';
import {
  checkArtifactRootPath,
  extractWriteTargetPaths,
  extractPatchTextPaths,
  enforceArtifactRootPaths,
  GUARDED_WRITE_TOOLS,
} from '../artifact-root-guards.js';

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
    // 指引的正确工件目录必须是 <workDir>/.flow-engine/sflow（不得出现 .flow-engine/.flow-engine 双重拼接）
    expect(r.blockReason).toContain(join(WORK_DIR, '.flow-engine', 'sflow'));
    expect(r.blockReason).not.toContain('.flow-engine' + '/' + '.flow-engine');
    expect(r.blockReason).not.toContain('.flow-engine\\.flow-engine');
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

describe('extractWriteTargetPaths：写工具目标路径提取（多文件全路径语义）', () => {
  it('write/edit 从 filePath / path / file_path 提取（单元素数组）', () => {
    expect(extractWriteTargetPaths('write', { filePath: '/a/b.md' })).toEqual(['/a/b.md']);
    expect(extractWriteTargetPaths('edit', { path: '/a/b.md' })).toEqual(['/a/b.md']);
    expect(extractWriteTargetPaths('edit', { file_path: '/a/b.md' })).toEqual(['/a/b.md']);
  });

  it('apply_patch 从 patchText 的 *** Update File: 行头提取（真实 schema 仅 { patchText }）', () => {
    const patchText = [
      '*** Begin Patch',
      '*** Update File: .flow-engine/sflow/tasks.md',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');
    expect(extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR)).toEqual([
      join(WORK_DIR, '.flow-engine', 'sflow', 'tasks.md'),
    ]);
  });

  it('apply_patch 支持 *** Add File: / *** Delete File: 行头', () => {
    const addText = '*** Begin Patch\n*** Add File: .flow-engine/sflow/new.md\n+content\n*** End Patch';
    expect(extractWriteTargetPaths('apply_patch', { patchText: addText }, WORK_DIR)).toEqual([
      join(WORK_DIR, '.flow-engine', 'sflow', 'new.md'),
    ]);
    const delText = '*** Begin Patch\n*** Delete File: .flow-engine/sflow/old.md\n*** End Patch';
    expect(extractWriteTargetPaths('apply_patch', { patchText: delText }, WORK_DIR)).toEqual([
      join(WORK_DIR, '.flow-engine', 'sflow', 'old.md'),
    ]);
  });

  it('apply_patch 行头大小写不敏感且容忍前后空白', () => {
    const patchText = '   *** update file:    .flow-engine/sflow/x.md   \n@@\n-a\n+b';
    expect(extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR)).toEqual([
      join(WORK_DIR, '.flow-engine', 'sflow', 'x.md'),
    ]);
  });

  it('apply_patch 提取全部文件行头（多文件补丁不再只取首个）', () => {
    // Gate-4 修复：原"取首个命中"契约 → 全路径契约。
    // 多文件 patchText 若只校验首个行头，后续非法行头可绕过工件根守卫。
    const patchText = [
      '*** Begin Patch',
      '*** Update File: .flow-engine/sflow/first.md',
      '@@',
      '-a',
      '+b',
      '*** Update File: .flow-engine/sflow/second.md',
      '@@',
      '-c',
      '+d',
      '*** End Patch',
    ].join('\n');
    expect(extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR)).toEqual([
      join(WORK_DIR, '.flow-engine', 'sflow', 'first.md'),
      join(WORK_DIR, '.flow-engine', 'sflow', 'second.md'),
    ]);
  });

  it('apply_patch 绝对路径行头原样返回（不重复拼接 workDir）', () => {
    const abs = join(PROJECT_DIR, '.flow-engine', 'sflow', 'state.json');
    const patchText = `*** Begin Patch\n*** Update File: ${abs}\n@@\n-a\n+b\n*** End Patch`;
    expect(extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR)).toEqual([abs]);
  });

  it('apply_patch 无文件行头 / 非字符串 patchText 时返回空数组', () => {
    expect(extractWriteTargetPaths('apply_patch', { patchText: '*** Begin Patch\n@@\n-a\n+b' }, WORK_DIR)).toEqual([]);
    expect(extractWriteTargetPaths('apply_patch', {}, WORK_DIR)).toEqual([]);
    expect(extractWriteTargetPaths('apply_patch', { patchText: 42 }, WORK_DIR)).toEqual([]);
  });

  it('GUARDED_WRITE_TOOLS 仅含 OpenCode 1.19.0 真实存在的工具 ID', () => {
    // 二进制实证：工具注册表仅 write/edit/apply_patch；multiedit/patch 不存在
    expect([...GUARDED_WRITE_TOOLS].sort()).toEqual(['apply_patch', 'edit', 'write']);
  });

  it('不存在的工具 ID（multiedit / patch）不再被守卫覆盖', () => {
    expect(extractWriteTargetPaths('multiedit', { filePath: '/x/.flow-engine/y' })).toEqual([]);
    expect(extractWriteTargetPaths('patch', { filePath: '/x/.flow-engine/y' })).toEqual([]);
  });

  it('非写工具（read/bash/glob 等）返回空数组', () => {
    expect(extractWriteTargetPaths('read', { filePath: '/x' })).toEqual([]);
    expect(extractWriteTargetPaths('bash', { command: 'ls' })).toEqual([]);
    expect(extractWriteTargetPaths(undefined, { filePath: '/x' })).toEqual([]);
  });

  it('工具名大小写不敏感', () => {
    expect(extractWriteTargetPaths('Apply_Patch', { patchText: '*** Update File: a.md' })).toEqual(['a.md']);
    expect(extractWriteTargetPaths('WRITE', { filePath: '/a/b.md' })).toEqual(['/a/b.md']);
  });
});

describe('extractPatchTextPaths：patchText 全部行头路径提取', () => {
  it('提取 Add/Update/Delete 三类动词的全部行头路径', () => {
    const patchText = [
      '*** Begin Patch',
      '*** Add File: a.md',
      '+x',
      '*** Update File: b.md',
      '@@',
      '-1',
      '+2',
      '*** Delete File: c.md',
      '*** End Patch',
    ].join('\n');
    expect(extractPatchTextPaths(patchText)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('大小写不敏感且容忍行前后空白', () => {
    expect(extractPatchTextPaths('  *** add file:   a.md  \n*** DELETE FILE: b.md')).toEqual(['a.md', 'b.md']);
  });

  it('非字符串 / 空串 / 无行头 → 空数组', () => {
    expect(extractPatchTextPaths(42)).toEqual([]);
    expect(extractPatchTextPaths('')).toEqual([]);
    expect(extractPatchTextPaths('*** Begin Patch\n@@\n-a\n+b')).toEqual([]);
  });
});

describe('enforceArtifactRootPaths：多路径任一非法即阻断（Gate-4 修复）', () => {
  it('合法行头在前 + 非法行头在后（多文件）→ 阻断且点名非法路径', () => {
    const paths = [
      join(WORK_DIR, '.flow-engine', 'sflow', 'legal.md'),
      join(PROJECT_DIR, '.flow-engine', 'sflow', 'illegal.json'),
    ];
    expect(() => enforceArtifactRootPaths(paths, WORK_DIR, PROJECT_DIR)).toThrow(/工件目录锁定/);
    // 阻断消息必须点名 offending path（后续非法行头目标）
    expect(() => enforceArtifactRootPaths(paths, WORK_DIR, PROJECT_DIR)).toThrow(/illegal\.json/);
  });

  it('混合动词（Add 合法 + Delete 非法）→ 阻断', () => {
    const patchText = [
      '*** Begin Patch',
      '*** Add File: .flow-engine/sflow/new.md',
      '+content',
      '*** Delete File: opencode-flow-engine/.flow-engine/sflow/old.md',
      '*** End Patch',
    ].join('\n');
    const paths = extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR);
    expect(paths).toHaveLength(2);
    expect(() => enforceArtifactRootPaths(paths, WORK_DIR, PROJECT_DIR)).toThrow(/工件目录锁定/);
  });

  it('全部合法（多文件均落 workDir/.flow-engine）→ 放行不抛错', () => {
    const patchText = [
      '*** Begin Patch',
      '*** Add File: .flow-engine/sflow/a.md',
      '+a',
      '*** Update File: .flow-engine/sflow/b.md',
      '@@',
      '-x',
      '+y',
      '*** End Patch',
    ].join('\n');
    const paths = extractWriteTargetPaths('apply_patch', { patchText }, WORK_DIR);
    expect(paths).toHaveLength(2);
    expect(() => enforceArtifactRootPaths(paths, WORK_DIR)).not.toThrow();
  });

  it('空路径列表 → 不抛错（维持无行头返空语义下的放行）', () => {
    expect(() => enforceArtifactRootPaths([], WORK_DIR)).not.toThrow();
  });
});
