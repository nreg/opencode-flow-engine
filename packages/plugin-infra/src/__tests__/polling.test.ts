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
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockResolvedValue({
      data: [{ parts: [{ type: "text", text: "Hello from new session" }] }],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: true,
      maxWaitMs: 30000,
    });

    expect(result).toBe("Hello from new session");
    expect(mockClient.session.messages).toHaveBeenCalledTimes(1);
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
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockResolvedValue({
      data: [{ parts: [{ type: "text", text: "Message despite status error" }] }],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: true,
    });

    expect(result).toBe("Message despite status error");
  });

  // REQ-3: status 异常但消息可读
  test("status异常但消息可读返回最后消息", async () => {
    mockClient.session.status.mockRejectedValue(new Error("status error"));
    mockClient.session.messages.mockResolvedValue({
      data: [{ parts: [{ type: "text", text: "Recovered message" }] }],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
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
    mockClient.session.status.mockResolvedValue({ data: [] });
    mockClient.session.messages.mockResolvedValue({
      data: [{ parts: [{ type: "text", text: "First output" }] }],
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
    });

    expect(result).toBe("First output");
    expect(mockClient.session.messages).toHaveBeenCalledTimes(1);
  });

  // REQ-5: 非新会话消息计数为 0 继续轮询
  test("非新会话消息计数为0继续轮询", async () => {
    let attempt = 0;
    mockClient.session.status.mockImplementation(() => {
      attempt++;
      if (attempt >= 3) {
        return Promise.resolve({ data: [{ id: "session-1", type: "idle" }] });
      }
      return Promise.resolve({ data: [] });
    });
    mockClient.session.messages.mockImplementation(() => {
      attempt++;
      if (attempt >= 4) {
        return Promise.resolve({
          data: [{ parts: [{ type: "text", text: "Late message" }] }],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const result = await pollSessionCompletion(mockClient as any, "session-1", {
      isNew: false,
      maxWaitMs: 10000,
    });

    expect(result).toBe("Late message");
    expect(mockClient.session.messages).toHaveBeenCalledTimes(2);
  });
});
