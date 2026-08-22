import { describe, it, expect } from 'bun:test';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

describe('install-skills CLI', () => {
  describe('源路径和默认行为验证', () => {
    it('应使用 skills/ 作为源目录（而非 workflows/sflow/skills）', async () => {
      // 读取 bin/flow-engine.js 源文件
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证关键行：sourceDir = join(pkgRoot, 'skills')
      expect(content).toContain("sourceDir = join(pkgRoot, 'skills')");
      
      // 验证不包含旧路径：workflows/sflow/skills
      const installSkillsSection = content.substring(
        content.indexOf('async function installSkillsCommand'),
        content.indexOf('async function installSkillsCommand') + 5000
      );
      
      // 确保在 installSkillsCommand 函数中没有 workflows/sflow/skills 路径
      expect(installSkillsSection).not.toContain("join(pkgRoot, 'workflows', 'sflow', 'skills')");
    });

    it('默认 filterPattern 应为 null（安装全部轨道 2 技能）', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证关键行：let filterPattern = null
      expect(content).toContain('let filterPattern = null; // 默认安装全部轨道 2 技能');
    });

    it('应支持 --filter 参数', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证 --filter 参数处理
      expect(content).toContain("const filterIndex = args.indexOf('--filter')");
      expect(content).toContain('filterPattern = args[filterIndex + 1]');
    });

    it('应支持 --all 参数', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证 --all 参数处理
      expect(content).toContain("if (args.includes('--all'))");
    });
  });

  describe('技能目录结构验证', () => {
    it('skills/ 目录应包含 18 个轨道 2 技能', async () => {
      const skillsDir = join(process.cwd(), 'skills');
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const skillDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      
      // 验证数量
      expect(skillDirs.length).toBe(18);
      
      // 验证关键技能存在
      const expectedSkills = [
        'taste-skill',
        'impeccable',
        'polish',
        'shadcn-ui',
        'svg-architect',
        'ui-ux-pro-max',
        'frontend-code-review',
        'frontend-design-pro',
        'frontend-performance-optimization',
        'design-reference',
        'gsap-core',
        'gsap-frameworks',
        'gsap-performance',
        'gsap-plugins',
        'gsap-react',
        'gsap-scrolltrigger',
        'gsap-timeline',
        'gsap-utils',
      ];
      
      for (const skill of expectedSkills) {
        expect(skillDirs).toContain(skill);
      }
    });

    it('每个轨道 2 技能目录应包含 SKILL.md 文件（或嵌套子技能）', async () => {
      const skillsDir = join(process.cwd(), 'skills');
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const skillDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      
      // 验证每个技能目录都有 SKILL.md（或嵌套子技能）
      for (const skillName of skillDirs) {
        const skillMdPath = join(skillsDir, skillName, 'SKILL.md');
        try {
          const content = await readFile(skillMdPath, 'utf-8');
          expect(content.length).toBeGreaterThan(0);
          expect(content).toContain('---'); // 应包含 frontmatter
        } catch (err) {
          // 如果没有 SKILL.md，检查是否是嵌套结构（如 frontend-design-pro）
          const subEntries = await readdir(join(skillsDir, skillName), { withFileTypes: true });
          const subDirs = subEntries.filter(e => e.isDirectory());
          
          if (subDirs.length > 0) {
            // 嵌套结构：验证子目录包含 SKILL.md
            for (const subDir of subDirs) {
              const subSkillMdPath = join(skillsDir, skillName, subDir.name, 'SKILL.md');
              try {
                const content = await readFile(subSkillMdPath, 'utf-8');
                expect(content.length).toBeGreaterThan(0);
                expect(content).toContain('---');
              } catch (subErr) {
                throw new Error(`${skillName}/${subDir.name} 缺少 SKILL.md 文件`);
              }
            }
          } else {
            throw new Error(`${skillName} 缺少 SKILL.md 文件`);
          }
        }
      }
    });

    it('workflows/sflow/skills/ 应仅包含 11 个轨道 1 技能', async () => {
      const track1Dir = join(process.cwd(), 'workflows', 'sflow', 'skills');
      const entries = await readdir(track1Dir, { withFileTypes: true });
      const skillDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
      
      // 验证数量
      expect(skillDirs.length).toBe(11);
      
      // 验证关键技能存在
      const expectedSkills = [
        'workflow-start',
        'need-explorer',
        'spec-writer',
        'contract-builder',
        'build-executor',
        'bug-investigator',
        'code-reviewer',
        'release-archivist',
        'spec-merger',
        'ui-director',
        'ui-implementer',
      ];
      
      for (const skill of expectedSkills) {
        expect(skillDirs).toContain(skill);
      }
      
      // 验证不包含轨道 2 技能
      expect(skillDirs).not.toContain('taste-skill');
      expect(skillDirs).not.toContain('impeccable');
      expect(skillDirs).not.toContain('gsap-core');
    });
  });

  describe('P1-2: 源目录验证', () => {
    it('应验证源目录名为 skills', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证包含目录名验证逻辑
      expect(content).toContain("if (sourceDirName !== 'skills')");
    });

    it('应检测并拒绝轨道 1 技能目录（workflows/sflow/skills）', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证包含轨道 1 检测逻辑
      expect(content).toContain("if (parentDirName === 'sflow')");
      expect(content).toContain('检测到轨道 1 技能目录');
      expect(content).toContain('禁止安装轨道 1 技能');
    });

    it('应验证父目录包含 package.json', async () => {
      const binPath = join(process.cwd(), 'bin', 'flow-engine.js');
      const content = await readFile(binPath, 'utf-8');
      
      // 验证包含 package.json 验证逻辑
      expect(content).toContain("const packageJsonPath = join(parentDir, 'package.json')");
      expect(content).toContain('源目录父路径不是有效的包根');
    });
  });
});
