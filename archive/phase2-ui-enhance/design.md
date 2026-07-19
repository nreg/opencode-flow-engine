# Design: Phase 2 UI Design Enhancement

## Architecture

### P0: UI-DESIGN.md 结构化模板

UI-DESIGN.md 模板是一个 Markdown 文件，位于 `workflows/sflow/templates/UI-DESIGN.md`，供 ui-director 在 Step 6（写 ui-design.md）时作为输出格式参考。

**模板结构**：

```
workflows/sflow/templates/UI-DESIGN.md
  → YAML frontmatter（version / name / description / colors / typography / spacing）
  → 9 个标准章节（## 级标题）
```

**Frontmatter 格式**（继承 design-md/ 的 71 个 DESIGN.md 结构）：

```yaml
---
version: alpha
name: <项目名称>
description: <项目视觉描述，50 字以上>
colors:
  primary: "oklch(0.55 0.2 260)"
  ink: "oklch(0.2 0.01 260)"
  canvas: "oklch(0.98 0.005 260)"
  hairline: "oklch(0.9 0.01 260)"
  # ... 更多颜色 token
typography:
  display:
    fontFamily: "<字体族>"
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  body:
    fontFamily: "<字体族>"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
spacing:
  base: 8px
  scale: [4, 8, 12, 16, 24, 32, 48, 64]
---
```

**9 个标准章节**：

| 章节 | 内容 | 必填 |
|------|------|------|
| Visual Direction | 调性、参考品牌、4 问美学框架答案 | 是 |
| Design Tokens | 颜色/字体/动效/空间/质感的 token 定义 | 是 |
| Component Architecture | 组件库选择、关键组件模式、交互状态 | 是 |
| Interaction Patterns | 用户流程、交互模式、状态转换 | 是 |
| Responsive Breakpoints | 断点定义、响应式行为 | 是 |
| Accessibility | WCAG 2.1 AA 合规、焦点管理、屏幕阅读器 | 是 |
| Placeholder Strategy | 占位符使用策略、禁止 emoji/编造数据 | 是 |
| Anti-AI-Slop Checklist | 8 类检查项的 pass/fail 状态 | 是 |
| Do's and Don'ts | 项目特定的设计规范 | 否 |

**OKLCH 强制规则**：
- frontmatter 的 colors 字段中所有值必须使用 `oklch()` 格式
- Design Tokens 章节中的颜色定义必须使用 `oklch()` 格式
- 禁止出现 HEX（#xxxxxx）、RGB（rgb()）、HSL（hsl()）格式

### P0: ui-design.md Schema 验证器

validate_ui_design 是一个新的验证工具，注册到 BuiltinMcpRegistry，遵循现有验证工具的接口模式。

**工具架构**：

```
packages/plugin-infra/src/features/builtin-mcp.ts
  → createValidatorTools() 新增 validate_ui_design 条目
  → execute 函数读取 ui-design.md 文件内容
  → 调用 sharedValidator.validateUiDesign(content) 执行验证
  → 返回 ValidationReport 格式结果
```

**验证检查项与严重级别**：

| 检查项 | 严重级别 | 检查逻辑 |
|--------|---------|---------|
| 颜色格式 | ERROR（🔴 Critical） | 正则匹配 HEX/RGB/HSL 格式，所有颜色值必须为 oklch() |
| 字体选择 | ERROR（🔴 Critical） | 检查 AI 默认字体列表（Inter/system-ui/Roboto/Arial），匹配则报错 |
| 调性声明 | WARNING（🟡 Major） | 检查 Visual Direction 章节包含调性关键词 |
| 组件规约 | WARNING（🟡 Major） | 统计 Component Architecture 章节的组件类别数，≥5 通过 |
| 占位符策略 | WARNING（🟡 Major） | 检查 emoji 字符和编造数据模式 |
| 反 AI-slop | WARNING（🟡 Major） | 统计 Anti-AI-Slop Checklist 的 pass 数，≥6/8 通过 |

**AI 默认字体列表**（硬编码常量）：

```typescript
const AI_DEFAULT_FONTS = [
  'Inter',
  'system-ui',
  'Roboto',
  'Arial',
  'Helvetica Neue',
  '-apple-system',
  'Segoe UI',
];
```

**HEX 颜色检测正则**：

```typescript
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_COLOR_REGEX = /rgb\s*\(/gi;
const HSL_COLOR_REGEX = /hsl\s*\(/gi;
```

**验证流程**：

```
1. 读取 .sflow/ui-design.md 文件
2. 解析 YAML frontmatter（colors 字段）
3. 解析正文各章节
4. 执行 6 类检查
5. 汇总 ValidationReport
6. 返回结果
```

**核心验证逻辑位置**：
- 验证逻辑实现于 `packages/core/src/validation/validator.ts`，新增 `validateUiDesign(content: string): ValidationReport` 方法
- 工具注册于 `packages/plugin-infra/src/features/builtin-mcp.ts`，新增 `validate_ui_design` 条目
- 测试用例追加于 `packages/plugin-infra/src/features/builtin-mcp.test.ts`

