---
name: frontend-design-pro
description: 高级前端设计工作流，聚合 6 个子技能（趋势研究、情绪板、灵感分析、配色、字体、设计向导），用于创建有差异化、生产级的 UI 设计
---

# frontend-design-pro

frontend-design-pro 是 OpenCode 前端设计能力聚合入口，将 6 个独立子技能整合为一个可调用工作流，覆盖从趋势研究到最终设计输出的全链路。

## 子技能清单

| 子技能 | 路径 | 职责 |
|--------|------|------|
| trend-researcher | `skills/trend-researcher/SKILL.md` | 行业趋势研究，追踪设计风格演变与新兴模式 |
| moodboard-creator | `skills/moodboard-creator/SKILL.md` | 情绪板创建，将视觉灵感组织为可交流的参考板 |
| inspiration-analyzer | `skills/inspiration-analyzer/SKILL.md` | 灵感与竞品分析，从 live 网站提取设计决策依据 |
| color-curator | `skills/color-curator/SKILL.md` | 配色方案策划，提供理论支撑与可执行色板 |
| typography-selector | `skills/typography-selector/SKILL.md` | 字体配对选择，基于排版层次与可读性选择组合 |
| design-wizard | `skills/design-wizard/SKILL.md` | 交互式设计向导，引导完成完整设计方案（含参考文档） |

## 使用方式

根据当前任务阶段，按需用 read 工具读取对应子技能文件：

| 阶段 | 子技能 | 读取路径 |
|------|--------|----------|
| 一：探索与调研 | trend-researcher | `skills/trend-researcher/SKILL.md` |
| 二：情绪板与灵感整理 | moodboard-creator | `skills/moodboard-creator/SKILL.md` |
| 三：深度竞品/参考站分析 | inspiration-analyzer | `skills/inspiration-analyzer/SKILL.md` |
| 四：配色确定 | color-curator | `skills/color-curator/SKILL.md` |
| 五：字体与排版体系 | typography-selector | `skills/typography-selector/SKILL.md` |
| 六：输出完整设计方案 | design-wizard | `skills/design-wizard/SKILL.md` |

**重要说明**：
- OpenCode 不递归发现嵌套技能，必须使用 read 工具直接读取 `skills/<name>/SKILL.md` 文件路径
- 子技能路径相对于本 SKILL.md 所在目录（`skills/frontend-design-pro/`）
- 子技能附带的 `references/` 文档按需一并读取

## 降级策略

当浏览器能力受限（如无 live 网站分析权限）时：

- **跳过** live 网站抓取与分析（inspiration-analyzer、design-wizard 中依赖浏览器的步骤）
- **降级使用** 各子技能内置的 curated 色板与字体配对参考（color-curator、typography-selector）
- **直接输出** 基于已知约束的设计建议，注明"未经 live 参考站验证"
