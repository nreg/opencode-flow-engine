import { describe, test, expect, vi, beforeEach } from "bun:test";
import { pollSessionCompletion } from "../helpers/polling.js";

describe("pollSessionCompletion", () => {
  let mockClient: {
    session: {
      status: ReturnType<typeof vi.fn>;
      messages: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockClient = {
      session: {
        status: vi.fn(),
        messages: vi.fn(),
      },
    };
  });

  // REQ-1: 超时后返回 null
  test("超时后返回null", async () => {
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockResolvedValue({ data: [] });

    const start = Date.now();
    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 3000,
    });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(5000);
  });

  // REQ-2: session idle + 消息数稳定 3 次 = 完成
  test("session idle且消息数稳定3次后返回消息", async () => {
    let pollCount = 0;
    mockClient.session.status.mockImplementation(() => {
      pollCount++;
      // 前 2 次 poll 返回 active，第 3 次开始返回 idle
      if (pollCount >= 3) {
        return Promise.resolve({ data: [{ id: "session-1", type: "idle" }] });
      }
      return Promise.resolve({ data: [{ id: "session-1", type: "running" }] });
    });
    mockClient.session.messages.mockResolvedValue({
      data: [
        { info: { role: "user" }, parts: [{ type: "text", text: "prompt" }] },
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Build complete" }] },
      ],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });

    // 第 3 次 poll 开始 idle，需要 3 次稳定（第 3/4/5 次）→ 5 polls × 2000ms = 10s
    // 但第 3 次 poll 时 status 首次返回 idle，之前的 polls 都是 active（重置了稳定计数器）
    // 实际流程：poll 1-2 active → poll 3 idle + 消息稳定 = stable=1 → poll 4 idle + stable=2 → poll 5 idle + stable=3 → 完成
    expect(result).toBe("Build complete");
  });

  // REQ-3: status 返回 idle 但消息数在变化，等待稳定
  test("idle后消息数变化则重置稳定计数器", async () => {
    let pollCount = 0;
    mockClient.session.status.mockResolvedValue({
      data: [{ id: "session-1", type: "idle" }],
    });
    mockClient.session.messages.mockImplementation(() => {
      pollCount++;
      // 前 2 次消息数变化，第 3 次开始稳定
      if (pollCount <= 2) {
        return Promise.resolve({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Partial" }] }] });
      }
      return Promise.resolve({ data: [
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Final result" }] },
      ] });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });

    expect(result).toBe("Final result");
  });

  // REQ-4: status 异常但消息可读 → 最终通过 readSessionLastMessage 返回
  test("status异常但消息可读返回最后消息", async () => {
    let callIdx = 0;
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ data: [] });
      // 后续调用返回消息（status 持续失败 → 最终 session 消失检测触发）
      return Promise.resolve({
        data: [
          { info: { role: "assistant" }, parts: [{ type: "text", text: "Recovered message" }] },
        ],
      });
    });

    // status 持续失败 + messages 成功 → 不会触发 session 消失（需要两者都失败）
    // 但 idle 检测也会失败（status 异常），消息检查会持续运行
    // 最终 idle 检测失败 → 消息检查发现消息数稳定 → 但 isIdle=false 时不走稳定检测路径
    // 实际上 status 异常时 statusFailed=true，isIdle=false，跳过 "active 重置" 分支
    // 消息检查：currentMsgCount > 0 && currentMsgCount === lastMsgCount
    // 但由于 statusFailed=true，stablePolls 不会增加（stablePolls 仅在 !statusFailed 时增加）
    // 所以永远不会通过稳定检测 → 最终超时返回 readSessionLastMessage
    
    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 3000,
      pollIntervalMs: 100,
    });

    expect(result).toBe("Recovered message");
  });

  // REQ-5: status 和 messages 同时失败 → session 消失检测
  test("连续status+messages失败触发session消失检测", async () => {
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockRejectedValue(new Error("messages error"));

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 5000,
    });

    // 两者都失败 → 2 次连续失败后 readSessionLastMessage 也被调用但失败 → 返回 null
    expect(result).toBeNull();
  });

  // REQ-6: session 消失但 readSessionLastMessage 仍可读
  test("session消失但readSessionLastMessage仍可读返回内容", async () => {
    let callCount = 0;
    mockClient.session.status.mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error("status error"));
    });
    mockClient.session.messages.mockImplementation(() => {
      callCount++;
      // 前 2 轮都失败（2 次连续失败触发 session 消失）
      // 第 5 次调用来自 readSessionLastMessage（在 session 消失后）
      if (callCount === 5) {
        return Promise.resolve({
          data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Fallback content" }] }],
        });
      }
      // 第 1 次（初始）+ 第 2/3 次（循环中 2 次失败）→ 共 4 次失败？
      // 不对，初始计数采集在循环外，不算在 session 消失检测中
      // 循环内：第 1 次 poll: status 失败 + messages 失败 → consecutiveFailures=1
      // 第 2 次 poll: status 失败 + messages 失败 → consecutiveFailures=2 → 触发 session 消失 → readSessionLastMessage
      // 所以：初始采集(1) + poll1(2) + poll2(2) = 5 次 messages 调用
      if (callCount <= 4) {
        return Promise.reject(new Error("messages error"));
      }
      return Promise.reject(new Error("messages error"));
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 10000,
    });

    expect(result).toBe("Fallback content");
  });

  // REQ-7: idle 状态 + 消息数稳定 = 快速返回
  test("idle状态且消息稳定快速返回", async () => {
    mockClient.session.status.mockResolvedValue({
      data: [{ id: "session-1", type: "idle" }],
    });
    mockClient.session.messages.mockResolvedValue({
      data: [
        { info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] },
      ],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });

    expect(result).toBe("Done");
  });
});