---
name: taste-skill
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
---

# taste-skill: Anti-Slop Frontend Skill

Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.

Every rule below is contextual. None of it fires automatically. First read the brief, then pull only what fits.

## 核心职责

1. Brief Inference - 先理解用户意图，再动手
2. Dial Configuration - 设置三个旋钮（VARIANCE / MOTION / DENSITY）
3. Design System Selection - 选择合适的设计系统或美学方向
4. Anti-Slop Enforcement - 避免 AI 默认模式
5. Pre-Flight Check - 输出前运行完整检查清单

## 使用方法

1. 读取 brief，输出一行 "Design Read" 声明
2. 根据 design read 设置三个 dial 值
3. 选择设计系统（Section 2）或美学方向（Section 2.B）
4. 按设计指令实现（Section 4）
5. 运行 Pre-Flight Check（Section 14）

## 关键规则

1. **零 em-dash** - 页面任何位置都不允许 em-dash（— 或 –）
2. **单一强调** - 每页最多 1 个 accent color，全页一致
3. **Eyebrow 限制** - 每 3 个 section 最多 1 个 eyebrow
4. **Hero 适配** - headline ≤ 2 行，subtext ≤ 20 词，CTA 可见
5. **Motion 必须有动机** - 每个动画必须能用一句话解释其目的

## References

详细内容拆分到以下文件，按需查阅：

### 核心流程
- `references/brief-inference.md` - Brief 推断流程
- `references/dial-inference.md` - Dial 推断与用例预设
- `references/dial-definitions.md` - Dial 技术定义（1-10 级）
- `references/design-system-map.md` - 设计系统选择映射
- `references/default-architecture.md` - 默认架构与约定

### 设计指令
- `references/design-directives-part1.md` - 排版、颜色、布局、材质、交互状态
- `references/design-directives-part2.md` - 布局纪律、图像策略
- `references/design-directives-part3.md` - 内容密度、引用、主题锁

### 上下文感知
- `references/context-aware-proactivity.md` - 上下文感知主动性（GSAP、Motion 等）

### 重设计
- `references/redesign-protocol.md` - 重设计协议（preserve vs overhaul）

### 质量保证
- `references/performance-accessibility.md` - 性能与无障碍守卫
- `references/dark-mode.md` - 暗色模式协议
- `references/ai-tells.md` - AI 特征禁止模式（100+ 条）
- `references/pre-flight.md` - 最终检查清单（60+ 项）

### 模式与资源
- `references/vocabulary.md` - 模式词汇表（50+ 个模式名）
- `references/block-library.md` - Block 库契约

### 附录
- `references/out-of-scope.md` - 不适用场景
- `references/install-commands.md` - 设计系统安装命令
- `references/canonical-sources.md` - 官方文档链接
- `references/apple-liquid-glass.md` - Apple Liquid Glass Web 近似

## 工作流

```
Brief → Design Read → Dials → Design System → Implementation → Pre-Flight Check → Output
```

每个阶段都有明确的规则和检查点。不要跳过任何阶段。
