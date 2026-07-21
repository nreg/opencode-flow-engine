# Execution Contract: Phase 2 UI Design Schema & Delivery Checklist

**Change ID**: phase2-ui-enhance  
**Generated**: 2026-07-19  
**Status**: pending-approval  

---

## 1. Intent Lock

### Scope Boundary

**In Scope**:
- 创建 `workflows/sflow/templates/UI-DESIGN.md` 结构化模板，包含标准 frontmatter 和 9 个章节
- 在 `packages/plugin-infra/src/features/builtin-mcp.ts` 中新增 `validate_ui_design` 验证工具
- 在 `workflows/sflow/agents/ui-implementer.ts` 中追加 10 项提交前自检清单
- 在 `packages/core/src/validation/validator.ts` 中新增 `validateUiDesignContent` 验证方法
- 导出和注册 `validate_ui_design` 到 BuiltinMcpRegistry

**Out of Scope**:
- agnesmore 图像生成工具集成（后续 Phase）
- ui-director 代理的 agnes_image_generate / agnes_video_generate 访问（后续 Phase）
- IFlow 工作流的 UI 设计能力
- ui-director 代理本身的功能修改（已在 Phase 1 完成）
- ui-design.md OKLCH 颜色实时对比度计算（仅做格式校验，不做像素级验证）

### Scope Fence

| 维度 | 允许 | 禁止 |
|------|------|------|
| 模板新增 | UI-DESIGN.md（1 个模板文件） | 新增代理或 skill 文件 |
| 验证工具新增 | validate_ui_design（1 个工具） | 修改现有验证工具的行为 |
| 代理修改 | ui-implementer（追加自检清单） | 修改其他代理 |
| 核心验证器扩展 | validateUiDesignContent 方法 | 修改现有验证方法签名 |
| 依赖引入 | 无 | 新增 npm 包 |
| 破坏性变更 | 无 | 修改现有接口/类型签名 |

---

## 2. Approved Behavior

### P0: UI-DESIGN.md 结构化模板

**目标文件**: `workflows/sflow/templates/UI-DESIGN.md`

**Frontmatter 规范**:

```yaml
---
tone: <调性名称>  # 从 9 张调性卡片中选择
colors:
  primary: "oklch(<L> <C> <H>) / <HEX>"
  secondary: "oklch(<L> <C> <H>) / <HEX>"
  background: "oklch(<L> <C> <H>) / <HEX>"
  foreground: "oklch(<L> <C> <H>) / <HEX>"
  accent: "oklch(<L> <C> <H>) / <HEX>"
  success: "oklch(<L> <C> <H>) / <HEX>"
  error: "oklch(<L> <C> <H>) / <HEX>"
  warning: "oklch(<L> <C> <H>) / <HEX>"
typography:
  display: "<字体名称>"
  body: "<字体名称>"
  scale: "<比例名称，如 major-third / perfect-fourth>"
spacing:
  base_unit: "<基础单位，如 4px / 8px>"
  scale: "<间距倍数序列>"
---
```

**9 个章节结构**:

| # | 章节名称 | 内容要求 |
|---|---------|---------|
| 1 | Visual Direction | 调性声明、参考产品、核心情感、设计原则（3-5 条） |
| 2 | Design Tokens — Color System | OKLCH + HEX 双格式颜色定义，语义色完整 |
| 3 | Design Tokens — Typography | 显示/正文字体、字重体系、字号比例、行高范围 |
| 4 | Design Tokens — Spacing | 基础单位、间距倍数序列、布局密度声明 |
| 5 | Component Architecture | UI 树结构、关键组件规约（≥ 5 类） |
| 6 | Interaction Patterns | 缓动曲线、时长范围、触发条件、hover/focus/active 规约 |
| 7 | Responsive Breakpoints | 断点定义（sm/md/lg/xl/2xl）、布局策略 |
| 8 | Accessibility | WCAG AA 对比度声明、focus 策略、reduced-motion 策略 |
| 9 | Placeholder Strategy | 占位图片/文案策略、数据加载占位、空状态处理 |

**Anti-AI-Slop Checklist 章节**（第 10 章，可选）:
- 覆盖 8 类检查维度
- 每类标注通过/失败

