# Proposal: Phase 2 UI Design Enhancement — Template, Validator & Skill Integration

## Why

SFlow Phase 1 已成功引入 ui-director 代理和 7 步美学决策流程，但当前存在三个关键缺口：第一，ui-design.md 的输出格式缺少标准化模板，不同项目生成的文档结构不一致，ui-implementer 消费时需要猜测字段位置，导致实现偏差。现有 71 个 DESIGN.md 参考文件（design-md/ 目录）拥有成熟的 frontmatter 结构（version/name/description/colors/typography/spacing），但 ui-design.md 尚未继承该格式，也未强制 OKLCH 颜色格式，导致部分项目仍使用 HEX 值。第二，ui-design.md 缺少 schema 验证工具，颜色格式违规（如使用 HEX 而非 OKLCH）、AI 默认字体选择、缺少调性声明、组件规约不足、emoji 占位符、反 AI-slop 检查不通过等问题无法在 bridging 之前被自动捕获，只能延迟到实现阶段人工发现，增加返工成本。第三，ui-director 的 Step 4（5 维决策）目前仅依赖内置决策矩阵和 design-reference 库的 71 个品牌参考，缺少与 ui-ux-pro-max skill 的集成，无法利用其 56 个字体配对、95+ 色板、25 种图表和 12 种技术栈的专业推荐能力，导致字体和颜色决策的多样性和专业性不足。

## What Changes

### P0: UI-DESIGN.md 结构化模板
- 新建 `workflows/sflow/templates/UI-DESIGN.md`，定义标准 frontmatter 格式（OKLCH 颜色、字体、间距）
- 包含 9 个标准章节：Visual Direction / Design Tokens / Component Architecture / Interaction Patterns / Responsive Breakpoints / Accessibility / Placeholder Strategy / Anti-AI-Slop Checklist / Do's and Don'ts
- 所有颜色值强制 OKLCH 格式，禁止 HEX
- 参考文件：design-md/ 下的 71 个 DESIGN.md 的 frontmatter 结构

### P0: ui-design.md Schema 验证器
- 在 `packages/plugin-infra/src/features/builtin-mcp.ts` 中新增 `validate_ui_design` 工具
- 检查项：
  - 颜色格式：所有颜色值使用 OKLCH（🔴 Critical）
  - 字体选择：不在 AI 默认字体列表中（🔴 Critical）
  - 调性声明：必须有明确的调性关键词（🟡 Major）
  - 组件规约：至少定义 5 类组件（🟡 Major）
  - 占位符策略：禁止 emoji 占位、编造数据（🟡 Major）
  - 反 AI-slop：至少 6/8 类检查通过（🟡 Major）

### P2: ui-ux-pro-max 集成到 ui-director
- 修改 `workflows/sflow/agents/ui-director.ts`，在 Step 4（5 维决策）中新增 ui-ux-pro-max skill 调用
- 字体决策：skill("ui-ux-pro-max") → 从 56 个字体配对中推荐
- 颜色决策：从 95+ 色板中推荐
- 图表决策：从 25 种图表中推荐
- 技术栈适配：按项目栈推荐
- 回退：当 skill 不可用时使用内置 5 维矩阵

## Scope

### In Scope
- UI-DESIGN.md 标准化模板创建
- validate_ui_design 验证工具实现
- ui-director 与 ui-ux-pro-max skill 的集成
- builtin-mcp.test.ts 测试用例补充

### Out of Scope
- ui-design.md 的 agnesmore 图像生成集成（后续 Phase）
- IFlow 工作流的 UI 设计能力（不在本 Phase 范围）
- ui-implementer 的进一步增强（Phase 1 已完成）
- design-md/ 目录下现有 DESIGN.md 的 OKLCH 迁移（参考库保持原样）

## Impact

- **模板系统**：新增 1 个标准模板文件（UI-DESIGN.md）
- **验证工具**：新增 1 个验证工具（validate_ui_design），扩展 BuiltinMcpRegistry
- **代理系统**：修改 1 个现有 agent（ui-director）的 instructions
- **无破坏性变更**：现有验证工具接口签名不变，ui-director 的 skill 调用为新增逻辑
