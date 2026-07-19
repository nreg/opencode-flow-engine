# Tasks: Phase 2 UI Design Enhancement

## File Structure

- Create: workflows/sflow/templates/UI-DESIGN.md — UI-DESIGN.md 标准化模板，包含 YAML frontmatter（OKLCH 颜色/字体/间距）和 9 个标准章节
- Modify: packages/core/src/validation/validator.ts — 新增 validateUiDesign 方法，实现 6 类验证检查
- Modify: packages/core/src/validation/constants.ts — 新增 AI_DEFAULT_FONTS、HEX_COLOR_REGEX 等验证常量
- Modify: packages/plugin-infra/src/features/builtin-mcp.ts — 在 createValidatorTools() 中新增 validate_ui_design 工具条目
- Modify: packages/plugin-infra/src/features/builtin-mcp.test.ts — 新增 validate_ui_design 测试用例
- Modify: workflows/sflow/agents/ui-director.ts — 在 Step 4 instructions 中新增 ui-ux-pro-max skill 调用引导

## Interfaces

### Batch 1 → Batch 2
- **Produces**: UI-DESIGN.md 模板文件 — Batch 2 的验证工具需要参考模板结构定义检查逻辑

### Batch 2 → Batch 3
- **Produces**: validate_ui_design 验证工具 — Batch 3 的 ui-director 集成需要确认验证工具已就绪

## Task Batch 1: P0 — UI-DESIGN.md 模板创建

- [ ] Task 1.1: 创建 workflows/sflow/templates/UI-DESIGN.md 文件 — 包含 YAML frontmatter（version/name/description/colors/typography/spacing），所有颜色值示例使用 oklch() 格式，包含 9 个标准章节（Visual Direction/Design Tokens/Component Architecture/Interaction Patterns/Responsive Breakpoints/Accessibility/Placeholder Strategy/Anti-AI-Slop Checklist/Do's and Don'ts），每个章节包含注释说明字段用途和约束 — read_files: workflows/sflow/templates/LESSONS.md, design-md/apple/DESIGN.md, design-md/stripe/DESIGN.md, design-md/vercel/DESIGN.md; write_files: workflows/sflow/templates/UI-DESIGN.md

## Task Batch 2: P0 — validate_ui_design 验证工具

Depends on: Batch 1

- [ ] Task 2.1: 修改 packages/core/src/validation/constants.ts — 新增 AI_DEFAULT_FONTS 常量数组（Inter/system-ui/Roboto/Arial/Helvetica Neue/-apple-system/Segoe UI），新增 HEX_COLOR_REGEX 正则（/#[0-9a-fA-F]{3,8}\b/g），新增 RGB_COLOR_REGEX 正则（/rgb\s*\(/gi），新增 HSL_COLOR_REGEX 正则（/hsl\s*\(/gi），新增 MIN_COMPONENT_CATEGORIES 常量（5），新增 MIN_ANTI_AI_SLOP_SCORE 常量（6），新增 TONE_KEYWORDS 常量数组（Minimal/Editorial/Brutalist/Corporate/Playful/Retro/Organic/Futuristic/Artisan） — read_files: packages/core/src/validation/constants.ts; write_files: packages/core/src/validation/constants.ts

- [ ] Task 2.2: 修改 packages/core/src/validation/validator.ts — 新增 validateUiDesign(content: string): ValidationReport 方法，实现 6 类检查：(1) 颜色格式检查：解析 frontmatter colors 字段和 Design Tokens 章节，匹配 HEX/RGB/HSL 正则，违规标记 ERROR；(2) 字体选择检查：解析 typography 字段，匹配 AI_DEFAULT_FONTS 列表，违规标记 ERROR；(3) 调性声明检查：解析 Visual Direction 章节，匹配 TONE_KEYWORDS，缺少标记 WARNING；(4) 组件规约检查：解析 Component Architecture 章节，统计组件类别数，<5 标记 WARNING；(5) 占位符策略检查：匹配 emoji 字符和编造数据模式，违规标记 ERROR；(6) 反 AI-slop 检查：解析 Anti-AI-Slop Checklist，统计 pass 数，<6/8 标记 WARNING — read_files: packages/core/src/validation/validator.ts, packages/core/src/validation/constants.ts, packages/core/src/validation/types.ts; write_files: packages/core/src/validation/validator.ts

- [ ] Task 2.3: 修改 packages/core/src/index.ts — 确保新增的 validateUiDesign 方法通过 sharedValidator 导出 — read_files: packages/core/src/index.ts; write_files: packages/core/src/index.ts

- [ ] Task 2.4: 修改 packages/plugin-infra/src/features/builtin-mcp.ts — 在 createValidatorTools() 函数中新增 validate_ui_design 条目，args 使用 zod schema（ui_design_path: z.string().optional()），execute 函数调用 sharedValidator.validateUiDesign(content)，返回 ValidationReport 格式结果 — read_files: packages/plugin-infra/src/features/builtin-mcp.ts; write_files: packages/plugin-infra/src/features/builtin-mcp.ts

- [ ] Task 2.5: 修改 packages/plugin-infra/src/features/builtin-mcp.test.ts — 新增 3 个测试用例：(1) validate_ui_design 工具键存在性检查；(2) 有效 ui-design.md 文件验证（创建包含 OKLCH 颜色和非默认字体的测试文件，验证返回 valid: true）；(3) 无效 ui-design.md 文件验证（创建包含 HEX 颜色和 Inter 字体的测试文件，验证返回 valid: false 和 ERROR 级别问题） — read_files: packages/plugin-infra/src/features/builtin-mcp.test.ts; write_files: packages/plugin-infra/src/features/builtin-mcp.test.ts

## Task Batch 3: P2 — ui-ux-pro-max 集成到 ui-director

Depends on: Batch 2

- [ ] Task 3.1: 修改 workflows/sflow/agents/ui-director.ts — 在 Step 4（5 维决策）的 instructions 中新增 ui-ux-pro-max skill 调用引导，具体修改：(1) 字体决策部分新增 "Primary path: skill('ui-ux-pro-max')" 引导，使用 python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain typography 搜索 56 个字体配对，回退使用内置字体决策矩阵；(2) 颜色决策部分新增 skill 调用引导，使用 python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain color 搜索 95+ 色板，所有 HEX 结果必须转换为 oklch() 格式，回退使用内置颜色决策矩阵；(3) 图表决策部分新增条件触发引导，当项目涉及数据可视化时使用 python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain chart 搜索 25 种图表；(4) 技术栈适配部分新增 skill 调用引导，使用 python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --stack <stack-name>；(5) 回退机制说明：skill 不可用时（Python 未安装/脚本超时/执行失败）回退到内置 5 维矩阵，在输出中标注 "fallback: skill unavailable" — read_files: workflows/sflow/agents/ui-director.ts, workflows/sflow/skills/ui-ux-pro-max/SKILL.md; write_files: workflows/sflow/agents/ui-director.ts
