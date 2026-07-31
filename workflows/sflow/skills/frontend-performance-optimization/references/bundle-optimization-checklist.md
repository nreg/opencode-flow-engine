# 打包体积优化检查清单

## 分析工具

- webpack-bundle-analyzer：可视化分析 webpack 打包产物
- rollup-plugin-visualizer：分析 Rollup/Vite 打包产物
- source-map-explorer：通过 Source Map 分析代码来源
- Stats.js：运行时内存/帧率监控
- 检查是否有重复打包的依赖
- 检查是否有意外打包的大型库
- 检查是否有未 Tree Shaking 的无用代码
- 检查 Source Map 是否在生产环境禁用

## 依赖优化

- Moment.js → Day.js（体积从 67KB 降到 2KB）
- Lodash → Lodash-es 或原生方法
- Axios → Fetch API 或 ky
- jQuery → 原生 DOM API
- UI 组件库按需引入：babel-plugin-import
- Lodash 按需引入：import debounce from 'lodash/debounce'
- 图标库按需引入：@iconify/react
- 工具函数按需引入
- 检查是否有重复依赖的不同版本
- 使用 npm dedupe 扁平化依赖树
- 锁定依赖版本

## 代码分割

- 每个路由独立打包
- 使用 React.lazy + Suspense
- 预加载关键路由
- 大型组件独立打包：编辑器、图表、地图
- 条件渲染组件懒加载：模态框、抽屉
- 非首屏组件延迟加载
- 第三方库独立 chunk：vendor chunk
- 稳定依赖单独打包
- 动态依赖单独打包

## Tree Shaking

- package.json 添加 "sideEffects": false
- 确保代码使用 ES Module 导出
- 避免导入整个库
- 移除未使用的导出函数和变量
- 移除未使用的组件和模块
- 移除 console.log/debugger 语句
- 移除条件编译的死代码

## 压缩优化

- Terser 压缩：移除空格、注释
- 开启压缩选项：compress、mangle
- 移除 console 和 debugger
- cssnano 压缩：移除空格、注释
- PurgeCSS 移除未使用的 CSS
- CSS Minification：合并相同规则
- 图片压缩：TinyPNG、ImageOptim
- 图片格式：转换为 WebP/AVIF
- 字体压缩：字体子集化
- Gzip/Brotli 压缩：服务器启用

## 构建配置优化

- mode: 'production' 启用生产优化
- splitChunks 分离公共代码
- cache 加速二次构建
- parallel 并行构建
- build.rollupOptions.output.manualChunks
- build.cssCodeSplit CSS 代码分割
- build.minify 使用 esbuild 压缩
- build.target 指定浏览器目标

## 加载策略优化

- preload 关键资源：字体、首屏 CSS/JS
- prefetch 未来可能需要的资源
- preconnect 关键域名
- 静态资源添加 contenthash
- 设置长期缓存：Cache-Control
