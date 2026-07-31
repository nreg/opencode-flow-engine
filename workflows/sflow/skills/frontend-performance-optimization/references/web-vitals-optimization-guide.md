# Web Vital 指标优化指南

## 核心 Web Vitals 指标

### LCP（Largest Contentful Paint）
目标：≤ 2.5s（75 分位）

优化策略：
- 资源预加载：`<link rel="preload">` 提前加载 LCP 资源
- 资源体积：压缩 LCP 图片，使用 webp/avif 格式
- 服务器响应：优化 TTFB，使用 CDN、缓存、SSR
- 渲染阻塞：移除阻塞渲染的 JS/CSS
- 资源优先级：LCP 资源设置 `fetchpriority="high"`

常见问题：
- LCP 元素是背景图片：改用 `<img>` 标签
- LCP 元素是字体：`font-display: optional` 或预加载
- LCP 元素是视频：提供封面图，延迟加载

### FID（First Input Delay）
目标：≤ 100ms（75 分位）

优化策略：
- 拆分长任务：超过 50ms 的任务拆分为多个小任务
- 延迟非关键 JS：第三方脚本延迟加载
- 代码分割：路由/组件懒加载
- 异步执行：requestIdleCallback 处理低优先级任务
- Web Worker：大计算量任务移到 Worker 线程

### CLS（Cumulative Layout Shift）
目标：≤ 0.1（75 分位）

优化策略：
- 图片尺寸：`<img>` 设置 width/height 或 aspect-ratio
- 字体加载：`font-display: optional` 或匹配回退字体
- 动态内容：预留空间（骨架屏/占位符）
- 动画：使用 transform/opacity，避免布局变化
- 广告/嵌入：预留固定高度容器

## 辅助 Web Vitals 指标

### FCP（First Contentful Paint）
目标：≤ 1.8s  
优化：内联关键 CSS，移除渲染阻塞资源

### TTFB（Time to First Byte）
目标：≤ 600ms  
优化：CDN 加速、服务端缓存、数据库优化

### TTI（Time to Interactive）
目标：≤ 3.8s  
优化：减少 JS 体积，延迟非关键脚本

## 测量工具

### 实验室数据
- Lighthouse：Chrome DevTools 集成
- WebPageTest：多地点、多设备测试
- Chrome UX Report：Chrome 用户真实数据

### 真实用户数据（RUM）
- web-vitals 库：Google 官方库
- Performance API：获取性能数据
- 上报时机：页面加载完成、用户离开页面

## 监控与告警

- 收集 7 天数据，计算 75 分位值作为基线
- 设置告警阈值：基线的 120%
- 每日报告：平均值、75 分位、95 分位
- 异常告警：指标超过阈值时自动通知
