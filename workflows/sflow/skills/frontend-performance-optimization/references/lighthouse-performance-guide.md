# Lighthouse 性能优化指南

## Lighthouse 概述

- Chrome DevTools：右键检查 → Lighthouse 面板
- 命令行：lighthouse https://example.com --view
- Node 模块：编程方式集成到 CI/CD
- PageSpeed Insights：Google 在线工具
- 性能分数：0-100 分，综合评估各项指标
- 核心 Web Vitals：LCP、FID、CLS 权重最高
- 机会建议：优化建议，预估节省时间
- 诊断信息：性能瓶颈详情

## 性能指标优化

- 预加载关键资源：`<link rel="preload">`
- 优化服务器响应：TTFB < 600ms
- 移除阻塞资源：异步加载非关键 JS/CSS
- 图片优化：压缩、WebP 格式
- 拆分长任务：超过 50ms 的任务拆分
- 最小化主线程工作：减少 JS 执行时间
- 减少 JavaScript 体积：代码分割
- 延迟非关键 JS：第三方脚本异步加载
- 图片设置尺寸：width/height 或 aspect-ratio
- 字体优化：font-display: optional
- 预留动态内容空间：骨架屏
- 避免布局偏移：transform 替代 top/left
- 移除渲染阻塞资源：async/defer
- 内联关键 CSS：首屏样式内联

## 优化机会（Opportunities）

- 移除未使用的 JavaScript：Tree Shaking
- 移除未使用的 CSS：PurgeCSS
- 图片优化：压缩、WebP/AVIF
- 使用高效缓存策略：Cache-Control
- 静态资源长期缓存：contenthash 文件名
- CDN 缓存：边缘节点缓存
- 预连接必要域名：preconnect
- 减少关键请求数：合并资源
- 避免重定向：减少 HTTP 301/302
- HTTP/2 或 HTTP/3：多路复用
- JavaScript 压缩：Terser
- CSS 压缩：cssnano

## 诊断信息（Diagnostics）

- 主线程工作分解：分析 JS 执行时间
- 强制同步布局：避免读写交替触发回流
- 长任务分析：识别超过 50ms 的任务
- 布局偏移详情：定位导致 CLS 的元素

## 最佳实践（Best Practices）

- HTTPS：全站强制 HTTPS
- CSP：Content-Security-Policy 配置
- XSS 防护：避免 innerHTML
- 现代 JavaScript：ES6+、async/await
- 现代 CSS：Grid、Flexbox
- PWA：Service Worker、Web App Manifest

## 可访问性（Accessibility）

- 使用语义化标签：header/nav/main/article
- ARIA 属性：role、aria-label
- 标题层级：h1-h6 正确嵌套
- 可聚焦元素：tabindex、focus 管理

## SEO 优化

- title 标签：每个页面唯一标题
- meta description：描述页面内容
- Open Graph：社交媒体分享预览
- JSON-LD：Schema.org 结构化数据

## CI/CD 集成

- 每次提交运行 Lighthouse，对比性能变化
- 设置性能预算：分数低于阈值时构建失败
- 定期运行 Lighthouse：每日/每周报告
