# Spec: UI Director Agent

## Purpose

ui-director 是 SFlow 工作流中专为前端项目设计的美学决策子代理，负责在 specifying 和 bridging 之间执行系统化的 UI 设计决策流程，生成品味可控的 ui-design.md 文档，避免 AI 生成界面的模板化和同质化问题。

## Requirements

### Requirement: Agent Factory Function

系统 SHALL 提供 `createUiDirectorAgent` 工厂函数，遵循 AgentFactory 类型签名，接受 model 和 options 参数，返回 AgentConfig 对象。

#### Scenario: Standard Agent Creation

**Given:** 系统启动时需要注册所有 SFlow 代理
**When:** 调用 `createUiDirectorAgent(model, options)` 
**Then:** 返回包含 id='ui-director'、name='UI Director'、model、instructions、temperature、tools 的完整 AgentConfig 对象

#### Scenario: With Skill Content

**Given:** skills/ui-director/SKILL.md 文件存在
**When:** createUiDirectorAgent 被调用且 skillContent 参数有值
**Then:** instructions 中 SHALL 包含 Skill-Specific Instructions 段落

### Requirement: Seven-Step Aesthetic Decision Flow

ui-director 代理的 instructions SHALL 包含完整的 7 步美学决策流程，按顺序执行：调性确认、4 问美学框架、brownfield 视觉对齐、5 维决策、v0 草稿确认、写 ui-design.md、反 AI-slop 自检。

#### Scenario: Tone Confirmation Step

**Given:** ui-director 被调度执行
**When:** 进入第 1 步调性确认
**Then:** 代理 SHALL 向用户展示 9 张调性卡片（Minimal、Editorial、Brutalist、Corporate、Playful、Retro、Organic、Futuristic、Artisan），用户选定后锁定调性方向

#### Scenario: Four-Question Aesthetic Framework

**Given:** 调性已确认
**When:** 进入第 2 步 4 问美学框架
**Then:** 代理 SHALL 依次回答 4 个问题：目的（这个界面要做什么）、调性（应该给人什么感觉）、约束（技术/品牌/受众限制）、差异化（与竞品的视觉区别）

#### Scenario: Brownfield Visual Alignment

**Given:** 项目已有现有前端代码（brownfield 项目）
**When:** 进入第 3 步 brownfield 视觉对齐
**Then:** 代理 SHALL 执行 7 项视觉语汇挖掘：现有色板提取、字体栈分析、间距规律识别、组件风格归纳、动效模式总结、图标风格确认、暗色模式适配状态

#### Scenario: Greenfield Project Skip

**Given:** 项目是全新前端项目（greenfield），无现有代码
**When:** 进入第 3 步 brownfield 视觉对齐
**Then:** 代理 SHALL 跳过 brownfield 步骤，直接进入 5 维决策

#### Scenario: Five-Dimension Decision

**Given:** 调性确认和 brownfield 对齐（如适用）已完成
**When:** 进入第 4 步 5 维决策
**Then:** 代理 SHALL 在字体、颜色、动效、空间、质感 5 个维度上做出具体决策，输出设计 token 候选值

#### Scenario: V0 Draft Confirmation

**Given:** 5 维决策完成
**When:** 进入第 5 步 v0 草稿确认
**Then:** 代理 SHALL 生成一份 v0 草稿（包含关键页面的设计 token 概览），等待用户确认或调整

#### Scenario: Write ui-design.md

**Given:** v0 草稿已获用户确认
**When:** 进入第 6 步写 ui-design.md
**Then:** 代理 SHALL 将所有设计决策写入 .sflow/ui-design.md，包含 Visual Direction、Design Tokens（Color/Type/Spacing/Border Radius/Shadows）、Component Architecture、Anti-AI-Slop Checklist 等结构化章节

#### Scenario: Anti-AI-Slop Self-Check

**Given:** ui-design.md 已生成
**When:** 进入第 7 步反 AI-slop 自检
**Then:** 代理 SHALL 对 ui-design.md 执行 8 类检查（字体/颜色/阴影/边框/动效/布局/文案/组件），标记所有违规项并修正

### Requirement: Agent Tool Permissions

ui-director 代理 SHALL 获得与 spec-writer 相同的工具集，包括 read、write、edit、glob、grep、bash、skill，用于读取项目代码和写入 ui-design.md。

#### Scenario: Tool Set Configuration

**Given:** ui-director 代理被创建
**When:** 调用 getAgentTools('ui-director')
**Then:** 返回的工具列表 SHALL 包含 read、write、edit、glob、grep、bash、skill 工具

### Requirement: Skill File

系统 SHALL 提供 `workflows/sflow/skills/ui-director/SKILL.md` 技能文件，包含调性卡片定义、美学框架模板、brownfield 挖掘清单、5 维决策矩阵、反 AI-slop 8 类检查清单。

#### Scenario: Skill File Content

**Given:** skills/ui-director/SKILL.md 文件存在
**When:** 技能加载器读取该文件
**Then:** 内容 SHALL 包含：9 张调性卡片的详细描述、4 问美学框架的引导问题、7 项 brownfield 挖掘清单、5 维决策矩阵（每维的选项范围和推荐值）、8 类反 AI-slop 检查清单

### Requirement: Report Back Format

ui-director 完成工作后 SHALL 向 sFlow 编排器返回结构化报告，包含设计决策摘要、ui-design.md 文件路径、8 类检查结果、状态转换建议。

#### Scenario: Successful Completion

**Given:** ui-director 完成了 7 步流程并生成了 ui-design.md
**When:** 代理向编排器报告
**Then:** 报告 SHALL 包含：调性选择结果、5 维决策摘要、ui-design.md 路径、8 类检查通过/失败状态、建议转换到 bridging 状态

#### Scenario: User Rejected Draft

**Given:** 用户拒绝了 v0 草稿
**When:** 代理向编排器报告
**Then:** 报告 SHALL 包含：用户反馈摘要、需要调整的维度、建议停留在 ui-design 状态等待重新执行
