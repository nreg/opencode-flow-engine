---
name: design-reference
description: 71 个大厂 Design System 参考库，用于 ui-director 调性预选。提供品牌索引、色值、字体、调性描述，按行业分组。
---

# Design Reference — 71 Brand Design Systems

## 用途

本 skill 为 `ui-director` 子代理提供调性预选阶段的参考品牌库。用户通过选择知名品牌来快速锁定设计方向，而非从抽象调性卡片开始。

## 使用方式

ui-director 在 Step 1（调性确认）中调用：

```
skill(name="design-reference")
```

获取品牌索引后，按以下逻辑筛选推荐：

### 行业推荐规则

根据项目类型从对应行业组中选 5-7 个品牌推荐，优先选同行业品牌，然后跨行业补充：

| 项目类型 | 首选行业组 | 补充行业组 |
|----------|-----------|-----------|
| AI 产品 / LLM 平台 | AI 与平台 | 开发者工具 |
| 开发者工具 / IDE | 开发者工具 | 后端与 DevOps |
| SaaS / 企业软件 | 生产力与 SaaS | 设计与创意 |
| 金融科技 / 支付 | 金融科技 | 后端与 DevOps |
| 电商 / 零售 | 电商与零售 | 媒体与消费科技 |
| 媒体 / 内容平台 | 媒体与消费科技 | 设计与创意 |
| 汽车 / 高端品牌 | 汽车 | 媒体与消费科技 |
| 设计工具 / 创意平台 | 设计与创意 | 生产力与 SaaS |

### 用户选择后的流程

1. 用户选中品牌后，ui-director 读取 `data/<brand>/DESIGN.md` 完整文件（skill 自包含）
2. 从 frontmatter 提取 `colors` 和 `typography` 字段
3. 将颜色值转为 OKLCH 格式
4. 写入 `ui-design.md` 的 Design Tokens 段
5. 进入 Step 4（5 维决策）让用户微调

---

## 品牌索引

### AI 与大语言模型平台

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Claude | `#cc785c` | Copernicus, serif | 暖色调赤陶色点缀，简洁编辑式布局，人文 AI 感 |
| Cohere | `#17171c` | — | 企业级 AI 平台，充满活力的渐变，数据丰富仪表盘 |
| ElevenLabs | `#292524` | Waldenburg, serif | 深色电影感 UI，音频波形美学，沉浸式体验 |
| Minimax | `#0a0a0a` | — | 大胆深色界面搭配霓虹点缀，技术力量感 |
| Mistral AI | `#fa520f` | — | 法式极简主义，紫色调，开源权重 LLM 提供商 |
| Ollama | `#000000` | — | 终端优先，单色简约风格，本地 LLM 运行 |
| OpenCode AI | `#201d1d` | — | 面向开发者的深色主题，AI 编码平台 |
| Replicate | `#ea2804` | — | 干净的白色画布，代码导向，ML 模型 API |
| Runway | `#000000` | — | 电影感深色主视觉，编辑式电影节美学，AI 创意工具 |
| Together AI | `#000000` | — | 技术性蓝图式设计风格，开源 AI 基础设施 |
| VoltAgent | `#00d992` | — | 虚空黑画布，翡翠绿点缀，终端原生风格，AI Agent 框架 |
| xAI | `#ffffff` | — | Stark 黑白，未来极简主义，Elon Musk 的 AI 实验室 |

### 开发者工具与 IDE

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Cursor | `#f54e00` | CursorGothic | AI 优先代码编辑器，精致深色界面，渐变点缀 |
| Expo | `#000000` | Inter | 深色主题，紧凑字间距，代码中心，React Native 平台 |
| Lovable | `#000000` | — | 趣味渐变，友好的开发者美学，AI 全栈构建器 |
| Raycast | `#ffffff` | — | 精致深色 Chrome，充满活力的渐变点缀，效率启动器 |
| Superhuman | `#1b1938` | Super Sans VF | 高端深色 UI，键盘优先，紫色光晕，极速邮件客户端 |
| Vercel | `#171717` | Geist | 黑白精准，多色渐变，开发者部署平台 |
| Warp | `#f7f5f0` | — | 深色 IDE 式界面，基于块的命令 UI，现代化终端 |