**Do's and Don'ts 章节**（第 11 章，可选）:
- 基于 AGENTS.md 和 ui-implementer SKILL.md 的强制规则
- 包含禁止 border-left 装饰、禁止 # 号标签前缀等

### P0: validate_ui_design Schema 验证器

**目标文件**: `packages/plugin-infra/src/features/builtin-mcp.ts`（新增工具定义）

**验证规则**（7 项）:

| # | 检查项 | 级别 | 校验逻辑 |
|---|--------|------|---------|
| V1 | 颜色 OKLCH 格式 | ERROR | frontmatter colors 中每个值必须包含 `oklch(` 前缀 |
| V2 | 字体合规 | ERROR | typography.display 和 typography.body 不得为 Inter / Roboto / Arial |
| V3 | 调性声明存在 | ERROR | frontmatter tone 字段必须存在且非空 |
| V4 | 组件规约 ≥ 5 类 | WARNING | Component Architecture 章节列出 ≥ 5 种组件类型 |
| V5 | 占位符策略已定义 | WARNING | Placeholder Strategy 章节存在且非空 |
| V6 | 反 AI-slop ≥ 6/8 类覆盖 | WARNING | Anti-AI-Slop Checklist 覆盖 ≥ 6/8 维度 |
| V7 | WCAG AA 对比度 | INFO | Accessibility 章节包含 WCAG AA 声明 |

**验证器实现路径**:
1. 在 `packages/core/src/validation/validator.ts` 的 `Validator` 类中新增 `validateUiDesignContent(content: string): ValidationReport` 方法
2. 在 `packages/core/src/index.ts` 中导出（通过 sharedValidator 已自动导出）
3. 在 `packages/plugin-infra/src/features/builtin-mcp.ts` 的 `createValidatorTools()` 中新增 `validate_ui_design` 工具
4. 工具参数：`ui_design_path`（可选，默认 `<dir>/.flow-engine/sflow/ui-design.md`）

### P2: ui-implementer Delivery Checklist

**目标文件**: `workflows/sflow/agents/ui-implementer.ts`（追加到 instructions）

**10 项提交前自检清单**:

| # | 检查项 | 校验逻辑 |
|---|--------|---------|
| D1 | console.log 清除 | 代码中无 `console.log` / `console.debug` 残留 |
| D2 | 交互状态完备 | 所有组件实现 hover / focus / active / disabled / loading 态 |
| D3 | 无硬编码颜色 | 无直接 hex/hsl 值，全部使用 CSS 变量或设计 token |
| D4 | 无 const styles | 无内联 `const styles = { ... }` 或 `style={{ }}` 对象，使用 CSS Modules / Tailwind |
| D5 | 响应式适配 | 桌面/平板/手机三端布局测试通过 |
| D6 | prefers-reduced-motion | 所有动画提供 reduced-motion fallback |
| D7 | 表单 label | 所有表单控件有可见 label 或 aria-label |
| D8 | 图片 alt | 所有 `<img>` 有有意义的 alt 文本 |
| D9 | 焦点环可见 | 所有交互元素 focus 态可见（非 outline: none 无替代） |
| D10 | 无 scrollIntoView | 不使用 `element.scrollIntoView()` |

---

## 3. Design Constraints

### C1: 无新 npm 依赖
- 不引入新的 npm 包
- OKLCH 格式验证使用正则表达式实现（无需 chroma.js 等颜色库）
- 所有功能基于现有项目依赖实现

### C2: TypeScript strict 模式通过
- 所有新增代码必须通过 TypeScript strict 模式检查
- 无 `any` 类型使用
- 所有导入使用 `.js` 后缀（ESM 规范）

### C3: 无破坏性变更
- 现有验证工具的行为不变
- `createValidatorTools()` 返回的对象在原有键基础上新增，不修改原有键
- `BuiltinMcpRegistry` 构造函数行为不变（通过 spread 自动包含新工具）
- `Validator` 类的方法签名不变（仅新增方法）

### C4: 验证器架构一致性
- `validateUiDesignContent` 遵循与 `validateSpecContent`、`validateDesign` 等相同的方法签名模式
- 返回 `ValidationReport` 类型，复用 `createReport` 工具函数
- 检查项使用 `{ level, path, message }` 格式，与现有验证器一致