### P2: ui-ux-pro-max 集成到 ui-director

在 ui-director 的 Step 4（5 维决策）中新增 ui-ux-pro-max skill 调用，增强字体和颜色决策的专业性。

**集成架构**：

```
workflows/sflow/agents/ui-director.ts
  → Step 4 instructions 修改：
    → 字体决策：新增 skill("ui-ux-pro-max") 调用引导
    → 颜色决策：新增 skill("ui-ux-pro-max") 调用引导
    → 图表决策：新增 skill("ui-ux-pro-max") 调用引导（条件触发）
    → 技术栈适配：新增 skill("ui-ux-pro-max") 调用引导
    → 回退机制：skill 不可用时使用内置 5 维矩阵
```

**Skill 调用方式**（在 instructions 中引导 LLM 执行）：

```bash
# 字体 + 颜色 + 风格综合推荐
python3 ${SKILL_ROOT}/scripts/search.py "<项目类型> <行业> <关键词>" --design-system -p "<项目名>"

# 单独字体搜索
python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain typography -n 5

# 单独颜色搜索
python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain color -n 5

# 图表推荐
python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --domain chart -n 5

# 技术栈适配
python3 ${SKILL_ROOT}/scripts/search.py "<关键词>" --stack <stack-name>
```

**回退策略**：

```
skill 可用 → 使用 skill 推荐结果 → 转换 HEX 为 OKLCH → 写入 ui-design.md
skill 不可用 → 使用内置 5 维矩阵 → 标注 "fallback: skill unavailable" → 写入 ui-design.md
```

**HEX 到 OKLCH 转换**：
- ui-director 的 instructions 中引导 LLM 将 skill 返回的 HEX 颜色值转换为 oklch() 格式
- 不引入新的 npm 包，使用 LLM 的颜色转换能力
- 提供标准转换参考表（常见 HEX → OKLCH 映射）

**修改范围**：
- 仅修改 `workflows/sflow/agents/ui-director.ts` 的 instructions 字符串
- 不修改 ui-director 的工具集、温度、模型等配置
- 不修改 ui-ux-pro-max skill 本身

## Constraints

1. **无破坏性变更**：现有验证工具接口签名不变，ui-director 的工厂函数签名不变，BuiltinMcpRegistry 的现有方法不变。
2. **TypeScript 严格模式**：所有新增代码必须通过 TypeScript strict 模式检查。
3. **不引入新 npm 包**：HEX 到 OKLCH 的转换不使用第三方库，依赖 LLM 的颜色转换能力或硬编码参考表。
4. **验证工具模式一致性**：validate_ui_design 必须遵循现有验证工具的接口模式（ToolDefinition + zod args + execute 函数 + ValidationReport 返回）。
5. **Skill 调用为引导式**：ui-ux-pro-max 的集成通过修改 instructions 引导 LLM 调用 skill，而非在代码层面硬编码 skill 调用。
6. **OKLCH 强制**：UI-DESIGN.md 模板和 validate_ui_design 工具共同确保所有颜色值为 OKLCH 格式。
7. **优雅降级**：ui-ux-pro-max skill 不可用时，ui-director 必须能正常完成 Step 4，不阻塞工作流。

## Implementation Approach

### Phase 1: P0 — UI-DESIGN.md 模板创建

1. 创建 `workflows/sflow/templates/UI-DESIGN.md`，定义完整的 frontmatter 格式和 9 个标准章节
2. 模板中所有颜色值示例使用 oklch() 格式
3. 模板中包含注释说明每个字段的用途和约束

### Phase 2: P0 — validate_ui_design 验证工具

1. 在 `packages/core/src/validation/validator.ts` 中新增 `validateUiDesign` 方法
2. 在 `packages/core/src/validation/constants.ts` 中新增验证常量（AI_DEFAULT_FONTS、颜色正则等）
3. 在 `packages/plugin-infra/src/features/builtin-mcp.ts` 的 `createValidatorTools()` 中新增 `validate_ui_design` 条目
4. 在 `packages/plugin-infra/src/features/builtin-mcp.test.ts` 中新增测试用例

### Phase 3: P2 — ui-ux-pro-max 集成

1. 修改 `workflows/sflow/agents/ui-director.ts` 的 instructions，在 Step 4 中新增 skill 调用引导
2. 字体决策：新增 skill("ui-ux-pro-max") → typography 搜索引导
3. 颜色决策：新增 skill("ui-ux-pro-max") → color 搜索引导 + HEX→OKLCH 转换说明
4. 图表决策：新增 skill("ui-ux-pro-max") → chart 搜索引导（条件触发）
5. 技术栈适配：新增 skill("ui-ux-pro-max") → stack 搜索引导
6. 回退机制：新增 skill 不可用时的回退逻辑说明
