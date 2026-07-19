# Spec: UI-UX-Pro-Max Integration

## Purpose

定义 ui-director 代理与 ui-ux-pro-max skill 的集成需求，使 Step 4（5 维决策）能够利用 skill 的 56 个字体配对、95+ 色板、25 种图表和 12 种技术栈的专业推荐能力，提升字体和颜色决策的多样性和专业性。

## Requirements

### Requirement: Skill Invocation in Step 4

ui-director 的 Step 4（5 维决策）SHALL 在字体和颜色决策时调用 ui-ux-pro-max skill，使用 Python 脚本搜索推荐结果。

#### Scenario: Successful Skill Invocation for Font Decision

**Given:** ui-director 执行到 Step 4 的字体决策环节
**When:** skill("ui-ux-pro-max") 可用且 Python 3 已安装
**Then:** ui-director 调用 search.py --design-system 获取字体配对推荐，从 56 个配对中选择最匹配项目调性的方案

#### Scenario: Successful Skill Invocation for Color Decision

**Given:** ui-director 执行到 Step 4 的颜色决策环节
**When:** skill("ui-ux-pro-max") 可用且 Python 3 已安装
**Then:** ui-director 调用 search.py --domain color 获取色板推荐，从 95+ 色板中选择最匹配项目类型和行业的方案

#### Scenario: Skill Not Available Fallback

**Given:** ui-director 执行到 Step 4 的字体决策环节
**When:** skill("ui-ux-pro-max") 不可用（Python 未安装或脚本执行失败）
**Then:** ui-director 回退到内置 5 维矩阵进行字体和颜色决策，在输出中标注 "fallback: skill unavailable"

### Requirement: Typography Recommendation from Skill

ui-director SHALL 使用 ui-ux-pro-max skill 的 typography.csv 数据（56 个字体配对）进行字体推荐，优先于内置的字体决策矩阵。

#### Scenario: Tech Startup Font Pairing

**Given:** 项目类型为 "Tech Startup"，调性为 "Futuristic"
**When:** ui-director 调用 skill 的字体搜索
**Then:** 推荐结果包含 Space Grotesk + DM Sans 配对，附带 Google Fonts URL 和 Tailwind Config

#### Scenario: Luxury Brand Font Pairing

**Given:** 项目类型为 "Luxury E-commerce"，调性为 "Minimal"
**When:** ui-director 调用 skill 的字体搜索
**Then:** 推荐结果包含 Playfair Display + Inter 配对，附带 Google Fonts URL 和 Tailwind Config

#### Scenario: AI Default Font Exclusion

**Given:** skill 返回的字体推荐中包含 Inter 作为 body 字体
**When:** ui-director 处理推荐结果
**Then:** ui-director 标记 Inter 为 AI 默认字体，要求用户确认或选择替代方案

### Requirement: Color Palette Recommendation from Skill

ui-director SHALL 使用 ui-ux-pro-max skill 的 colors.csv 数据（95+ 色板）进行颜色推荐，推荐结果 MUST 转换为 OKLCH 格式输出。

#### Scenario: SaaS Color Palette

**Given:** 项目类型为 "SaaS"，行业为 "Developer Tools"
**When:** ui-director 调用 skill 的颜色搜索
**Then:** 推荐结果包含 SaaS 色板，所有颜色值转换为 oklch() 格式输出

#### Scenario: Healthcare Color Palette

**Given:** 项目类型为 "Healthcare App"
**When:** ui-director 调用 skill 的颜色搜索
**Then:** 推荐结果包含 Healthcare 色板（Calm blue + health green），所有颜色值转换为 oklch() 格式输出

#### Scenario: HEX to OKLCH Conversion

**Given:** skill 返回的颜色值为 HEX 格式（如 "#2563EB"）
**When:** ui-director 处理推荐结果
**Then:** ui-director 将 HEX 值转换为 oklch() 格式后再写入 ui-design.md

### Requirement: Chart Type Recommendation from Skill

ui-director SHALL 使用 ui-ux-pro-max skill 的 charts.csv 数据（25 种图表）进行图表类型推荐，当项目涉及数据可视化时自动触发。

#### Scenario: Dashboard Chart Recommendation

**Given:** 项目包含数据仪表板页面
**When:** ui-director 调用 skill 的图表搜索
**Then:** 推荐结果包含 Line Chart（趋势）、Bar Chart（比较）、Donut Chart（占比）等匹配数据类型的图表

#### Scenario: No Data Visualization Pages

**Given:** 项目为纯营销落地页，无数据可视化需求
**When:** ui-director 执行 Step 4
**Then:** 跳过图表推荐环节

### Requirement: Tech Stack Adaptation from Skill

ui-director SHALL 使用 ui-ux-pro-max skill 的 stacks/ 目录数据（12 种技术栈）进行技术栈适配推荐，根据项目使用的框架推荐对应的最佳实践。

#### Scenario: React Stack Recommendation

**Given:** 项目使用 React + Tailwind CSS 技术栈
**When:** ui-director 调用 skill 的技术栈搜索
**Then:** 推荐结果包含 React 性能优化建议（useMemo、Suspense、Code Splitting）和 Tailwind 配置示例

#### Scenario: Vue Stack Recommendation

**Given:** 项目使用 Vue + Nuxt UI 技术栈
**When:** ui-director 调用 skill 的技术栈搜索
**Then:** 推荐结果包含 Vue 响应式最佳实践和 Nuxt UI 组件配置示例

#### Scenario: Unknown Tech Stack

**Given:** 项目使用的技术栈不在 skill 的 12 种支持列表中
**When:** ui-director 调用 skill 的技术栈搜索
**Then:** 回退到 html-tailwind 默认栈推荐

### Requirement: Graceful Degradation

ui-ux-pro-max skill 集成 SHALL 实现优雅降级，当 skill 不可用时回退到内置 5 维矩阵，不阻塞 ui-director 的正常执行。

#### Scenario: Python Not Installed

**Given:** 系统未安装 Python 3
**When:** ui-director 尝试调用 skill 的 search.py 脚本
**Then:** ui-director 捕获执行错误，回退到内置 5 维矩阵，在 ui-design.md 中标注 "Skill fallback: Python not available"

#### Scenario: Script Execution Timeout

**Given:** skill 的 search.py 脚本执行超过 10 秒
**When:** ui-director 等待脚本返回
**Then:** ui-director 超时后回退到内置 5 维矩阵，在 ui-design.md 中标注 "Skill fallback: script timeout"

#### Scenario: Partial Skill Availability

**Given:** skill 的字体搜索可用但颜色搜索失败
**When:** ui-director 执行 Step 4
**Then:** 字体决策使用 skill 推荐结果，颜色决策回退到内置矩阵，在 ui-design.md 中分别标注来源
