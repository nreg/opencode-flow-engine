# 前端开发最佳实践手册

## 代码组织

### 组件拆分原则
- 单一职责：每个组件只做一件事，超过 200 行考虑拆分
- 展示组件与容器组件分离：UI 逻辑与业务逻辑解耦
- 公共组件抽取：重复 3 次以上的 UI 模式抽象为公共组件
- 目录结构：按功能模块划分，避免按类型（components/pages/utils）平铺

### 命名规范
- 组件名：PascalCase，如 `UserProfileCard`
- 函数名：camelCase，动词开头，如 `fetchUserData`、`handleClick`
- 常量：UPPER_SNAKE_CASE，如 `API_BASE_URL`
- 文件名：kebab-case，如 `user-profile-card.tsx`
- 布尔变量：is/has/can 前缀，如 `isLoading`、`hasPermission`

## 状态管理

### 本地状态 vs 全局状态
- 本地状态优先：仅在组件内使用的状态用 useState/useRef
- 提升状态：多个组件共享时提升到最近公共父组件
- 全局状态慎用：跨多层组件共享时才用 Redux/Vuex/Pinia

### 状态更新原则
- 不可变更新：永远不直接修改 state，使用展开运算符或 immer
- 批量更新：React 18 自动批处理，Vue 中用 nextTick 确保更新完成
- 异步状态：loading/error/data 三态模式，避免 UI 闪烁

## 性能优化基础

### 渲染优化
- React：useMemo 缓存计算结果，useCallback 缓存回调函数，React.memo 避免不必要重渲染
- Vue：computed 替代 watch，v-once 静态内容，v-memo 列表项缓存
- 列表渲染：必须提供稳定的 key，避免用 index 做 key

### 懒加载策略
- 路由懒加载：React.lazy + Suspense，Vue 异步组件
- 图片懒加载：loading="lazy" 或 Intersection Observer
- 组件懒加载：首屏不可见组件延迟加载

## 错误处理

### 错误边界
- React：Error Boundary 捕获组件树错误，展示 fallback UI
- Vue：errorCaptured 钩子捕获子组件错误
- 全局错误：window.onerror 捕获未处理异常

### 异步错误
- Promise 错误必须 catch，避免未处理的 rejection
- async/await 用 try-catch 包裹，或 .catch() 链式调用
- 网络请求：统一错误处理拦截器，区分业务错误和网络错误

## 可访问性基础

### 语义化标签
- 使用正确的 HTML 标签：nav/header/main/article/section/aside/footer
- 表单控件关联 label：for/id 或包裹写法
- 按钮：用 button 而非 div + click，区分 type="button/submit"

### 键盘导航
- 可聚焦元素：tabindex="0" 使非交互元素可聚焦
- 焦点管理：模态框打开时聚焦到内部，关闭时恢复原焦点
- 快捷键：accesskey 属性，但需避免与浏览器快捷键冲突

## 代码质量工具

### 静态检查
- ESLint：启用推荐规则集，配置团队共享规则
- TypeScript：开启 strict 模式，避免 any 类型
- Stylelint：CSS/Less/Sass 代码规范检查

### 格式化
- Prettier：统一代码格式，配置 printWidth/tabWidth/semi/singleQuote
- EditorConfig：跨编辑器统一配置
- Git Hooks：pre-commit 自动格式化，避免格式冲突