### C5: UI-DESIGN.md 模板格式
- 模板放置于 `workflows/sflow/templates/` 目录，与 LESSONS.md、PROGRESS.md 同级
- 模板使用 YAML frontmatter + Markdown 正文的混合格式
- 供 ui-director 代理在 Step 6 写 ui-design.md 时参考

### C6: ui-implementer 追加方式
- 10 项自检清单追加到 instructions 末尾，不修改现有内容
- 自检清单在 Phase 4 Quality Pass 之后、Guardrails 之前执行
- 自检清单格式与现有 8 类反 AI-slop 检查保持一致的表格风格

### C7: validate_ui_design 工具注册
- 在 `createValidatorTools()` 返回对象中新增 `validate_ui_design` 键
- 使用 `z.string()` 定义参数 schema，与现有工具保持一致
- 通过 `BuiltinMcpRegistry` 构造函数自动注册到工具集

---

## 4. Task Batches

### Batch 1: P0 — UI-DESIGN.md 模板 + 验证器核心

**依赖**: 无  
**产出**: UI-DESIGN.md 模板 + validateUiDesignContent 方法（Batch 2 依赖方法）

| Task | 文件 | 操作 | 验收标准 |
|------|------|------|---------|
| 1.1 | `workflows/sflow/templates/UI-DESIGN.md` | CREATE | 包含标准 frontmatter（tone, colors, typography, spacing）+ 9 个章节 + Anti-AI-Slop Checklist + Do's and Don'ts；颜色格式标注 OKLCH + HEX；章节标题与验收标准一致 |
| 1.2 | `packages/core/src/validation/validator.ts` | MODIFY | Validator 类新增 `validateUiDesignContent(content: string): ValidationReport` 方法；实现 7 项验证规则（V1-V7）；复用 `createReport` 工具函数；正则校验 OKLCH 格式为 `oklch(\s*\d+\.?\d*\s+\d+\.?\d*\s+\d+\.?\d*\s*)` |
| 1.3 | `packages/core/src/validation/validator.test.ts` | MODIFY | 新增 validateUiDesignContent 测试用例：合格模板通过、缺少 tone 失败、Inter 字体失败、OKLCH 格式错误失败、组件不足 5 类 warning、占位符缺失 warning、AI-slop 覆盖不足 warning |

**参考文件**:
- `workflows/sflow/templates/LESSONS.md` — 模板格式参考
- `packages/core/src/validation/validator.ts` — 验证器架构参考
- `packages/core/src/validation/validator.test.ts` — 测试模式参考
- `workflows/sflow/skills/ui-director/SKILL.md` — 调性卡片和设计决策参考

### Batch 2: P0 — 验证器工具注册 + P2 Delivery Checklist

**依赖**: Batch 1（需要 validateUiDesignContent 方法）  
**产出**: validate_ui_design 工具可用 + ui-implementer 自检清单

| Task | 文件 | 操作 | 验收标准 |
|------|------|------|---------|
| 2.1 | `packages/plugin-infra/src/features/builtin-mcp.ts` | MODIFY | `createValidatorTools()` 新增 `validate_ui_design` 工具；参数：`ui_design_path: z.string().optional()`；调用 `sharedValidator.validateUiDesignContent(content)`；默认路径 `<dir>/.flow-engine/sflow/ui-design.md` |
| 2.2 | `packages/plugin-infra/src/features/builtin-mcp.test.ts` | MODIFY | 新增 validate_ui_design 工具测试：读取合格文件通过、读取不合格文件报告错误、文件不存在返回 file-not-found |
| 2.3 | `workflows/sflow/agents/ui-implementer.ts` | MODIFY | instructions 在 "## Guardrails" 之前追加 "## Delivery Checklist (10-Item Pre-Commit)" 章节；包含 D1-D10 共 10 项自检清单表格；现有内容不变 |
| 2.4 | `workflows/sflow/skills/ui-implementer/SKILL.md` | MODIFY | 在 "## 质量检查清单" 之后追加 "## 11. 提交前 10 项自检清单" 章节；包含 D1-D10 的详细检查规则、违规示例和替代方案；现有内容不变 |

**参考文件**:
- `packages/plugin-infra/src/features/builtin-mcp.ts` — 工具定义模式参考
- `packages/plugin-infra/src/features/builtin-mcp.test.ts` — 测试模式参考
- `workflows/sflow/agents/ui-implementer.ts` — 追加位置参考
- `workflows/sflow/skills/ui-implementer/SKILL.md` — 追加位置参考

