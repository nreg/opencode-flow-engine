# 运行时性能最佳实践

## JavaScript 执行优化

- 超过 50ms 的任务阻塞主线程
- 使用 requestIdleCallback 在空闲时间执行
- 大计算任务拆分为多个小任务
- 使用 setTimeout(..., 0) 让出主线程
- 大数据处理：排序、过滤、搜索移到 Worker
- 复杂计算：加密、解密、压缩在 Worker 中执行
- 图片处理：Canvas 操作在 Worker 中进行
- 避免频繁 postMessage：批量传递数据
- 防抖（debounce）：搜索输入、窗口 resize
- 节流（throttle）：滚动事件、mousemove
- 选择合适的延迟：搜索 300-500ms，滚动 16ms
- 避免在回调中做复杂计算

## 渲染性能优化

- 批量修改 DOM：使用 DocumentFragment
- 批量修改样式：一次性设置 style.cssText
- 避免频繁读取布局属性
- 使用 CSS transform/opacity 做动画
- 长列表（>100项）只渲染可视区域
- 使用成熟库：react-window、vue-virtual-scroller
- 固定高度列表性能更好
- 列表项组件轻量化
- 使用 CSS 动画而非 JS 动画
- will-change 提示浏览器优化
- 避免在滚动/动画回调中做复杂计算
- 使用 requestAnimationFrame 同步动画

## 内存管理

- 及时清理定时器：clearInterval/clearTimeout
- 及时移除事件监听：removeEventListener
- 及时清理订阅：Redux/Vuex unsubscribe
- 组件卸载时取消未完成的异步请求
- 避免闭包持有大对象引用
- 避免全局变量累积
- 缓存策略：LRU 缓存限制大小
- 大对象及时置为 null
- Chrome DevTools Memory 面板
- Performance Monitor：实时监控
- window.performance.memory

## 事件处理优化

- 列表项事件绑定到父元素
- 动态内容事件委托
- 使用 event.target 判断事件源
- 滚动/触摸事件设置 passive: true
- addEventListener('scroll', handler, { passive: true })
- 快速连续点击：防抖或记录上次点击时间
- 表单提交：提交后禁用按钮
- 路由跳转：跳转中禁用链接

## 网络请求优化

- 多个小接口合并为一个批量接口
- GraphQL 批量查询
- 接口缓存：相同请求复用结果
- 组件卸载时取消未完成请求
- 路由切换时取消上一页请求
- 搜索输入防抖时取消上次请求
- 关键数据提前请求
- 鼠标悬停时预加载
- 路由预加载

## 框架特定优化

- React.memo 避免不必要重渲染
- useMemo/useCallback 缓存
- 虚拟列表：react-window
- computed 替代 watch，有缓存
- v-once 静态内容只渲染一次
- v-memo 条件缓存子树
- shallowRef/shallowReactive 大对象浅层响应
- OnPush 变更检测策略
- trackBy 优化 ngFor 列表渲染
