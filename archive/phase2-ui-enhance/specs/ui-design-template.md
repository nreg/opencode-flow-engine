# Spec: UI-DESIGN.md Template

## Purpose

定义 ui-design.md 的标准化模板结构，确保所有前端项目生成的 UI 设计文档格式一致、字段完整、颜色值使用 OKLCH 格式，使 ui-implementer 能够可靠地消费设计 token 并减少实现偏差。

## Requirements

### Requirement: Frontmatter Structure

UI-DESIGN.md 模板 SHALL 包含 YAML frontmatter，字段包括 version（模板版本号）、name（项目名称）、description（项目视觉描述）、colors（OKLCH 格式的颜色 token）、typography（字体 token）、spacing（间距 token）。

#### Scenario: Valid Frontmatter with OKLCH Colors

**Given:** 一个前端项目的 ui-design.md 文件
**When:** 文件包含完整的 YAML frontmatter
**Then:** frontmatter 中所有颜色值使用 oklch() 格式，包含 primary、ink、canvas、hairline 等核心色板 token

#### Scenario: Missing Frontmatter

**Given:** 一个前端项目的 ui-design.md 文件
**When:** 文件缺少 YAML frontmatter
**Then:** validate_ui_design 工具报告 ERROR 级别问题，提示缺少 frontmatter

### Requirement: Nine Standard Sections

UI-DESIGN.md 模板 SHALL 包含 9 个标准章节：Visual Direction、Design Tokens、Component Architecture、Interaction Patterns、Responsive Breakpoints、Accessibility、Placeholder Strategy、Anti-AI-Slop Checklist、Do's and Don'ts。

#### Scenario: All Nine Sections Present

**Given:** 一个使用模板生成的 ui-design.md 文件
**When:** 文件内容被解析
**Then:** 文件包含全部 9 个标准章节的二级标题

#### Scenario: Missing Required Section

**Given:** 一个 ui-design.md 文件缺少 Accessibility 章节
**When:** validate_ui_design 工具执行验证
**Then:** 工具报告 WARNING 级别问题，提示缺少 Accessibility 章节

### Requirement: OKLCH Color Format Enforcement

UI-DESIGN.md 模板 SHALL 强制所有颜色值使用 OKLCH 格式，禁止使用 HEX、RGB、HSL 等其他颜色格式。

#### Scenario: All Colors in OKLCH Format

**Given:** 一个 ui-design.md 文件的 Design Tokens 颜色部分
**When:** 所有颜色值使用 oklch() 格式声明
**Then:** validate_ui_design 工具的颜色格式检查通过

#### Scenario: HEX Color Value Detected

**Given:** 一个 ui-design.md 文件中存在颜色值 "#3B82F6"
**When:** validate_ui_design 工具执行颜色格式检查
**Then:** 工具报告 ERROR 级别问题，提示 "HEX color detected: #3B82F6, use oklch() format instead"

### Requirement: Design Reference Inheritance

UI-DESIGN.md 模板 SHALL 支持从 design-md/ 目录下的 71 个 DESIGN.md 参考文件继承 frontmatter 结构，保持 version/name/description/colors/typography/spacing 字段命名一致。

#### Scenario: Inheriting from Brand Reference

**Given:** 用户在 ui-director Step 1 中选择了 "Stripe" 品牌参考
**When:** ui-director 生成 ui-design.md
**Then:** frontmatter 的 colors 和 typography 字段结构与 design-md/stripe/DESIGN.md 保持命名一致（如 primary、ink、canvas、hairline）

#### Scenario: Custom Token Names Not in Reference

**Given:** 项目需要参考文件中未定义的自定义颜色 token
**When:** ui-director 生成 ui-design.md
**Then:** 自定义 token 名称遵循 kebab-case 命名规范，附加在参考结构之后

### Requirement: Anti-AI-Slop Checklist Section

UI-DESIGN.md 模板的 Anti-AI-Slop Checklist 章节 SHALL 包含 8 类检查项（字体/颜色/阴影/边框/动效/布局/文案/组件），每类标记 pass/fail 状态。

#### Scenario: Complete Anti-AI-Slop Checklist

**Given:** 一个使用模板生成的 ui-design.md 文件
**When:** Anti-AI-Slop Checklist 章节被解析
**Then:** 包含全部 8 类检查项，每类有明确的 pass/fail 标记

#### Scenario: Incomplete Anti-AI-Slop Checklist

**Given:** 一个 ui-design.md 文件的 Anti-AI-Slop Checklist 缺少 "动效" 类别
**When:** validate_ui_design 工具执行验证
**Then:** 工具报告 WARNING 级别问题，提示 Anti-AI-Slop 检查不完整

### Requirement: Placeholder Strategy Section

UI-DESIGN.md 模板的 Placeholder Strategy 章节 SHALL 明确声明占位符使用策略，禁止使用 emoji 作为图标占位符，禁止编造用户数据。

#### Scenario: Valid Placeholder Strategy

**Given:** 一个 ui-design.md 文件的 Placeholder Strategy 章节
**When:** 章节声明使用 SVG 图标库和真实数据源
**Then:** validate_ui_design 工具的占位符检查通过

#### Scenario: Emoji Placeholder Detected

**Given:** 一个 ui-design.md 文件中声明使用 emoji 作为图标占位符
**When:** validate_ui_design 工具执行占位符检查
**Then:** 工具报告 ERROR 级别问题，提示 "Emoji placeholder detected, use SVG icons instead"
