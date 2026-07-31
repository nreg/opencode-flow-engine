# Vue 开发最佳实践

## 组件设计

### 组件拆分
- 单一职责：每个组件专注一个功能
- 展示组件与容器组件分离
- 组件粒度：可复用组件最小化
- 目录结构：组件就近放置

### Props 与 Events
- Props 单向数据流：子组件不直接修改 props
- Props 验证：定义 type/required/default
- Events 命名：kebab-case，如 `@update-user`
- v-model 双向绑定：modelValue prop + update:modelValue emit

## Composition API 最佳实践

### 响应式数据
- ref vs reactive：基本类型用 ref，对象用 reactive
- toRefs：解构 reactive 对象时保持响应性
- unref：统一处理 ref 和普通值
- 避免直接解构 props：用 toRefs(props)

### 组合式函数（Composables）
- 命名：use 前缀，如 useFetch
- 返回值：返回响应式引用
- 副作用清理：onScopeDispose 清理副作用
- 单一职责：每个 composable 专注一个功能

## 性能优化

### 计算属性 vs 侦听器
- computed：派生状态，有缓存
- watch：响应数据变化执行副作用
- watchEffect：自动收集依赖
- 避免滥用 watch：能用 computed 的不用 watch

### 渲染优化
- v-once：静态内容只渲染一次
- v-memo：条件缓存子树
- shallowRef/shallowReactive：大对象浅层响应
- 虚拟滚动：长列表使用 vue-virtual-scroller

### 懒加载
- 异步组件：defineAsyncComponent
- 路由懒加载：() => import('./views/User.vue')
- 图片懒加载：v-lazy 指令

## 状态管理（Pinia/Vuex）

- Setup Store：使用 Composition API 风格
- Actions：异步操作放在 actions
- Getters：派生状态用 getters
- 模块化：按功能拆分 store
- pinia-plugin-persistedstate：持久化插件
- 选择性持久化：仅持久化必要状态

## 模板最佳实践

- v-for 必须绑定 key，使用唯一标识符
- v-for 与 v-if 优先级：v-for 优先级更高
- 列表过滤：用 computed 预处理
- 动态 class：对象语法 { active: isActive }
- 动态 style：对象语法 { color: textColor }
- CSS Modules：scoped 样式避免污染

## TypeScript 集成

- defineProps：使用泛型定义 props 类型
- defineEmits：定义事件类型
- ref：指定类型 ref<User | null>(null)
- reactive：接口定义类型

## 错误处理

- errorCaptured：捕获子组件错误
- 全局错误处理：app.config.errorHandler
- 异步错误：onErrorCaptured 无法捕获
- loading/error 状态：三态模式
