# Spec: UI Implementer Enhancement

## Purpose

增强 ui-implementer 代理的反 AI-slop 检查能力，从当前 9 项视觉禁令扩展为覆盖字体、颜色、阴影、边框、动效、布局、文案、组件 8 大维度的系统性审查，确保 AI 生成的 UI 代码在品味和质量上达到专业水准。

## Requirements

### Requirement: Eight-Category Anti-AI-Slop Checks in Agent Instructions

ui-implementer 代理的 instructions SHALL 包含 8 类反 AI-slop 检查清单，作为 Phase 4 Quality Pass 的强制执行步骤。

#### Scenario: Typography Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行字体检查
**Then:** 代理 SHALL 检查：无 Inter 作为默认字体、无 system-ui 作为唯一字体栈、标题字重不超过 700、正文行高在 1.5-1.8 范围、标题 letter-spacing >= -0.04em、中文正文使用适合的字体

#### Scenario: Color Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行颜色检查
**Then:** 代理 SHALL 检查：无纯黑 #000000、无纯白 #FFFFFF 作为背景（使用 off-black/off-white）、强调色饱和度 < 80%、无 hardcoded 颜色值（全部使用 CSS 变量）、中性色基于品牌色调微偏、暗色模式对比度满足 WCAG AA

#### Scenario: Shadow Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行阴影检查
**Then:** 代理 SHALL 检查：阴影层级不超过 3 层、无超大扩散阴影（spread > 8px）、阴影颜色使用带透明度的黑（非纯黑）、同一页面阴影方向一致、hover 阴影变化是渐进的

#### Scenario: Border Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行边框检查
**Then:** 代理 SHALL 检查：无 border-left/right > 1px 作为装饰、边框颜色使用低对比度中性色、同一组件边框风格统一、无边框与阴影同时使用（选其一）、圆角值使用设计 token

#### Scenario: Motion Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行动效检查
**Then:** 代理 SHALL 检查：动效时长在 150ms-500ms 范围、无 linear 缓动（使用 ease-out 或 cubic-bezier）、尊重 prefers-reduced-motion、无 window.addEventListener('scroll')、hover 变换不超过 scale(1.05)

#### Scenario: Layout Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行布局检查
**Then:** 代理 SHALL 检查：间距使用基础倍数（4px/8px 体系）、无 magic number（如 z-index: 9999）、标题不溢出视口、响应式断点覆盖桌面/平板/手机、无固定像素宽度（使用 max-width 或百分比）

#### Scenario: Copy Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行文案检查
**Then:** 代理 SHALL 检查：无 Lorem ipsum 占位文案、按钮文案不超过 4 个字、标题层级不超过 4 级、无全大写英文标题（除品牌名）、中文文案无多余空格

#### Scenario: Component Check

**Given:** ui-implementer 进入 Phase 4 Quality Pass
**When:** 执行组件检查
**Then:** 代理 SHALL 检查：所有交互态已定义（hover/focus/active/disabled/loading）、无空状态闪现（使用 v-if）、表单有 label（非 placeholder）、一个项目只用一个图标库、组件库选型一致（不混用）

### Requirement: Skill File Enhancement

ui-implementer 的 SKILL.md SHALL 在现有 9 项视觉禁令基础上增加 8 大维度审查清单，与 agent instructions 保持一致。

#### Scenario: Skill File Updated

**Given:** skills/ui-implementer/SKILL.md 已存在
**When:** 更新后的 SKILL.md 被读取
**Then:** 文件 SHALL 包含新增的 8 大维度审查清单章节，每类检查列出具体规则、违规示例和替代方案

### Requirement: No Interface Signature Change

ui-implementer 代理的工厂函数签名 SHALL 保持不变，仍为 `AgentFactory` 类型。

#### Scenario: Backward Compatible

**Given:** 现有代码调用 createUiImplementerAgent
**When:** 增强后的 createUiImplementerAgent 被调用
**Then:** 函数签名 SHALL 与增强前完全一致：`(model: string, options?: { temperature?: number; skillContent?: string }) => AgentConfig`
