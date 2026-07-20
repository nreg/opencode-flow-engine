# AI 反模式禁令（Anti-Patterns）

> 从 taste-skill + impeccable + frontend-design 合并而来。
> 在 Phase 4 质量检查阶段加载：`skill(name="taste-skill")` 后自动注入。
> 如独立加载：`grep "禁止" references/anti-patterns.md` 按需查看。

## 视觉禁令（必须遵守）

| # | 模式 | 禁令 | 替代方案 |
|---|------|------|---------|
| 1 | 侧边色条装饰 | 禁止 `border-left` / `border-right` > 1px 作为装饰 | 背景色块、全边框、或留白 |
| 2 | 渐变文字 | 禁止 `background-clip: text` + gradient | 单一实色，用字重/字号表达强调 |
| 3 | #号标签前缀 | 禁止在标签前使用 # | 纯文字标签或 badge 组件 |
| 4 | 空状态闪动 | 禁止元素未加载时闪现 | 使用 `v-if` / 条件渲染，等数据就绪再展示 |
| 5 | Glassmorphism | 禁止作为默认设计语言 | 仅用于特定覆盖场景，且有 solid fallback |
| 6 | 纯黑 #000000 | 禁止 | 使用 off-black、zinc-950 或 charcoal |
| 7 | 过饱和强调色 | 默认禁止 | 饱和度 < 80%，与中性色协调 |
| 8 | 手绘风格 SVG 插图 | 禁止 SVG 手绘涂鸦 | 用真实图片或纯结构布局 |
| 9 | 条纹/网格背景 | 禁止 `repeating-linear-gradient` 条纹 | 纯色或真实纹理 |

## 布局禁令

| # | 模式 | 禁令 | 替代 |
|---|------|------|------|
| 1 | Hero 溢出视口 | H1 标题 ≤ 2 行，副标题 ≤ 20 字，CTA 不需滚动可见 | 缩小字号或精简文案 |
| 2 | Hero 空白过多 | 顶部留白白 `pt-24`（~6rem） | 增大字体或图片，不是加大 padding |
| 3 | Hero 顶栏 Logo 墙 | Trusted By / Used By 放在 Hero 区域内部 | 独立区域放在 Hero 下方 |
| 4 | 导航栏溢出 | 桌面端必须单行显示 | 折叠菜单或精简项目 |
| 5 | Bento 占位格 | 有几项就几个格子，不要空白格 | 调整网格布局 |
| 6 | Zigzag 过度 | 左右交替布局最多连续 2 个 section | 第 3 个改用全宽/垂直/Bento |
| 7 | Eyebrow 泛滥 | 每 3 个 section 最多 1 个 eyebrow | 去掉或减少频率 |
| 8 | Split-header 默认 | 左标题右说明的双栏 Section 头禁止作为默认 | 垂直堆叠，max-width 65ch |
| 9 | 同质卡片网格 | 禁止相同尺寸的 icon + heading + text 卡片无限重复 | 变化布局组合 |

## 交互禁令

| # | 模式 | 禁令 |
|---|------|------|
| 1 | 自定义鼠标光标 | 禁止（a11y 不友好） |
| 2 | 图片 hover 动画 | 禁止对 `<img>` 元素做 hover 变换 |
| 3 | `window.addEventListener('scroll', ...)` | 禁止，使用 Motion useScroll / GSAP ScrollTrigger |
| 4 | React state 跟踪连续鼠标位置 | 使用 Motion useMotionValue / useTransform |
| 5 | 所有组件只实现成功态 | 必须实现 loading / empty / error / disabled / 各交互态 |

## 八维度审查清单

每个 UI 交付物必须通过以下 8 个维度的逐条审查。

### 维度 1：字体（Typography）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 禁止 Inter 作为默认正文字体 | `font-family: 'Inter'` / `font-inter` | 使用 Geist、Outfit、Cabinet Grotesk 或 Satoshi |
| 字重不超过 3 种 | 4+ 种不同 font-weight | 精简为 2-3 种（如 400、500、700） |
| 行高在合理范围 | 显示文字行高 < 0.9 或正文 > 1.8 | 显示：0.9-1.1；正文：1.5-1.7 |
| 显示标题 letter-spacing ≥ -0.04em | h1-h3 的 letter-spacing < -0.04em | 设置 letter-spacing ≥ -0.04em |
| 禁止 system-ui 作为品牌字体 | 品牌元素使用 `font-family: system-ui` | 使用刻意选择的字体；system-ui 仅用于 UI 控件 |
| 字号体系遵循模数比例 | 随机 font-size 不遵循比例 | 使用模数比例（1.25 major third 或 1.333 perfect fourth） |

