> 来源：<https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md>

SFlow需求澄清智能体：`packages/opencode-adapter/src/agents/need-explorer.ts` 提示词借鉴了 grilling 中的 3 点：

1. **区分"事实"和"决策"** — 最大亮点

   > "If a fact can be found by exploring the codebase, look it up rather than asking me. The decisions, though, are mine"

2. **"沿着设计树的分支逐个走"** — 结构化追问

   > "Walk down each branch of the design tree, resolving dependencies between decisions one-by-one"

3. **"共享理解"而非"清晰需求"**

   > "Do not enact the plan until I confirm we have reached a shared understanding"