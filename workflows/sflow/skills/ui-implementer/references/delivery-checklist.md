# Delivery Checklist（Pre-Commit）

> 提交前逐项检查。任何一项未通过不得提交。
> 加载方式：`skill(name="polish")` 后自动包含，或按需 grep。

## 1. console.log / debugger 已清除

| 项目 | 内容 |
|------|------|
| 违规示例 | `console.log('debug:', data)` / `debugger;` |
| 修复建议 | 全局搜索 `console.log` 和 `debugger`，全部删除或替换为条件日志（`if (import.meta.env.DEV)`） |

## 2. 所有交互状态完备（hover/focus/active/disabled/loading）

| 项目 | 内容 |
|------|------|
| 违规示例 | 按钮只写了 `bg-blue-500`，无 hover/focus/active/disabled 变体 |
| 修复建议 | 补全 `hover:bg-blue-600 focus:ring-2 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`；loading 态用 `aria-busy="true"` + spinner |

## 3. 无硬编码颜色（全部来自 CSS variables / design tokens）

| 项目 | 内容 |
|------|------|
| 违规示例 | `color: #1a1a2e` / `bg-[#f5f5f5]` / `border-red-500` |
| 修复建议 | 使用 `var(--color-text)` / `bg-background` / `border-border` 等 CSS 变量或 Tailwind 语义 token |

## 4. 无 const styles（内联样式已抽离为 CSS 类）

| 项目 | 内容 |
|------|------|
| 违规示例 | `const styles = { container: { padding: 16, backgroundColor: '#fff' } }` / `style={{ marginTop: 8 }}` |
| 修复建议 | 将内联样式抽离为 Tailwind 类或 CSS 模块类：`className="p-4 bg-background"` / `className="mt-2"` |

## 5. 无 scrollIntoView 使用

| 项目 | 内容 |
|------|------|
| 违规示例 | `element.scrollIntoView({ behavior: 'smooth' })` |
| 修复建议 | 使用锚点导航（`id` + hash link）、Motion `useScroll`、或 GSAP ScrollTrigger |

## 6. 响应式已适配（360/768/1024/1440 断点）

| 项目 | 内容 |
|------|------|
| 违规示例 | 固定宽度 `w-[1200px]`，无 `sm:/md:/lg:/xl:` 响应式变体 |
| 修复建议 | 使用 `w-full max-w-7xl`，在 360/768/1024/1440 四个断点分别验证布局无溢出 |

## 7. prefers-reduced-motion 已处理

| 项目 | 内容 |
|------|------|
| 违规示例 | 动画仅写了 `transition-all duration-300`，无 reduced-motion fallback |
| 修复建议 | 添加 `motion-safe:transition-all motion-safe:duration-300 motion-reduce:transition-none`；CSS 中添加 `@media (prefers-reduced-motion: reduce)` 覆盖 |

## 8. 表单 label 显式关联（不靠 placeholder）

| 项目 | 内容 |
|------|------|
| 违规示例 | `<input placeholder="请输入邮箱" />` 无 `<label>` |
| 修复建议 | 添加 `<label htmlFor="email">邮箱</label>` 或 `<input aria-label="邮箱" />`；placeholder 仅作格式提示 |

## 9. 图片 alt 文本（装饰图用 alt=""）

| 项目 | 内容 |
|------|------|
| 违规示例 | `<img src="hero.jpg" />` 无 alt / `<img src="divider.svg" alt="装饰分隔线" />` |
| 修复建议 | 有意义图片：`alt="产品仪表盘截图"`；装饰图：`alt=""` + `role="presentation"` |

## 10. 焦点环可见（与设计调性匹配，非默认蓝色 outline）

| 项目 | 内容 |
|------|------|
| 违规示例 | `outline: none` 移除焦点环 / 浏览器默认蓝色 `outline: 2px solid #0000ee` |
| 修复建议 | 使用品牌色焦点环：`focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`；确保深色/浅色模式下均可见 |