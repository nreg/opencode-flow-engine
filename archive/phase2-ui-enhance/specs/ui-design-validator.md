# Spec: UI-Design Validator

## Purpose

定义 validate_ui_design 验证工具的功能需求，确保 ui-design.md 文件在 bridging 阶段之前通过自动化检查，捕获颜色格式违规、AI 默认字体选择、缺少调性声明、组件规约不足、emoji 占位符和反 AI-slop 检查不通过等问题。

## Requirements

### Requirement: Color Format Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 中所有颜色值使用 OKLCH 格式，将 HEX/RGB/HSL 格式标记为 ERROR 级别违规。

#### Scenario: All Colors in OKLCH Format

**Given:** 一个 ui-design.md 文件的所有颜色值使用 oklch() 格式
**When:** validate_ui_design 工具执行颜色格式检查
**Then:** 颜色格式检查项通过，报告 0 个 ERROR

#### Scenario: HEX Color Values Present

**Given:** 一个 ui-design.md 文件中存在颜色值 "#0066cc" 和 "#1d1d1f"
**When:** validate_ui_design 工具执行颜色格式检查
**Then:** 工具报告 2 个 ERROR 级别问题，每条包含具体的 HEX 值和行号，建议使用 oklch() 格式替代

#### Scenario: RGB and HSL Color Values

**Given:** 一个 ui-design.md 文件中存在 "rgb(0, 102, 204)" 和 "hsl(210, 100%, 40%)"
**When:** validate_ui_design 工具执行颜色格式检查
**Then:** 工具报告 2 个 ERROR 级别问题，提示非 OKLCH 格式

### Requirement: Font Selection Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 中的字体选择不在 AI 默认字体列表中，将使用 AI 默认字体标记为 ERROR 级别违规。

#### Scenario: Non-Default Font Selection

**Given:** 一个 ui-design.md 文件的字体声明为 "Geist, Space Grotesk, DM Sans"
**When:** validate_ui_design 工具执行字体检查
**Then:** 字体检查项通过，报告 0 个 ERROR

#### Scenario: Inter as Default Font

**Given:** 一个 ui-design.md 文件的 body 字体声明为 "Inter, system-ui, sans-serif"
**When:** validate_ui_design 工具执行字体检查
**Then:** 工具报告 ERROR 级别问题，提示 "Inter is an AI-default font, choose a distinctive alternative from 56 font pairings"

#### Scenario: System-UI as Identity Font

**Given:** 一个 ui-design.md 文件的 display 字体声明为 "system-ui, sans-serif"
**When:** validate_ui_design 工具执行字体检查
**Then:** 工具报告 ERROR 级别问题，提示 "system-ui cannot be used as identity font"

### Requirement: Tone Declaration Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 的 Visual Direction 章节包含明确的调性关键词，将缺少调性声明标记为 WARNING 级别违规。

#### Scenario: Explicit Tone Keywords Present

**Given:** 一个 ui-design.md 的 Visual Direction 章节声明 "Tone: Futuristic, Bold"
**When:** validate_ui_design 工具执行调性检查
**Then:** 调性检查项通过

#### Scenario: Missing Tone Declaration

**Given:** 一个 ui-design.md 的 Visual Direction 章节未包含调性关键词
**When:** validate_ui_design 工具执行调性检查
**Then:** 工具报告 WARNING 级别问题，提示 "Missing tone declaration in Visual Direction, specify at least one tone keyword"

#### Scenario: Vague Tone Declaration

**Given:** 一个 ui-design.md 的 Visual Direction 章节声明 "Tone: Good"
**When:** validate_ui_design 工具执行调性检查
**Then:** 工具报告 WARNING 级别问题，提示 "Vague tone keyword 'Good', use specific tone like Minimal/Editorial/Brutalist/Corporate/Playful/Retro/Organic/Futuristic/Artisan"

### Requirement: Component Specification Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 的 Component Architecture 章节至少定义 5 类组件，将组件定义不足标记为 WARNING 级别违规。

#### Scenario: Sufficient Component Categories

**Given:** 一个 ui-design.md 的 Component Architecture 章节定义了 Button、Card、Form、Navigation、Modal 共 5 类组件
**When:** validate_ui_design 工具执行组件检查
**Then:** 组件检查项通过

#### Scenario: Insufficient Component Categories

**Given:** 一个 ui-design.md 的 Component Architecture 章节仅定义了 Button 和 Card 共 2 类组件
**When:** validate_ui_design 工具执行组件检查
**Then:** 工具报告 WARNING 级别问题，提示 "Only 2 component categories defined, minimum 5 required"

### Requirement: Placeholder Strategy Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 的 Placeholder Strategy 章节不使用 emoji 占位符和编造数据，将违规标记为 ERROR 级别。

#### Scenario: No Emoji Placeholders

**Given:** 一个 ui-design.md 的 Placeholder Strategy 章节声明使用 Lucide 图标库
**When:** validate_ui_design 工具执行占位符检查
**Then:** 占位符检查项通过

#### Scenario: Emoji Placeholder in Component Description

**Given:** 一个 ui-design.md 的组件描述中包含 emoji 字符作为图标占位符
**When:** validate_ui_design 工具执行占位符检查
**Then:** 工具报告 ERROR 级别问题，提示 "Emoji placeholder detected, use SVG icons from a consistent icon library"

#### Scenario: Fabricated User Data

**Given:** 一个 ui-design.md 中包含编造的用户数据如 "John Doe, john@example.com"
**When:** validate_ui_design 工具执行占位符检查
**Then:** 工具报告 ERROR 级别问题，提示 "Fabricated data detected, use realistic placeholder patterns"

### Requirement: Anti-AI-Slop Score Validation

validate_ui_design 工具 SHALL 检查 ui-design.md 的 Anti-AI-Slop Checklist 至少 6/8 类检查通过，将不达标标记为 WARNING 级别违规。

#### Scenario: Passing Anti-AI-Slop Score

**Given:** 一个 ui-design.md 的 Anti-AI-Slop Checklist 中 7/8 类检查通过
**When:** validate_ui_design 工具执行反 AI-slop 检查
**Then:** 反 AI-slop 检查项通过

#### Scenario: Failing Anti-AI-Slop Score

**Given:** 一个 ui-design.md 的 Anti-AI-Slop Checklist 中仅 4/8 类检查通过
**When:** validate_ui_design 工具执行反 AI-slop 检查
**Then:** 工具报告 WARNING 级别问题，提示 "Anti-AI-Slop score 4/8 is below minimum threshold 6/8"

### Requirement: Tool Registration in BuiltinMcpRegistry

validate_ui_design 工具 SHALL 注册到 BuiltinMcpRegistry，通过 createValidatorTools() 函数导出，与现有验证工具（validate_spec、validate_proposal 等）保持一致的接口模式。

#### Scenario: Tool Available via BuiltinMcpRegistry

**Given:** BuiltinMcpRegistry 实例化完成
**When:** 调用 getTool('validate_ui_design')
**Then:** 返回有效的 ToolDefinition 对象

#### Scenario: Tool Execution with Valid File

**Given:** 一个通过所有检查的 ui-design.md 文件位于 .sflow/ui-design.md
**When:** 执行 validate_ui_design 工具
**Then:** 返回 { valid: true, summary: { errors: 0, warnings: 0, info: 0 } }

#### Scenario: Tool Execution with Missing File

**Given:** .sflow/ui-design.md 文件不存在
**When:** 执行 validate_ui_design 工具
**Then:** 返回 { valid: false, issues: [{ level: 'ERROR', path: 'file', message: 'UI design file not found: ...' }] }
