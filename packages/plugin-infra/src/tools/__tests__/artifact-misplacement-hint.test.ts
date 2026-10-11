/**
 * 工件错位提示：工件不在工件目录时，提示它实际落在哪个子项目目录。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContractValidatorTool } from '../contract-validator.js';
import { createArtifactInspectorTool } from '../artifact-inspector.js';

let workDir: string;
let projectDir: string;

/** 在 <workDir>/<projectDir>/.flow-engine/sflow/ 下放一份工件，模拟子代理写错位置 */
async function seedMisplacedArtifact(artifactName: string): Promise<void> {
  const dir = join(projectDir, '.flow-engine', 'sflow');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, artifactName), '# placeholder\n', 'utf-8');
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'misplace-work-'));
  projectDir = join(workDir, 'my-sub-project');
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('contract_validator：execution-contract.md 错位提示', () => {
  it('工件错位在子项目目录时，报出实际所在目录并要求迁移', async () => {
    await seedMisplacedArtifact('execution-contract.md');

    const tool = createContractValidatorTool();
    const result = await tool.execute(
      { workDir: workDir },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);
    const rec: string = parsed.recommendations[0];

    expect(rec).toContain(projectDir);
    expect(rec).toContain('请迁移或重新生成');
    expect(rec).toContain(join(workDir, '.flow-engine', 'sflow'));
    expect(rec).toContain('execution-contract.md');
  });

  it('未命中错位时保留原建议，并附工件目录说明', async () => {
    const tool = createContractValidatorTool();
    const result = await tool.execute(
      { workDir: workDir },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);
    const rec: string = parsed.recommendations[0];

    expect(rec).toContain('run contract-builder to create the contract');
    expect(rec).toContain(join(workDir, '.flow-engine', 'sflow'));
  });
});

describe('artifact_inspector：File not found 错位提示', () => {
  it('proposal 错位时结果里带出实际目录与迁移提示', async () => {
    await seedMisplacedArtifact('proposal.md');

    const tool = createArtifactInspectorTool();
    const result = await tool.execute(
      { workDir: workDir, artifactType: 'proposal' },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);
    const err: string = parsed.results.proposal.error;

    expect(err).toContain('proposal.md');
    expect(err).toContain(projectDir);
    expect(err).toContain('请迁移或重新生成');
    expect(err).toContain(join(workDir, '.flow-engine', 'sflow'));
  });

  it('design 错位时同样给出提示', async () => {
    await seedMisplacedArtifact('design.md');

    const tool = createArtifactInspectorTool();
    const result = await tool.execute(
      { workDir: workDir, artifactType: 'design' },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);

    expect(parsed.results.design.error).toContain(projectDir);
    expect(parsed.results.design.error).toContain('请迁移或重新生成');
  });

  it('tasks 错位时同样给出提示', async () => {
    await seedMisplacedArtifact('tasks.md');

    const tool = createArtifactInspectorTool();
    const result = await tool.execute(
      { workDir: workDir, artifactType: 'tasks' },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);

    expect(parsed.results.tasks.error).toContain(projectDir);
  });

  it('ui-design 错位时同样给出提示', async () => {
    await seedMisplacedArtifact('ui-design.md');

    const tool = createArtifactInspectorTool();
    const result = await tool.execute(
      { workDir: workDir, artifactType: 'ui-design' },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);

    expect(parsed.results['ui-design'].error).toContain(projectDir);
  });

  it('未命中错位时保留 File not found 语义并附工件目录说明', async () => {
    const tool = createArtifactInspectorTool();
    const result = await tool.execute(
      { workDir: workDir, artifactType: 'proposal' },
      { directory: workDir } as never,
    );
    const parsed = JSON.parse(result.output);

    expect(parsed.results.proposal.error).toContain('File not found');
    expect(parsed.results.proposal.error).toContain(join(workDir, '.flow-engine', 'sflow'));
  });
});