### 后端、数据库与 DevOps

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| ClickHouse | `#faff69` | Inter | 黄色点缀，技术文档风格，高速分析数据库 |
| Composio | `#0007cd` | abcDiatype | 现代深色搭配彩色集成图标，工具集成平台 |
| HashiCorp | `#000000` | — | 企业级简洁，黑白风格，基础设施自动化 |
| MongoDB | `#00ed64` | — | 绿色叶子品牌，开发者文档导向，文档数据库 |
| PostHog | `#f7a501` | — | 趣味刺猬品牌，开发者友好深色 UI，产品分析 |
| Sanity | `#000000` | — | 深色优先编辑式营销界面，无头内容平台 |
| Sentry | `#150f23` | Sentri Display | 深色仪表盘，数据密集，粉紫点缀，错误监控 |
| Supabase | `#3ecf8e` | Circular | 深翡翠绿主题，代码优先，开源 Firebase 替代品 |

### 生产力与 SaaS

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Cal.com | `#111111` | Cal Sans | 干净中性 UI，面向开发者的简约风格，开源排程工具 |
| Intercom | `#111111` | — | 友好蓝色调色板，对话式 UI 模式，客户消息平台 |
| Linear | `#5e6ad2` | Linear Display | 超极简，精准，紫色点缀，面向工程师的项目管理 |
| Mintlify | `#0a0a0a` | — | 干净，绿色点缀，阅读优化，文档平台 |
| Notion | `#5645d4` | Notion Sans | 温暖极简主义，衬线标题，柔和质感，一体化工作空间 |
| Resend | `#fcfdff` | — | 极简深色主题，等宽字体点缀，面向开发者的邮件 API |
| Zapier | `#ff4f00` | — | 温暖橙色，友好插画驱动风格，自动化平台 |

### 设计与创意工具

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Airtable | `#181d26` | Haas Groot Disp | 多彩友好，结构化数据美学，电子表格与数据库混合体 |
| Clay | `#0a0a0a` | Plain Black | 有机形状，柔和渐变，艺术指导式布局，创意代理公司 |
| Figma | `#000000` | — | 充满活力多色，有趣且专业，协作设计工具 |
| Framer | `#ffffff` | — | 大胆黑蓝配色，动效优先，设计导向，网站构建器 |
| Miro | `#1c1c1e` | — | 明亮黄色点缀，无限画布美学，可视化协作 |
| Webflow | `#080808` | — | 蓝色点缀，精致营销站点美学，可视化建站工具 |

### 金融科技与加密货币

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Binance | `#fcd535` | BinanceNova | 单色背景上的醒目黄色，交易紧迫感，加密货币交易所 |
| Coinbase | `#0052ff` | Coinbase Display | 干净蓝色标识，注重信任，机构感，加密货币交易所 |
| Kraken | `#000000` | — | 紫色点缀深色 UI，数据密集型仪表盘，加密货币交易平台 |
| Mastercard | `#000000` | — | 温暖奶油色画布，轨道胶囊形状，编辑式温暖感，支付网络 |
| Revolut | `#494fdf` | — | 精致深色界面，渐变卡片，金融科技精准感，数字银行 |
| Stripe | `#533afd` | Sohne 300 | 标志性紫色渐变，轻盈优雅（字重 300），支付基础设施 |
| Wise | `#9fe870` | — | 明亮绿色点缀，友好清晰，国际汇款 |

### 电商与零售

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Airbnb | `#ff385c` | Airbnb Cereal VF | 温暖珊瑚色点缀，摄影驱动，圆角 UI，旅行市场 |
| Meta | `#0064e0` | — | 摄影优先，二元明暗表面，蓝色 CTA，科技零售商店 |
| Nike | `#111111` | — | 单色 UI，超大号大写 Futura 字体，满版摄影，运动零售 |
| Shopify | `#000000` | NeueHaasGrotesk | 深色优先电影感，霓虹绿点缀，超轻显示字体，电商平台 |
| Starbucks | `#000000` | — | 四级大地绿色系统，温暖奶油色画布，咖啡零售旗舰店 |

### 媒体与消费科技

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| Apple | `#0066cc` | SF Pro Display | 高级留白，SF Pro 字体，电影级影像，消费电子 |
| IBM | `#0f62fe` | IBM Plex Sans | Carbon 设计系统，结构化蓝色调色板，企业技术 |
| NVIDIA | `#76b900` | — | 绿黑能量感，技术力量美学，GPU 计算 |
| Pinterest | `#e60023` | — | 红色点缀，瀑布流网格，图片优先，视觉发现平台 |
| PlayStation | `#0070d1` | — | 三表面通道布局，青色悬停缩放交互，游戏主机零售 |
| SpaceX | `#000000` | D-DIN-Bold | Stark 黑白，满版影像，未来感，航天技术 |
| Spotify | `#000000` | — | 深色背景上的活力绿，大胆字体，专辑封面驱动，音乐流媒体 |
| The Verge | `#000000` | — | 酸橙绿与超紫点缀，Manuka 显示字体，科技编辑媒体 |
| Uber | `#000000` | — | 大胆黑白，紧凑字体，都市能量，出行平台 |
| Vodafone | `#e60000` | — | 纪念碑式大写显示字体，红色章节色带，全球电信品牌 |
| WIRED | `#000000` | — | 纸白报纸密度，定制衬线字体，墨蓝链接，科技杂志 |

