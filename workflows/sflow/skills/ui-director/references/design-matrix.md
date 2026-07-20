# 五维决策矩阵

> 用于 ui-director Step 4 的 5 维美学决策。
> 基于调性选择和美学简报，在 5 个维度上做出具体决策。
> 加载方式：`skill(name="ui-director")` 后自动包含，或按需 grep。

## 4.1 字体 (Typography)

| 决策项 | 选项范围 | 推荐值 |
|--------|---------|--------|
| 显示字体 | Geist / Outfit / Cabinet Grotesk / Satoshi / Playfair Display / 系统字体 | 按调性选择 |
| 正文字体 | Geist / Inter / Satoshi / Source Sans 3 / 系统字体 | 与显示字体同族或协调 |
| 字号体系 | 比例 1.125 (major second) / 1.25 (major third) / 1.333 (perfect fourth) | 1.25 major third |
| 基础字号 | 14px / 15px / 16px | 16px |
| 显示行高 | 0.9 - 1.1 | 1.0 |
| 正文行高 | 1.5 - 1.7 | 1.6 |
| 显示 letter-spacing | ≥ -0.04em | -0.04em |
| 正文 letter-spacing | normal / 0 | normal |

**禁令**：Inter 不得作为默认显示字体；system-ui 不得作为品牌字体；Serif 仅在品牌明确要求时使用。

## 4.2 颜色 (Color)

| 决策项 | 选项范围 | 推荐值 |
|--------|---------|--------|
| 强调色 | 1 个主色，OKLCH 格式 | 饱和度 < 80% |
| 中性色 | 基于品牌色调微偏 | chroma 0.005-0.015 |
| 语义色 | success / warning / error / info | 各 1 色，OKLCH 格式 |
| 表面色 | background / card / overlay 层级 | 3-4 层递进 |
| 对比度 | WCAG AA: 正文 ≥ 4.5:1, 大文字 ≥ 3:1 | 全部 AA 通过 |

**禁令**：禁止纯黑 #000000；禁止纯白 #FFFFFF 作为文字色（使用 off-white）；禁止默认蓝 #3B82F6；禁止 Premium 暖灰色板作为默认。

## 4.3 动效 (Motion)

| 决策项 | 选项范围 | 推荐值 |
|--------|---------|--------|
| 标准缓动 | ease-out / (0.4, 0, 0.2, 1) | (0.4, 0, 0.2, 1) |
| 减速缓动 | ease-out / (0, 0, 0.2, 1) | (0, 0, 0.2, 1) |
| 加速缓动 | ease-in / (0.4, 0, 1, 1) | (0.4, 0, 1, 1) |
| 微交互时长 | 100 - 200ms | 150ms |
| 过渡时长 | 200 - 400ms | 300ms |
| 强调时长 | 400 - 700ms | 500ms |
| 触发条件 | hover / focus / state-change / scroll / entrance | 按场景选择 |
| 减少动效回退 | instant / opacity-only | opacity-only |

**禁令**：时长不得超出 100-700ms 范围；所有动效必须有 reduced-motion 回退；禁止直接使用 window.addEventListener('scroll')。

## 4.4 空间 (Space)

| 决策项 | 选项范围 | 推荐值 |
|--------|---------|--------|
| 基础单位 | 4px / 8px | 8px |
| 间距倍数 | 0.5x / 1x / 1.5x / 2x / 3x / 4x / 6x / 8x | 8 级体系 |
| 布局密度 | compact (4px) / comfortable (8px) / spacious (8px generous) | comfortable |
| 文本最大宽度 | 60 - 70ch | 65ch |
| 布局最大宽度 | 960 - 1440px | 1200px |
| 全宽最大宽度 | 1440 - 1920px | 1440px |

**禁令**：禁止 magic number 间距值；禁止固定像素宽度容器；所有间距必须是基础单位的整数倍。

## 4.5 质感 (Texture)

| 决策项 | 选项范围 | 推荐值 |
|--------|---------|--------|
| 圆角 | sharp (0-2px) / subtle (4-8px) / rounded (12-16px) / pill (9999px) | 按调性选择 |
| 阴影层级 | none / subtle / medium / elevated | ≤ 3 层 |
| 阴影规范 | offset / blur / spread / color | spread ≤ blur, 颜色非纯黑 |
| 边框策略 | none / subtle (1px neutral) / structural (semantic only) | 按调性选择 |
| 表面处理 | flat / layered / elevated | layered |

**禁令**：禁止装饰性 border-left；阴影 spread 不得大于 blur；阴影颜色不得使用默认黑色（使用中性色透明度）；圆角必须来自 token 体系。