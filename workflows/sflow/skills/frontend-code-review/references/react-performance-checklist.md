# React 性能优化检查清单

## 渲染优化

### 避免不必要重渲染
- 使用 React.memo 包裹纯展示组件
- useMemo 缓存复杂计算结果
- useCallback 缓存传递给子组件的回调函数
- 避免在 JSX 中创建内联函数和对象

### 依赖数组检查
- useEffect/useMemo/useCallback 依赖数组必须完整
- 依赖数组不要过度声明
- 依赖项是对象/数组时，用 useMemo 包裹
- 函数作为依赖时，用 useCallback 包裹

## 状态管理优化

### 状态提升与下沉
- 仅当前组件使用的状态不要提升
- 多个子组件共享的状态提升到最近公共祖先
- 跨多层组件共享的状态考虑 Context 或状态管理库

### Context 优化
- Context value 是对象时，用 useMemo 包裹
- 拆分 Context：不同数据拆分为独立 Context
- 复杂状态用状态管理库替代 Context

## 列表渲染优化

### 虚拟滚动
- 长列表（>100项）使用 react-window
- 固定高度列表用 VariableSizeList
- 列表项组件用 React.memo 包裹

### 列表 key 优化
- 列表项 key 使用唯一标识符（id），不使用 index
- key 在兄弟节点间唯一
- 动态列表避免 key 重复

## 代码分割与懒加载

### 路由懒加载
- 使用 React.lazy + Suspense 懒加载路由组件
- Suspense fallback 提供有意义的加载状态
- 预加载关键路由：onMouseEnter 时 preload

### 组件懒加载
- 非首屏组件用 React.lazy 延迟加载
- 模态框/抽屉等交互组件懒加载
- 大型第三方库按需引入

## 事件处理优化

### 防抖节流
- 搜索输入用 debounce，延迟 300-500ms
- 滚动/resize 事件用 throttle，间隔 16ms
- 高频事件避免在回调中做复杂计算

### 事件委托
- 列表项点击事件使用事件委托
- 动态内容的事件使用事件委托

## 内存泄漏预防

### 清理副作用
- useEffect 返回清理函数
- 组件卸载时取消未完成的异步请求
- 避免在闭包中持有组件实例引用

### 定时器与订阅
- setInterval/setTimeout 必须在清理函数中清除
- 事件监听必须在清理函数中移除
- Redux/Vuex 订阅在清理函数中取消订阅

## 性能监控

- 使用 React DevTools Profiler 记录渲染性能
- 分析 flamegraph 找出渲染瓶颈
- 开发环境启用 StrictMode 检测副作用问题
