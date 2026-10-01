/**
 * P1-1：session.error 事件预降级的「模型归属护栏」纯函数。
 *
 * 【问题根因】
 * 轮询 / watcher 的故障转移（fallback）会在同一 taskID / sessionID 下把
 * `BackgroundTaskEntry.resolvedModel` 改写为健康新模型 B，并把失败模型 A 累积进
 * `attemptedModels`（形如 [A, B]）。SDK 的 `session.error` 事件体只携带
 * `sessionID` + `error`，**不包含模型标识**，因此事件触发点无法从事件本身得知
 * "这条错误属于旧模型 A 还是新模型 B"。事件处理器随后用 sessionID 反查 registry，
 * 查到的 `resolvedModel` 已经是 B —— 于是迟到的、属于 A 的 429/402 错误事件
 * 会把当前健康模型 B 误拉黑（blacklist poison）。
 *
 * 【方案选型】
 * 报告给出的候选方向里，
 *   - "事件体带 model" —— 不可行：SDK 事件体结构固定，事件触发点读到也已是被改写后的
 *     `resolvedModel`，无法恢复历史模型；
 *   - "running + resolvedModel 比对 / 时间序列栅栏" —— 依赖事件到达时序，时序边界无法
 *     可靠判定，且会引入竞态；
 *   - **"仅 attemptedModels.length <= 1 才走事件路径拉黑"（本实现的等价方案）** ——
 *     选此方案。理由：
 *       1. registry 已是唯一权威状态源，`attemptedModels` 明确记录"是否已换模"，
 *          判定零时序依赖、无竞态；
 *       2. 侵入面最小：纯函数 + 三工厂 modelResolver 各 3 行，handler 签名 / 分类函数
 *          签名与返回联合均不变（不破坏既有测试与 E1 契约）；
 *       3. 语义安全：已换模的 session 交给**轮询路径**处理 —— 轮询路径掌握确切的失败
 *          模型（失败会话的 model 是确定的），拉黑仍会发生，只是改由正确的路径执行；
 *       4. 与 C-6（禁文案匹配）、abort 零降级、3s 去重窗口等既有约束零冲突。
 *
 * 【语义】
 * - `attempted.length <= 1`：该 session 尚未换模，事件路径可直接反查并拉黑当前模型。
 * - `attempted.length > 1`：已换模，事件路径返回 undefined（分类失败 → 'no-model'、
 *   不拉黑），把拉黑让渡给轮询路径，杜绝误伤健康新模型。
 */

/**
 * 判定某 session 在「事件预降级路径」下是否允许拉黑，并给出应拉黑的候选模型。
 *
 * 这是 P1-1 的护栏核心：把「是否已发生 fallback 换模」的决策集中在一处，
 * 三工厂共用同一份语义，避免各工厂各写一遍导致行为漂移。
 *
 * @param entry - backgroundTaskRegistry 中的 BackgroundTaskEntry（可能为 undefined）
 * @returns 允许拉黑时返回该 session 当前的 `resolvedModel`；
 *         不允许拉黑（已换模 / 无记录 / 无模型）返回 undefined。
 */
export function sessionErrorModelForBlacklist(
  entry: { resolvedModel?: string; attemptedModels?: string[] } | undefined,
): string | undefined {
  if (!entry) {
    return undefined;
  }
  // P1-1 护栏：已换模（attemptedModels 长度 > 1）→ 事件路径不拉黑，交由轮询路径兜底
  const attempted = entry.attemptedModels ?? [];
  if (attempted.length > 1) {
    return undefined;
  }
  return entry.resolvedModel;
}