---

## Test Obligations

### TDD Requirements

本 Phase 遵循 TDD（Test-Driven Development）原则：核心验证逻辑（validateUiDesignContent）先写测试再实现。

### 5.1 编译时测试（每个 Batch 完成后）

| 测试项 | 标准 | 适用 Batch |
|--------|------|-----------|
| TypeScript strict 编译 | `npx tsc --noEmit` 零错误 | Batch 1, 2 |
| 无循环依赖 | import 链无循环引用 | Batch 1, 2 |

### 5.2 单元测试

| 测试项 | 标准 | 适用 Batch |
|--------|------|-----------|
| validateUiDesignContent 合格模板 | valid: true, 0 errors | Batch 1 |
| validateUiDesignContent 缺少 tone | valid: false, 包含 tone 相关 error | Batch 1 |
| validateUiDesignContent Inter 字体 | valid: false, 包含字体相关 error | Batch 1 |
| validateUiDesignContent OKLCH 格式错误 | valid: false, 包含颜色格式 error | Batch 1 |
| validateUiDesignContent 组件 < 5 | valid: true (WARNING), 包含 warning | Batch 1 |
| validateUiDesignContent 占位符缺失 | valid: true (WARNING), 包含 warning | Batch 1 |
| validateUiDesignContent AI-slop < 6/8 | valid: true (WARNING), 包含 warning | Batch 1 |
| validate_ui_design 工具文件存在 | 调用工具返回 valid: true | Batch 2 |
| validate_ui_design 工具文件不存在 | 调用工具返回 file-not-found error | Batch 2 |

### 5.3 内容完整性测试

| 测试项 | 标准 | 适用 Batch |
|--------|------|-----------|
| UI-DESIGN.md frontmatter | 包含 tone / colors / typography / spacing 字段 | Batch 1 |
| UI-DESIGN.md 9 章节 | Visual Direction / Design Tokens×3 / Component Architecture / Interaction Patterns / Responsive Breakpoints / Accessibility / Placeholder Strategy | Batch 1 |
| colors 字段 OKLCH 格式 | 每个颜色值包含 oklch() 前缀 | Batch 1 |
| ui-implementer Delivery Checklist | instructions 包含 D1-D10 共 10 项 | Batch 2 |
| SKILL.md Delivery Checklist | 第 11 节包含 10 项自检清单 | Batch 2 |

### 5.4 集成测试

| 测试项 | 标准 |
|--------|------|
| BuiltinMcpRegistry 包含 validate_ui_design | `registry.getTool('validate_ui_design')` 不为 undefined |
| validate_ui_design 可被 ui-director 调用 | AGENT_TOOLS['ui-director'] 或 skill 可触发该工具 |

---

## 6. Review Gates

### Gate 1: Batch 1 完成后
- **触发**: UI-DESIGN.md 模板 + validateUiDesignContent 方法创建完毕
- **检查项**:
  - TypeScript 编译通过
  - 模板 frontmatter 格式正确（tone / colors / typography / spacing）
  - 模板 9 章节完整
  - 验证器 7 项规则实现
  - 单元测试覆盖 7 种场景
- **通过条件**: 全部检查项通过
- **不通过处理**: 修正后重新检查

### Gate 2: Batch 2 完成后
- **触发**: validate_ui_design 工具注册 + ui-implementer 自检清单追加完毕
- **检查项**:
  - TypeScript 编译通过
  - `createValidatorTools()` 返回对象包含 validate_ui_design
  - `BuiltinMcpRegistry.getAllTools()` 包含 validate_ui_design
  - ui-implementer instructions 包含 10 项自检清单
  - SKILL.md 包含第 11 节
  - 无破坏性变更（现有工具不受影响）
- **通过条件**: 全部检查项通过
- **不通过处理**: 修正后重新检查

---

## 7. Acceptance Criteria

### 功能验收