### 汽车

| 品牌 | 主色 | 字体 | 调性描述 |
|------|------|------|----------|
| BMW | `#1c69d4` | BMW Type Next Latin | 深色高级质感，精准德国工程美学，豪华汽车 |
| BMW M | `#ffffff` | BMWTypeNextLatin | 赛车灵感对比，M 色彩点缀，精准驱动布局，性能汽车 |
| Bugatti | `#ffffff` | Bugatti Display | 影院黑画布，单色肃穆，纪念碑式显示字体，豪华超跑 |
| Ferrari | `#da291c` | FerrariSans | 明暗对比黑白编辑式，法拉利红极度克制，豪华汽车 |
| Lamborghini | `#000000` | — | 真黑大教堂，金色点缀，定制 Neo-Grotesk 字体，豪华汽车 |
| Renault | `#ffed00` | — | 生动极光渐变，零圆角按钮，法国汽车 |
| Tesla | `#000000` | — | 激进减法设计，电影级全屏摄影，Universal Sans 字体，电动汽车 |

---

## 快速推荐矩阵

### 按调性筛选

| 调性方向 | 推荐品牌 |
|----------|---------|
| 极简 / 留白 | Apple, Linear, Vercel, Tesla |
| 暗色 / 力量 | SpaceX, Nike, Bugatti, Lamborghini |
| 温暖 / 人文 | Claude, Notion, Airbnb, Intercom |
| 精准 / 企业 | IBM, Stripe, HashiCorp, Mastercard |
| 活力 / 多彩 | Figma, Zapier, Pinterest, Spotify |
| 技术 / 代码 | Cursor, Supabase, Vercel, Sentry |
| 科幻 / 未来 | xAI, SpaceX, Runway, NVIDIA |
| 金融 / 信任 | Stripe, Coinbase, Revolut, Wise |

### 按色系筛选

| 色系 | 推荐品牌 |
|------|---------|
| 蓝色主色 | Apple, Coinbase, IBM, Linear, BMW |
| 红色/橙色主色 | Cursor, Ferrari, Pinterest, Zapier, Mistral |
| 绿色主色 | MongoDB, Supabase, Spotify, Wise, VoltAgent |
| 紫色主色 | Stripe, Notion, Revolut, Slack, Superhuman |
| 黄色/金色主色 | Binance, ClickHouse, PostHog, Renault, Lamborghini |
| 黑白/单色 | Vercel, Nike, Tesla, SpaceX, Uber |

---

## ui-design.md Token 继承规则

用户选中品牌后，ui-director 按以下规则从 DESIGN.md 提取 tokens：

### 颜色映射

| ui-design.md 字段 | DESIGN.md 字段 | 说明 |
|-------------------|----------------|------|
| `colors.primary` | `primary` | 主色/CTA 色 |
| `colors.background` | `canvas` | 页面背景色 |
| `colors.text` | `ink` | 主要文字色 |
| `colors.text-muted` | `ink-muted` / `body` | 次级文字色 |
| `colors.border` | `hairline` | 边框色 |
| `colors.surface` | `surface-1` / `surface-card` | 卡片/表面色 |

### 字体映射

| ui-design.md 字段 | DESIGN.md 字段 | 说明 |
|-------------------|----------------|------|
| `typography.display` | `display-xl` / `display-lg` 的 `fontFamily` | 展示字体 |
| `typography.body` | `body` 的 `fontFamily` | 正文字体 |
| `typography.mono` | 如有 `code` 或 `mono` 字段 | 等宽字体 |

### 颜色格式转换

```
HEX → OKLCH 转换规则：
1. 保留 DESIGN.md 中已有的 OKLCH 值不动
2. HEX 值在 ui-design.md 中按原样保留（前端工具链需要 HEX）
3. 在 Design Tokens 段同时标注 OKLCH 和 HEX 两套值
```

---

## 注意事项

1. 本 skill 只包含品牌索引，不包含完整 DESIGN.md 内容
2. 完整 DESIGN.md 文件保存在 `data/<brand>/DESIGN.md`（skill 自包含，无需外部依赖）
3. 用户选中品牌后，ui-director 需按需读取完整文件
4. 品牌选择是参考起点，不是最终设计——用户应在 Step 4（5 维决策）中微调
5. 如果用户明确表示"不要参考任何品牌"，回退到现有 9 调性卡片流程