### 维度 2：颜色（Color）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 禁止纯黑 #000000 | `color: #000` / `rgb(0,0,0)` | 使用 off-black：zinc-950、#0a0a0a 或 oklch(0.15 0.01 260) |
| 禁止纯白 #FFFFFF 作为大面积背景 | `background: #fff` / `#FFFFFF` | 使用 off-white：zinc-50、#fafafa 或 oklch(0.99 0.005 260) |
| 强调色饱和度 < 80% | oklch chroma > 0.24 或 hsl saturation > 80% | 降低饱和度至 < 80% |
| 强制使用 CSS 变量 | 组件样式中硬编码 hex/hsl | 使用 var(--color-*) 或 Tailwind 语义 token |
| WCAG AA 对比度合规 | 文字对比度 < 4.5:1（普通）/ < 3:1（大字） | 调整前景/背景色对 |
| 禁止默认蓝 #3B82F6 | 品牌色使用 #3B82F6 / blue-500 | 选择独特强调色；避免 Tailwind 默认蓝 |

### 维度 3：阴影（Shadow）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 阴影层级 ≤ 3 | 4+ 种不同 box-shadow | 使用 3 级：subtle / medium / elevated |
| 扩散 ≤ 模糊 | box-shadow 中 spread > blur | 保持 spread ≤ blur radius |
| 阴影颜色必须指定 | box-shadow 使用默认黑色 rgba(0,0,0,...) | 使用带色调阴影：rgba(theme-color, 0.1) |
| 阴影方向一致 | 混合上射和下射阴影 | 统一一个方向（通常为右下方） |
| 禁止沉重投影 | blur > 20px 或 opacity > 0.3 | 降低 blur ≤ 15px，opacity ≤ 0.2 |

### 维度 4：边框（Border）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 禁止装饰性 border-left | border-left > 1px 作为装饰 | 使用背景色块、全边框或留白 |
| 边框颜色来自 token | 硬编码 border-color hex 值 | 使用 var(--border-*) 或 Tailwind border token |
| 边框风格统一 | 混合 solid/dashed/dotted 无系统 | 选择一种风格（solid）统一使用 |
| 圆角来自 token | border-radius 使用随机 px 值 | 使用圆角比例：0 / 2 / 4 / 8 / 12 / 16 / 9999 |
| 禁止双边框 | 相邻元素都有边框 | 使用 margin/gap 或负边距合并 |

### 维度 5：动效（Motion）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 时长 100-700ms | transition < 100ms 或 > 700ms | 微交互：100-200ms；过渡：200-400ms；强调：400-700ms |
| 使用标准缓动曲线 | linear 或无理由的自定义 cubic-bezier | 使用 standard/decelerate/accelerate 曲线 |
| 处理 prefers-reduced-motion | 动画无 @media (prefers-reduced-motion) | 添加 fallback：即时或仅透明度变化 |
| 禁止原始 scroll 监听 | window.addEventListener('scroll', ...) | 使用 Motion useScroll / GSAP ScrollTrigger |
| 禁止布局抖动 | 在动画帧中读取布局属性 | 批量 DOM 读写；使用 transform/opacity |

### 维度 6：布局（Layout）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 间距使用基础单位倍数 | 不在 4px/8px 网格上的随机 px 值 | 使用间距比例：4/8/12/16/24/32/48/64 |
| 禁止魔法数字 | 无 token 引用的硬编码 px 值 | 使用 spacing/size token 或 Tailwind scale |
| 响应式断点已定义 | 无 @media 查询或响应式工具 | 定义断点：sm/md/lg/xl/2xl |
| 容器禁止固定像素宽度 | width: 1200px / max-width: 960px | 使用 rem/百分比：max-w-7xl、max-w-4xl |
| 内容宽度受限 | 文本块 > 65ch 宽 | 应用 max-w-[65ch] 或 prose class |

### 维度 7：文案（Copy）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 禁止 Lorem ipsum | Lorem ipsum dolor sit amet... | 使用真实内容或有意义的占位文字 |
| 按钮文字 ≤ 3 个词 | "点击此处提交您的申请" | "提交" / "立即申请" / "发送请求" |
| 标题层级一致 | 跳级：h1 → h3（无 h2） | 顺序使用：h1 → h2 → h3 |
| 正文禁止全大写 | 段落使用 text-transform: uppercase | 仅用于标签/badge，不用于正文 |
| UI 标签禁止 emoji | 🔥 热门推荐 / ✅ 已确认 | 使用纯文字："热门推荐" / "已确认" |

### 维度 8：组件（Component）

| 规则 | 违规示例 | 替代方案 |
|------|---------|---------|
| 所有交互态已定义 | 仅实现默认态 | 实现：hover / focus / active / disabled / loading |
| 禁止空状态闪现 | 数据加载前空元素可见 | 使用 v-if / 条件渲染；数据就绪后再展示 |
| 表单必须有 label | Input 仅有 placeholder 无 label | 添加可见 label 或 aria-label |
| 图标库统一 | 混用 Phosphor + Radix + Tabler 图标 | 选择一个库；统一使用 |
| 标签禁止 # 前缀 | #标签名 / #分类 | 使用纯文字：标签名 / 分类（badge 组件） |