| # | 验收标准 | 验证方法 |
|---|---------|---------|
| AC-1 | `workflows/sflow/templates/UI-DESIGN.md` 存在且包含 frontmatter + 9 章节 | 文件内容审查 |
| AC-2 | UI-DESIGN.md colors 字段所有值包含 OKLCH 格式 | 文件内容审查 |
| AC-3 | `Validator.validateUiDesignContent(validContent).valid === true` | 单元测试 |
| AC-4 | `Validator.validateUiDesignContent(missingTone).issues` 包含 tone ERROR | 单元测试 |
| AC-5 | `Validator.validateUiDesignContent(interFont).issues` 包含字体 ERROR | 单元测试 |
| AC-6 | `Validator.validateUiDesignContent(badOklch).issues` 包含 OKLCH ERROR | 单元测试 |
| AC-7 | `createValidatorTools()` 返回对象包含 `validate_ui_design` 键 | 单元测试 |
| AC-8 | `new BuiltinMcpRegistry().getTool('validate_ui_design')` 不为 undefined | 单元测试 |
| AC-9 | ui-implementer instructions 包含 "Delivery Checklist (10-Item Pre-Commit)" 章节 | 内容审查 |
| AC-10 | ui-implementer instructions D1-D10 共 10 项检查 | 内容审查 |
| AC-11 | SKILL.md 第 11 节包含 10 项自检清单 | 内容审查 |

### 非功能验收

| # | 验收标准 | 验证方法 |
|---|---------|---------|
| NFR-1 | TypeScript strict 模式编译零错误 | `npx tsc --noEmit` |
| NFR-2 | 无破坏性变更：现有验证工具行为不变 | 回归测试 |
| NFR-3 | 无新 npm 依赖 | package.json diff |
| NFR-4 | 无循环依赖 | 模块导入分析 |

---

## 8. Risk Mitigation

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| OKLCH 正则过于严格导致合法值被拒绝 | 验证器误报 | 使用宽松正则 `oklch(\s*[\d.]+\s+[\d.]+\s+[\d.]+)`；INFO 级别提示格式建议而非 ERROR 拒绝 |
| ui-implementer instructions 超出 token 限制 | 代理行为异常 | 10 项自检清单使用精炼表格格式，每项 1 行 |
| validateUiDesignContent 未导出到 sharedValidator | 工具调用失败 | Batch 1 中确认 sharedValidator 实例包含新方法（Validator 类方法自动可用） |
| UI-DESIGN.md 模板过长影响加载 | 性能问题 | 使用简洁的占位符说明，避免冗余 |
| BuiltinMcpRegistry 构造后 validate_ui_design 不可见 | 工具注册失败 | 构造函数使用 `{ ...createValidatorTools(), ...createWorkflowTools() }` spread，新增键自动包含 |

---

## 9. File Change Summary

### 新建文件（1 个）

| 文件路径 | Batch | 说明 |
|---------|-------|------|
| `workflows/sflow/templates/UI-DESIGN.md` | 1 | ui-design.md 结构化模板 |

### 修改文件（5 个）

| 文件路径 | Batch | 变更类型 | 变更说明 |
|---------|-------|---------|---------|
| `packages/core/src/validation/validator.ts` | 1 | INSERT | Validator 类新增 validateUiDesignContent 方法 |
| `packages/core/src/validation/validator.test.ts` | 1 | INSERT | 新增 validateUiDesignContent 测试用例 |
| `packages/plugin-infra/src/features/builtin-mcp.ts` | 2 | INSERT | createValidatorTools() 新增 validate_ui_design 工具 |
| `packages/plugin-infra/src/features/builtin-mcp.test.ts` | 2 | INSERT | 新增 validate_ui_design 测试用例 |
| `workflows/sflow/agents/ui-implementer.ts` | 2 | APPEND | instructions 追加 10 项自检清单 |
| `workflows/sflow/skills/ui-implementer/SKILL.md` | 2 | APPEND | 追加第 11 节自检清单 |

### 无需修改的文件

| 文件路径 | 原因 |
|---------|------|
| `packages/core/src/index.ts` | sharedValidator 是 Validator 实例，新方法自动可用 |
| `packages/plugin-infra/src/agents/types.ts` | 无新代理类型 |
| `packages/plugin-infra/src/agents/agent-builder.ts` | 无新代理注册 |
| `workflows/sflow/index.ts` | 无新导出 |
| `packages/plugin-infra/src/sflow-plugin-factory.ts` | 工具通过 BuiltinMcpRegistry 自动注册 |
