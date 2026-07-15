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

  // REQ-1: 默认超时 30s
  test("默认超时参数调用：未完成时返回null", async () => {
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockResolvedValue({ data: [] });

    const start = Date.now();
    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 1000,
    });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(800);
    expect(elapsed).toBeLessThan(2000);
  });

  // REQ-1: 显式指定超时
  test("显式指定maxWaitMs：自定义超时生效", async () => {
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockResolvedValue({ data: [] });

    const start = Date.now();
    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      maxWaitMs: 500,
    });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(1500);
  });

  // REQ-2: 新会话首次读到消息即返回
  test("isNew=true首次读到消息立即返回", async () => {
    let callIdx = 0;
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockImplementation(() => {
      callIdx++;
      // 首次调用是初始计数采集（无消息）
      if (callIdx === 1) return Promise.resolve({ data: [] });
      // 后续调用模拟有 assistant 响应（1条用户消息 + 1条响应 = 2条）
      return Promise.resolve({
        data: [
          { parts: [{ type: "text", text: "user prompt" }] },
          { parts: [{ type: "text", text: "Hello from new session" }] },
        ],
      });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: true,
      maxWaitMs: 5000,
    });

    expect(result).toBe("Hello from new session");
  });

  // REQ-2: 新会话 status 返回 idle
  test("isNew=true status返回idle即返回", async () => {
    mockClient.session.status.mockResolvedValue({
      data: [{ id: "session-1", type: "idle" }],
    });
    mockClient.session.messages.mockResolvedValue({
      data: [{ parts: [{ type: "text", text: "Last message" }] }],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: true,
    });

    expect(result).toBe("Last message");
  });

  // REQ-2: 新会话 status 失败但有消息
  test("isNew=true status失败但消息可读即返回", async () => {
    let callIdx = 0;
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: [
          { parts: [{ type: "text", text: "user prompt" }] },
          { parts: [{ type: "text", text: "Message despite status error" }] },
        ],
      });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: true,
      maxWaitMs: 5000,
    });

    expect(result).toBe("Message despite status error");
  });

  // REQ-3: status 异常但消息可读
  test("status异常但消息可读返回最后消息", async () => {
    let callIdx = 0;
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockImplementation(() => {
      callIdx++;
      // 首次调用是初始计数采集
      if (callIdx === 1) return Promise.resolve({ data: [] });
      // 后续调用返回消息（count=1 >= minDetectCount=1 for isNew=false）
      return Promise.resolve({
        data: [{ parts: [{ type: "text", text: "Recovered message" }] }],
      });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 5000,
    });

    expect(result).toBe("Recovered message");
  });

  // REQ-3: status 异常且消息不可读
  test("status异常且消息不可读 fallback到readSessionLastMessage", async () => {
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockRejectedValue(new Error("messages error"));

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 2000,
    });

    expect(result).toBeNull();
  });

  // REQ-4: 连续 status+messages 失败 -> 返回 null
  test("连续status+messages失败返回null", async () => {
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockRejectedValue(new Error("messages error"));

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 2000,
    });

    expect(result).toBeNull();
  });

  // REQ-4: 会话消失但 readSessionLastMessage 仍可读
  test("会话消失但readSessionLastMessage仍可读返回内容", async () => {
    let callCount = 0;
    mockClient.session.status.mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error("status error"));
    });
    mockClient.session.messages.mockImplementation(() => {
      callCount++;
      // 5th call is from readSessionLastMessage after 2 dual-failure polls
      if (callCount === 5) {
        return Promise.resolve({
          data: [{ parts: [{ type: "text", text: "Fallback content" }] }],
        });
      }
      return Promise.reject(new Error("messages error"));
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 5000,
    });

    expect(result).toBe("Fallback content");
  });

  // REQ-5: 非新会话首次读到消息立即返回
  test("非新会话首次读到消息立即返回", async () => {
    let callIdx = 0;
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ data: [] });
      return Promise.resolve({
        data: [{ parts: [{ type: "text", text: "First output" }] }],
      });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 5000,
    });

    expect(result).toBe("First output");
  });

  // REQ-5: 非新会话消息计数为 0 继续轮询
  test("非新会话消息计数为0继续轮询", async () => {
    let statusCall = 0;
    let msgCall = 0;
    mockClient.session.status.mockImplementation(() => {
      statusCall++;
      if (statusCall >= 2) {
        return Promise.resolve({ data: [{ id: "session-1", type: "idle" }] });
      }
      return Promise.resolve({ data: [] });
    });
    mockClient.session.messages.mockImplementation(() => {
      msgCall++;
      if (msgCall === 1) return Promise.resolve({ data: [] }); // 初始计数采集
      return Promise.resolve({ data: [] }); // 循环中消息计数仍为0
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 10000,
    });

    expect(result).toBeNull();
  });
});
