# 前端安全检查清单

## XSS 防护

### 输入输出处理
- 用户输入必须转义后再渲染
- 使用框架的安全渲染：React 自动转义，Vue 的 {{ }} 自动转义
- 富文本内容使用 DOMPurify 库清理
- URL 参数拼接前编码：encodeURIComponent

### 危险 API 避免
- 避免使用 innerHTML、outerHTML、document.write
- 避免使用 eval、new Function、setTimeout(string)
- 避免使用 v-html（Vue）、dangerouslySetInnerHTML（React）
- 必须使用时，内容必须经过严格清理

## CSRF 防护

### Token 机制
- 关键操作必须验证 CSRF Token
- Token 存储在 HttpOnly Cookie
- 每次请求携带 Token：X-CSRF-Token
- Token 定期刷新

### SameSite Cookie
- Cookie 设置 SameSite=Strict 或 SameSite=Lax
- 跨站请求禁止携带 Cookie（Strict）
- 顶级导航允许携带 Cookie（Lax）

## 敏感信息保护

- 禁止在前端代码中硬编码 API Key、Secret、Token
- 敏感配置通过环境变量注入
- .env 文件加入 .gitignore
- 生产环境禁用 Source Map
- 日志输出脱敏：不打印用户手机号、身份证
- 前端展示脱敏：手机号中间 4 位显示为 *
- 本地存储慎用：不存储敏感信息
- 内存中及时清理：使用完的敏感数据及时置为 null

## 权限控制

- 路由守卫：未登录跳转登录页
- 按钮/菜单权限：根据用户角色动态显示
- 前端校验仅作为 UX 优化，后端必须再次校验
- 避免仅前端隐藏敏感信息
- 用户 ID 从 Token 解析，不接受前端传递
- 资源 ID 校验：用户只能访问自己有权限的资源
- 避免通过修改 URL 参数越权访问

## 第三方依赖安全

- 定期运行 npm audit/yarn audit
- 及时更新有漏洞的依赖版本
- 使用 Snyk/Dependabot 自动监控
- 锁定依赖版本：package-lock.json/yarn.lock
- 从官方源安装依赖
- 按需引入第三方库

## 传输安全

- 全站强制 HTTPS
- HSTS 响应头：Strict-Transport-Security
- 敏感接口使用 POST
- 响应头 X-Content-Type-Options: nosniff
- 响应头 X-Frame-Options: DENY
- Content-Security-Policy 配置

## 点击劫持防护

- X-Frame-Options: DENY 禁止任何域嵌入
- 或 X-Frame-Options: SAMEORIGIN 仅允许同源嵌入
- CSP frame-ancestors 'none' 或 'self'

## 用户追踪与隐私

- 第三方追踪脚本告知用户
- 提供 Do Not Track 支持
- 遵守隐私法规：GDPR、CCPA
- 非必要 Cookie 需用户同意
