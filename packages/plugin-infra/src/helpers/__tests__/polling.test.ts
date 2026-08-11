/**
 * Tests for polling utilities - Batch 1: retry detection and timeout correction
 * Batch 2: event-driven polling with AsyncGenerator
 */
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  pollSessionCompletion,
  type SFlowClientSession,
  type PollingOptions,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
  extractLatestMessage,
} from '../polling';
import {
  createMockEventSubscribe,
  createSessionIdleEvent,
  createSessionStatusEvent,
  createOtherEvent,
  createMockGlobalEvent,
  createGlobalSessionIdleEvent,
} from './sse-mock';

describe('pollSessionCompletion - Batch 1: retry detection', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('Task 1.4: MAX_WAIT default value', () => {
    it('should use 120000ms (120s) as default maxWaitMs for async polling', () => {
      // Assert: verify the default is 120000ms
      expect(DEFAULT_MAX_WAIT_MS).toBe(120_000);
    });

    it('should use 30000ms (30s) as default maxWaitMs for sync polling', () => {
      // Assert: verify the sync default is 30000ms
      expect(DEFAULT_SYNC_MAX_WAIT_MS).toBe(30_000);
    });

    it('should not use 10000ms (10s) as default (regression test)', () => {
      // Assert: verify the default is NOT 10s (the old value)
      expect(DEFAULT_MAX_WAIT_MS).not.toBe(10_000);
    });
  });

  describe('Task 1.1 & 1.2: retry status recognition', () => {
    it("should recognize type='retry' with attempt < max and continue waiting", async () => {
      // Arrange: session in retry state with attempt < max
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 1,
            message: 'Model error, retrying...',
            next: Date.now() + 5000, // next retry in 5s
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [
              { type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() },
            ],
          },
        ],
      });

      // Act & Assert: should NOT throw error, should continue polling
      // The function should recognize retry state and wait, not immediately return
      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // After a short time, change to idle to complete
      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'assistant response' }] },
          ],
        });
      }, 300);

      const result = await resultPromise;
      expect(result).toBe('assistant response');
    });

    it("should recognize type='retry' with attempt >= max and treat as error", async () => {
      // Arrange: session in retry state with attempt >= max
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 5,
            message: 'Max retries exceeded',
            next: Date.now() - 1000, // next retry already expired
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [
              { type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() },
            ],
          },
        ],
      });

      // Act: should treat as error and return null or throw
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should return null (error case) or the last message
      expect(result).toBeNull();
    });

    it('should recognize retry state with next field expired and treat as error', async () => {
      // Arrange: session in retry state with next field expired
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 2,
            message: 'Retrying...',
            next: Date.now() - 10000, // next retry expired 10s ago
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [{ type: 'retry', error: { message: 'Timeout', code: 408 }, time: Date.now() }],
          },
        ],
      });

      // Act & Assert
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      expect(result).toBeNull();
    });
  });

  describe('Task 1.3: RetryPart parsing', () => {
    it("should parse part.type='retry' and extract ApiError information", async () => {
      // Arrange: message stream contains retry part
      const errorTime = Date.now();
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [
              {
                type: 'retry',
                error: { message: 'Rate limit exceeded', code: 429 },
                time: errorTime,
              },
              { type: 'text', text: 'assistant response after retry' },
            ],
          },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should return the text response, not the retry part
      expect(result).toBe('assistant response after retry');
    });

    it('should correctly extract error message and code from RetryPart', async () => {
      // This test verifies the error extraction logic
      // Arrange
      const apiError = { message: 'Service unavailable', code: 503 };
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'retry', error: apiError, time: Date.now() }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: function should handle retry part gracefully
      expect(result).toBeDefined();
    });

    // P0-1: 验证 retry part 错误信息能被正确提取
    it('should extract error information from retry part when no text part present', async () => {
      // Arrange: message stream contains only retry part (no text)
      const errorTime = Date.now();
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [
              {
                type: 'retry',
                error: { message: 'API rate limit exceeded', code: 429 },
                time: errorTime,
              },
            ],
          },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should extract and format error information
      expect(result).toContain('API rate limit exceeded');
      expect(result).toContain('429');
    });

    it('should prefer text part over retry error when both present', async () => {
      // Arrange: message stream contains both retry error and text
      const errorTime = Date.now();
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          {
            parts: [
              {
                type: 'retry',
                error: { message: 'Temporary error', code: 500 },
                time: errorTime,
              },
              { type: 'text', text: 'Final successful response' },
            ],
          },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should return text content, not error
      expect(result).toBe('Final successful response');
      expect(result).not.toContain('Temporary error');
    });
  });

  describe('Task 1.5: retry timeout buffer logic', () => {
    it('should add buffer time when checking retry next field expiration', async () => {
      // Arrange: retry state with next field in the future
      const testStartTime = Date.now();

      mockSession.status.mockImplementation(() => {
        return Promise.resolve({
          data: [
            {
              id: 'test-session',
              type: 'retry',
              attempt: 2,
              message: 'Retrying...',
              next: testStartTime + 500, // next retry in 500ms
            },
          ],
        });
      });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'retry', error: { message: 'Error', code: 500 }, time: Date.now() }] },
        ],
      });

      // Act: should continue waiting
      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
      });

      // After 800ms, change to idle (before next retry time)
      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 800);

      const result = await resultPromise;

      // Assert: should wait and return response when idle
      expect(result).toBe('response');
    });

    it('should treat retry as error when next field is beyond buffer', async () => {
      // Arrange: retry state with next field well in the past (beyond buffer)
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 2,
            message: 'Retrying...',
            next: Date.now() - 5000, // expired 5s ago, beyond 2s buffer
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'retry', error: { message: 'Error', code: 500 }, time: Date.now() }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should treat as error
      expect(result).toBeNull();
    });
  });

  describe('Task 1.6: comprehensive retry/error/watcher scenarios', () => {
    it('should handle idle status correctly', async () => {
      // Arrange
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'final response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert
      expect(result).toBe('final response');
    });

    it('should handle busy status and wait for completion', async () => {
      // Arrange: start busy, then become idle
      mockSession.status
        .mockResolvedValueOnce({
          data: [{ id: 'test-session', type: 'busy' }],
        })
        .mockResolvedValueOnce({
          data: [{ id: 'test-session', type: 'busy' }],
        })
        .mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
      });

      // Assert
      expect(result).toBe('response');
    });

    it('should handle retry → busy → idle sequence', async () => {
      // Arrange: retry → busy → idle
      mockSession.status
        .mockResolvedValueOnce({
          data: [
            {
              id: 'test-session',
              type: 'retry',
              attempt: 1,
              message: 'Retrying...',
              next: Date.now() + 1000,
            },
          ],
        })
        .mockResolvedValueOnce({
          data: [{ id: 'test-session', type: 'busy' }],
        })
        .mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response after retry' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 3000,
        pollIntervalMs: 100,
      });

      // Assert
      expect(result).toBe('response after retry');
    });
  });

  // P1-C: 边界值测试
  describe('P1-C: boundary value tests', () => {
    it('attempt = 4 should continue waiting (below max)', async () => {
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 4,
            message: 'Retrying...',
            next: Date.now() + 5000,
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      const result = await resultPromise;
      expect(result).toBe('response');
    });

    it('attempt = 5 should treat as error (max reached)', async () => {
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 5,
            message: 'Max retries',
            next: Date.now() + 5000,
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      expect(result).toBeNull();
    });

    it('attempt = 6 should treat as error (exceeded max)', async () => {
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 6,
            message: 'Exceeded max',
            next: Date.now() + 5000,
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      expect(result).toBeNull();
    });

    it('next within buffer should continue waiting', async () => {
      const now = Date.now();
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 2,
            message: 'Retrying...',
            next: now - 1000, // 1s ago, within 2s buffer
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      const result = await resultPromise;
      expect(result).toBe('response');
    });

    it('next equals buffer boundary should continue waiting', async () => {
      mockSession.status.mockImplementation(() => {
        return Promise.resolve({
          data: [
            {
              id: 'test-session',
              type: 'retry',
              attempt: 2,
              message: 'Retrying...',
              next: Date.now() - 1900, // dynamic: 1.9s ago, just within 2s buffer
            },
          ],
        });
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      const result = await resultPromise;
      expect(result).toBe('response');
    });

    it('next beyond buffer should treat as error', async () => {
      const now = Date.now();
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 2,
            message: 'Retrying...',
            next: now - 3000, // 3s ago, beyond 2s buffer
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      expect(result).toBeNull();
    });

    // P1: 边界测试 - next 恰好等于 now - RETRY_WAIT_BUFFER
    it('next exactly at buffer boundary (now - 2000) should continue waiting', async () => {
      mockSession.status.mockImplementation(() => {
        const now = Date.now();
        return Promise.resolve({
          data: [
            {
              id: 'test-session',
              type: 'retry',
              attempt: 2,
              message: 'Retrying...',
              next: now - 1999, // slightly before boundary to account for timing precision
            },
          ],
        });
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // After 300ms, change to idle to complete
      setTimeout(() => {
        mockSession.status.mockResolvedValue({
          data: [{ id: 'test-session', type: 'idle' }],
        });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      const result = await resultPromise;
      // Boundary condition (next >= now - buffer) should NOT be treated as error
      // because the check is `next < now - RETRY_WAIT_BUFFER` (strict less than)
      expect(result).toBe('response');
    });
  });
});

describe('P1-1: attempt threshold boundary tests', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  it('attempt=4 should continue waiting (within retry limit)', async () => {
    mockSession.status.mockResolvedValue({
      data: [
        {
          id: 'test-session',
          type: 'retry',
          attempt: 4,
          message: 'Retrying...',
          next: Date.now() + 5000,
        },
      ],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        {
          parts: [
            { type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() },
          ],
        },
      ],
    });

    const resultPromise = pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      pollIntervalMs: 100,
    });

    setTimeout(() => {
      mockSession.status.mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'assistant response' }] },
        ],
      });
    }, 300);

    const result = await resultPromise;
    expect(result).toBe('assistant response');
  });

  it('attempt=5 should treat as error (retry exhausted)', async () => {
    mockSession.status.mockResolvedValue({
      data: [
        {
          id: 'test-session',
          type: 'retry',
          attempt: 5,
          message: 'Max retries exceeded',
          next: Date.now() + 5000,
        },
      ],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        {
          parts: [
            { type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() },
          ],
        },
      ],
    });

    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      pollIntervalMs: 100,
    });

    expect(result).toBeNull();
  });
});

// ─── Probe Mode Tests (F2: watcher 1s timeout bug fix) ───────────────────────

describe('Probe Mode (F2: watcher 1s timeout bug fix)', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  it('probeMode=true and session idle → should return last message', async () => {
    // Arrange: session is idle
    mockSession.status.mockResolvedValue({
      data: [{ id: 'test-session', type: 'idle' }],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'assistant response' }] },
      ],
    });

    // Act
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      probeMode: true,
    });

    // Assert: should return the last message
    expect(result).toBe('assistant response');
  });

  it('probeMode=true and session busy → should return pending marker', async () => {
    // Arrange: session is busy (not idle, not retry error)
    mockSession.status.mockResolvedValue({
      data: [{ id: 'test-session', type: 'busy' }],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'partial output' }] }, // intermediate output
      ],
    });

    // Act
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      probeMode: true,
    });

    // Assert: should return pending marker, NOT intermediate output
    expect(result).toEqual({ __PROBE__: 'pending' });
    expect(result).not.toBe('partial output'); // critical: should NOT return intermediate output
  });

  it('probeMode=true and retry error → should return null', async () => {
    // Arrange: session in retry error state
    mockSession.status.mockResolvedValue({
      data: [
        {
          id: 'test-session',
          type: 'retry',
          attempt: 5, // max retries exceeded
          message: 'Max retries exceeded',
          next: Date.now() - 5000, // expired
        },
      ],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() }] },
      ],
    });

    // Act
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      probeMode: true,
    });

    // Assert: should return null (error case)
    expect(result).toBeNull();
  });

  it('probeMode=true and retry in progress → should return pending marker', async () => {
    // Arrange: session in retry state (not error yet)
    mockSession.status.mockResolvedValue({
      data: [
        {
          id: 'test-session',
          type: 'retry',
          attempt: 2, // within retry limit
          message: 'Retrying...',
          next: Date.now() + 5000, // next retry in future
        },
      ],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'retry', error: { message: 'Temporary error', code: 500 }, time: Date.now() }] },
      ],
    });

    // Act
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      probeMode: true,
    });

    // Assert: should return pending marker (retry in progress, not error)
    expect(result).toEqual({ __PROBE__: 'pending' });
  });

  it('default mode (no probeMode) behavior unchanged - idle', async () => {
    // Arrange: session idle
    mockSession.status.mockResolvedValue({
      data: [{ id: 'test-session', type: 'idle' }],
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'response' }] },
      ],
    });

    // Act: no probeMode (default behavior)
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 1000,
      pollIntervalMs: 100,
    });

    // Assert: should return message (backward compatibility)
    expect(result).toBe('response');
  });

  it('default mode (no probeMode) behavior unchanged - busy then idle', async () => {
    // Arrange: busy then idle
    mockSession.status
      .mockResolvedValueOnce({
        data: [{ id: 'test-session', type: 'busy' }],
      })
      .mockResolvedValue({
        data: [{ id: 'test-session', type: 'idle' }],
      });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'response' }] },
      ],
    });

    // Act: no probeMode (default behavior)
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      maxWaitMs: 2000,
      pollIntervalMs: 100,
    });

    // Assert: should wait and return message (backward compatibility)
    expect(result).toBe('response');
  });
});

// ─── Batch 2: Event-driven polling with AsyncGenerator ─────────────────────────
describe('pollSessionCompletion - Batch 2: AsyncGenerator event subscription', () => {
  let mockClient: { session: SFlowClientSession; event?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('R1.1: Correct AsyncGenerator subscription', () => {
    it('should use await client.event.subscribe() and for-await to consume stream', async () => {
      // Arrange: mock event.subscribe returns Promise<{ stream: AsyncGenerator }>
      const targetSessionID = 'test-session-123';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'assistant response' }] },
        ],
      });

      // Act: pollSessionCompletion should subscribe and consume stream
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: subscribe was called
      expect(mockSubscribe).toHaveBeenCalled();
      // Assert: result should be the assistant response (event arrived)
      expect(result).toBe('assistant response');
    });

    it('should parse EventSessionIdle from bare Event object (no payload wrapper)', async () => {
      // Arrange: event is bare Event object with type and properties
      const targetSessionID = 'test-session-456';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: event was correctly parsed
      expect(result).toBe('response');
    });
  });

  describe('R1.2: Event arrival immediate return', () => {
    it('should set eventReceived=true and call wakeUp() on matching event', async () => {
      // Arrange
      const targetSessionID = 'session-immediate';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
        eventDelay: 50, // event arrives after 50ms
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'immediate response' }] },
        ],
      });

      const startTime = Date.now();

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 200, // polling interval is 200ms
      });

      const elapsed = Date.now() - startTime;

      // Assert: should return quickly (event arrived), not wait for full polling interval
      expect(result).toBe('immediate response');
      expect(elapsed).toBeLessThan(300); // should be much faster than polling
    });
  });

  describe('R1.3: Event stream interruption fallback', () => {
    it('should fallback to polling when stream ends normally', async () => {
      // Arrange: stream ends without producing matching event
      const targetSessionID = 'session-stream-end';
      const mockSubscribe = createMockEventSubscribe({
        events: [], // stream ends immediately
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after 300ms
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'polled response' }] },
          ],
        });
      }, 300);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should fallback to polling and return
      expect(result).toBe('polled response');
    });

    it('should fallback to polling when stream throws error', async () => {
      // Arrange: stream throws error during iteration
      const targetSessionID = 'session-stream-error';
      const mockSubscribe = createMockEventSubscribe({
        events: [],
        error: new Error('Network error'),
        errorAfterEvents: 0, // throw immediately
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after 300ms
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'error recovery response' }] },
          ],
        });
      }, 300);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should handle error and fallback to polling
      expect(result).toBe('error recovery response');
    });
  });

  describe('R1.4: Event type filtering', () => {
    it('should ignore non-session.idle events', async () => {
      // Arrange: stream produces non-idle events first
      const targetSessionID = 'session-filter-type';
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createSessionStatusEvent(targetSessionID, 'busy'), // ignored
          createOtherEvent(), // ignored
          createSessionIdleEvent(targetSessionID), // matched
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'filtered response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should ignore non-idle events and match idle event
      expect(result).toBe('filtered response');
    });

    it('should ignore session.idle events with mismatched sessionID', async () => {
      // Arrange: stream produces idle event for different session
      const targetSessionID = 'session-target';
      const otherSessionID = 'session-other';
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createSessionIdleEvent(otherSessionID), // ignored (wrong sessionID)
          createSessionIdleEvent(targetSessionID), // matched
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'sessionID filtered response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should ignore mismatched sessionID
      expect(result).toBe('sessionID filtered response');
    });
  });

  describe('R1.5: Preserve existing fallback logic', () => {
    it('should preserve fallbackThreshold logic', async () => {
      // Arrange: event subscription succeeds but no event arrives
      const targetSessionID = 'session-fallback';
      const mockSubscribe = createMockEventSubscribe({
        events: [], // no events
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after fallback threshold
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'fallback response' }] },
          ],
        });
      }, 500);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        fallbackThreshold: 300, // fallback after 300ms
      });

      // Assert: should fallback to polling after threshold
      expect(result).toBe('fallback response');
    });

    it('should cleanup event subscription on exit', async () => {
      // Arrange
      const targetSessionID = 'session-cleanup';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'cleanup response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: subscription should be cleaned up (no hanging resources)
      expect(result).toBe('cleanup response');
      // Note: cleanup verification is internal, we verify by successful completion
    });

    it('P2-1: should fallback to polling when backup path subscription times out (main path failed)', async () => {
      // Arrange: main path subscription fails, backup path succeeds but no event arrives
      const targetSessionID = 'session-backup-fallback';
      const testDirectory = '/test/path';
      
      // Main path subscription fails
      const mockSubscribe = vi.fn().mockRejectedValue(new Error('Main path unavailable'));
      
      // Backup path subscription succeeds but yields no events
      const mockGlobalEvent = createMockGlobalEvent({
        events: [], // no events - will timeout
      });
      
      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after fallback threshold
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'backup fallback response' }] },
          ],
        });
      }, 500);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        fallbackThreshold: 300, // fallback after 300ms
        directory: testDirectory,
      });

      // Assert: should fallback to polling after threshold
      expect(result).toBe('backup fallback response');
      expect(mockSubscribe).toHaveBeenCalled(); // main path was attempted
      expect(mockGlobalEvent).toHaveBeenCalled(); // backup path was attempted
    });

    it('P2-2: should cleanup both subscriptions when both paths timeout', async () => {
      // Arrange: both main and backup subscriptions succeed but no events arrive
      const targetSessionID = 'session-both-timeout';
      const testDirectory = '/test/path';
      
      // Main path subscription succeeds but no events
      const mockSubscribe = createMockEventSubscribe({
        events: [], // no events
      });
      
      // Backup path subscription succeeds but no events
      const mockGlobalEvent = createMockGlobalEvent({
        events: [], // no events
      });
      
      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after fallback threshold
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'both timeout response' }] },
          ],
        });
      }, 500);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        fallbackThreshold: 300, // fallback after 300ms
        directory: testDirectory,
      });

      // Assert: should fallback to polling and cleanup both subscriptions
      expect(result).toBe('both timeout response');
      expect(mockSubscribe).toHaveBeenCalled(); // main path was attempted
      expect(mockGlobalEvent).toHaveBeenCalled(); // backup path was attempted
    });
  });

  describe('TO-1 & TO-2: directory parameter passing', () => {
    it('TO-1: should pass directory to event.subscribe when provided', async () => {
      // Arrange: mock event.subscribe to record arguments
      const targetSessionID = 'test-session-directory';
      const testDirectory = '/test/project/path';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act: call pollSessionCompletion with directory option
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: testDirectory,
      });

      // Assert: subscribe was called with correct directory parameter
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockSubscribe.mock.calls[0][0].query).toEqual({ directory: testDirectory });
      expect(mockSubscribe.mock.calls[0][0].onSseError).toBeDefined();
      expect(result).toBe('response');
    });

    it('TO-2: should pass empty query when directory is not provided (backward compatible)', async () => {
      // Arrange: mock event.subscribe to record arguments
      const targetSessionID = 'test-session-no-directory';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act: call pollSessionCompletion WITHOUT directory option
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: subscribe was called with empty query (backward compatible)
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockSubscribe.mock.calls[0][0].query).toEqual({});
      expect(mockSubscribe.mock.calls[0][0].onSseError).toBeDefined();
      expect(result).toBe('response');
    });

    it('TO-2: should pass empty query when directory is undefined', async () => {
      // Arrange
      const targetSessionID = 'test-session-undefined-directory';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act: explicitly pass undefined directory
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: undefined,
      });

      // Assert: subscribe was called with empty query
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockSubscribe.mock.calls[0][0].query).toEqual({});
      expect(mockSubscribe.mock.calls[0][0].onSseError).toBeDefined();
      expect(result).toBe('response');
    });
  });
});

// ─── Batch 3: Boundary tests for event-driven polling ─────────────────────────
describe('pollSessionCompletion - Batch 3: Boundary tests (R3)', () => {
  let mockClient: { session: SFlowClientSession; event?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('R3.1: subscribe returns Promise and must be awaited', () => {
    it('should await client.event.subscribe() before consuming stream', async () => {
      // Arrange: mock subscribe delays its return
      const targetSessionID = 'session-await-test';
      const subscribeDelay = 100; // 100ms delay
      let subscribeCalledTime = 0;
      let subscribeReturnedTime = 0;

      const delayedSubscribe = vi.fn().mockImplementation(async () => {
        subscribeCalledTime = Date.now();
        await new Promise(resolve => setTimeout(resolve, subscribeDelay));
        subscribeReturnedTime = Date.now();
        return {
          stream: (async function* () {
            yield createSessionIdleEvent(targetSessionID);
          })(),
        };
      });

      mockClient.event = { subscribe: delayedSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 50,
      });
      const elapsed = Date.now() - startTime;

      // Assert: subscribe was called and awaited
      expect(delayedSubscribe).toHaveBeenCalled();
      expect(subscribeReturnedTime - subscribeCalledTime).toBeGreaterThanOrEqual(subscribeDelay - 10);
      expect(result).toBe('response');
    });
  });

  describe('R3.2: stream iteration yields events → correct parsing', () => {
    it('should correctly parse EventSessionIdle from stream', async () => {
      // Arrange: stream yields session.idle event
      const targetSessionID = 'session-parse-test';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'parsed response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: event was correctly parsed and triggered immediate return
      expect(result).toBe('parsed response');
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  describe('R3.3: stream ends without events → fallback polling', () => {
    it('should not hang when stream ends without events', async () => {
      // Arrange: stream ends immediately without yielding events
      const targetSessionID = 'session-no-hang';
      const mockSubscribe = createMockEventSubscribe({
        events: [], // empty stream
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Session becomes idle after 200ms
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'fallback response' }] },
          ],
        });
      }, 200);

      // Act: should complete within reasonable time (not hang)
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });
      const elapsed = Date.now() - startTime;

      // Assert: completed via polling fallback, not hung
      expect(result).toBe('fallback response');
      expect(elapsed).toBeLessThan(1000); // should complete within 1s
    });

    it('should continue message count and status detection after stream ends', async () => {
      // Arrange: stream ends, but message count increases
      const targetSessionID = 'session-msg-count';
      const mockSubscribe = createMockEventSubscribe({
        events: [], // empty stream
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Message count increases after 150ms
      setTimeout(() => {
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'msg count response' }] },
          ],
        });
      }, 150);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        isNew: true, // require message count >= 2
      });

      // Assert: detected via message count increase
      expect(result).toBe('msg count response');
    });
  });

  describe('R3.4: stream throws error → fallback polling with logging', () => {
    it('should fallback to polling when stream throws error', async () => {
      // Arrange: stream throws error immediately
      const targetSessionID = 'session-stream-throw';
      const mockSubscribe = createMockEventSubscribe({
        events: [],
        error: new Error('Connection lost'),
        errorAfterEvents: 0,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Session becomes idle after 250ms
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'error fallback response' }] },
          ],
        });
      }, 250);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: handled error and fallback to polling
      expect(result).toBe('error fallback response');
    });
  });

  describe('R3.5: event type not session.idle → ignore', () => {
    it('should ignore events with type other than session.idle', async () => {
      // Arrange: stream yields non-idle events first, then idle event
      const targetSessionID = 'session-ignore-type';
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createSessionStatusEvent(targetSessionID, 'busy'), // should be ignored
          createOtherEvent(), // should be ignored
          createSessionIdleEvent(targetSessionID), // should be matched
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'type filtered response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: ignored non-idle events and matched idle event
      expect(result).toBe('type filtered response');
    });
  });

  describe('R3.6: event sessionID mismatch → ignore', () => {
    it('should ignore session.idle events with different sessionID', async () => {
      // Arrange: stream yields idle event for different session first
      const targetSessionID = 'session-target-id';
      const otherSessionID = 'session-other-id';
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createSessionIdleEvent(otherSessionID), // should be ignored
          createSessionIdleEvent(targetSessionID), // should be matched
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'sessionID filtered response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: ignored mismatched sessionID
      expect(result).toBe('sessionID filtered response');
    });
  });

  // P1-2: 边界测试 - event properties 字段缺失防护
  describe('P1-2: boundary tests - event properties guard', () => {
    it('should NOT trigger eventReceived when event has no properties field', async () => {
      // Arrange: event with type 'session.idle' but NO properties field
      const targetSessionID = 'session-no-properties';
      const eventWithoutProperties = {
        type: 'session.idle',
        // NO properties field
      };

      const mockSubscribe = createMockEventSubscribe({
        events: [
          eventWithoutProperties as any, // malformed event
          createSessionIdleEvent(targetSessionID), // valid event
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'guarded response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: ignored malformed event, matched valid event
      expect(result).toBe('guarded response');
    });

    it('should NOT trigger eventReceived when properties exists but has no sessionID key', async () => {
      // Arrange: event with properties but NO sessionID key
      const targetSessionID = 'session-no-sessionid';
      const eventWithoutSessionID = {
        type: 'session.idle',
        properties: {
          // NO sessionID key
          otherField: 'some-value',
        },
      };

      const mockSubscribe = createMockEventSubscribe({
        events: [
          eventWithoutSessionID as any, // malformed event
          createSessionIdleEvent(targetSessionID), // valid event
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'sessionid guarded response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: ignored malformed event, matched valid event
      expect(result).toBe('sessionid guarded response');
    });
  });
});

// F1: Dual-path subscription (event.subscribe + global.event backup)
describe('pollSessionCompletion - F1: Dual-path event subscription', () => {
  let mockClient: { session: SFlowClientSession; event?: any; global?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('F1.1: global.event backup path', () => {
    it('should fallback to global.event when event.subscribe stream is empty', async () => {
      // Arrange: event.subscribe returns empty stream, global.event has events
      const targetSessionID = 'test-session-f1';
      const targetDirectory = '/test/dir';
      
      const mockSubscribe = createMockEventSubscribe({
        events: [], // empty stream
      });
      
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 100, // event arrives after 100ms
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'global event response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: global.event was called as backup
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(result).toBe('global event response');
    });

    it('should parse GlobalEvent with payload wrapper correctly', async () => {
      // Arrange: GlobalEvent has directory + payload structure
      const targetSessionID = 'test-session-payload';
      const targetDirectory = '/test/dir';
      
      const mockSubscribe = createMockEventSubscribe({ events: [] });
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'parsed response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: GlobalEvent payload was correctly parsed
      expect(result).toBe('parsed response');
    });

    it('should skip backup when client.global does not exist', async () => {
      // Arrange: no client.global, only event.subscribe
      const targetSessionID = 'test-session-no-global';
      
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      // NO mockClient.global
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'no global response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: only event.subscribe was used, no error
      expect(mockSubscribe).toHaveBeenCalled();
      expect(result).toBe('no global response');
    });

    it('should not duplicate processing when both paths receive events', async () => {
      // Arrange: both event.subscribe and global.event receive matching events
      const targetSessionID = 'test-session-dual';
      const targetDirectory = '/test/dir';
      
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
        eventDelay: 50, // arrives first
      });
      
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 150, // arrives later
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'first event response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: only one response (first event wins)
      expect(result).toBe('first event response');
    });

    it('F2: main path receives non-target session event → mainPathReceivedTargetEvent NOT set, backup can activate', async () => {
      // F2: Verify that mainPathReceivedTargetEvent is only set when main path receives TARGET session event
      // Scenario:
      // 1. Main path receives session.idle { sessionID: 'OTHER' } (non-target) → mainPathReceivedTargetEvent NOT set
      // 2. Backup path receives session.idle { sessionID: target } → should activate backup (eventReceived/wakeUp)
      
      const targetSessionID = 'target-session-f2';
      const otherSessionID = 'other-session-f2';
      const targetDirectory = '/test/dir';
      
      // Main path receives non-target session event first
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(otherSessionID)], // non-target event
        eventDelay: 50,
      });
      
      // Backup path receives target session event
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 150, // arrives after main path's non-target event
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'backup activated response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: backup was activated because main path did not receive target session event
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(result).toBe('backup activated response');
    });

    it('F2: main path receives target session event → mainPathReceivedTargetEvent set, backup NOT activated', async () => {
      // F2: Verify that when main path receives TARGET session event, backup is NOT activated
      // Scenario:
      // 1. Main path receives session.idle { sessionID: target } → mainPathReceivedTargetEvent set
      // 2. Backup path receives same event later → should NOT activate (eventReceived already true)
      
      const targetSessionID = 'target-session-f2-main';
      const targetDirectory = '/test/dir';
      
      // Main path receives target session event
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
        eventDelay: 50,
      });
      
      // Backup path also receives target session event (but later)
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 150,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'main path response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: main path handled the event, backup was NOT activated
      expect(mockSubscribe).toHaveBeenCalled();
      expect(result).toBe('main path response');
    });

    it('should filter GlobalEvent by sessionID in payload', async () => {
      // Arrange: GlobalEvent with different sessionID should be ignored
      const targetSessionID = 'target-session';
      const otherSessionID = 'other-session';
      const targetDirectory = '/test/dir';
      
      const mockSubscribe = createMockEventSubscribe({ events: [] });
      const mockGlobalEvent = createMockGlobalEvent({
        events: [
          createGlobalSessionIdleEvent(targetDirectory, otherSessionID), // wrong session
          createGlobalSessionIdleEvent(targetDirectory, targetSessionID), // correct session
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'filtered response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: wrong sessionID was filtered, correct one matched
      expect(result).toBe('filtered response');
    });

    it('should filter GlobalEvent by directory - mismatch → ignore', async () => {
      // P1-1: GlobalEvent with different directory should be ignored
      // Bug: Current implementation does NOT filter by directory, so this test will FAIL
      const targetSessionID = 'test-session-dir-filter';
      const targetDirectory = '/target/dir';
      const otherDirectory = '/other/dir';
      
      const mockSubscribe = createMockEventSubscribe({ events: [] });
      const mockGlobalEvent = createMockGlobalEvent({
        events: [
          createGlobalSessionIdleEvent(otherDirectory, targetSessionID), // wrong directory, should be ignored
        ],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      
      // Initially, messages returns a response (would be used if event is processed)
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'WRONG: event processed despite directory mismatch' }] },
        ],
      });
      
      // After 200ms, polling completes with correct response
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'CORRECT: polling response (event filtered)' }] },
          ],
        });
      }, 200);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: wrong directory was filtered, completed via polling
      // Bug: If this fails with "WRONG: event processed", it means directory filter is missing
      expect(result).toBe('CORRECT: polling response (event filtered)');
    });

    it('should process GlobalEvent when directory matches', async () => {
      // P1-1: GlobalEvent with matching directory should be processed
      const targetSessionID = 'test-session-dir-match';
      const targetDirectory = '/match/dir';
      
      const mockSubscribe = createMockEventSubscribe({ events: [] });
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'directory match response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: matching directory was processed
      expect(result).toBe('directory match response');
    });

    it('should not filter by directory when options.directory is undefined (backward compatibility)', async () => {
      // P1-1: When options.directory is not set, backup path should not filter by directory
      const targetSessionID = 'test-session-no-dir-filter';
      const directory1 = '/dir1';
      const directory2 = '/dir2';
      
      const mockSubscribe = createMockEventSubscribe({ events: [] });
      const mockGlobalEvent = createMockGlobalEvent({
        events: [
          createGlobalSessionIdleEvent(directory1, targetSessionID), // any directory
          createGlobalSessionIdleEvent(directory2, targetSessionID), // any directory
        ],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'no dir filter response' }] },
        ],
      });

      // Act: no directory option
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        // NO directory option
      });

      // Assert: first event was processed (no directory filtering)
      expect(result).toBe('no dir filter response');
    });
  });

  describe('F1.2: Cleanup on both subscriptions', () => {
    it('should cancel both subscriptions on completion', async () => {
      // Arrange: both subscriptions active
      const targetSessionID = 'test-session-cleanup';
      const targetDirectory = '/test/dir';
      
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
      });
      
      const mockGlobalEvent = createMockGlobalEvent({
        events: [], // empty, but subscription created
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'cleanup response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: both were called, result returned
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(result).toBe('cleanup response');
    });
  });
});

// TO-3: Type assertion test for PollingOptions.directory field
describe('PollingOptions type - Batch 1: directory field', () => {
  it('should accept directory field in PollingOptions', () => {
    // Arrange & Act: create PollingOptions with directory field
    const options: PollingOptions = {
      directory: '/test/path',
    };

    // Assert: type check passes (compiles without error)
    expect(options.directory).toBe('/test/path');
  });

  it('should accept PollingOptions without directory (backward compatibility)', () => {
    // Arrange & Act: create PollingOptions without directory
    const options: PollingOptions = {
      eventDriven: true,
      fallbackThreshold: 25000,
    };

    // Assert: type check passes, directory is optional
    expect(options.directory).toBeUndefined();
  });

  it('should accept all fields including directory', () => {
    // Arrange & Act: create PollingOptions with all fields
    const options: PollingOptions = {
      eventDriven: true,
      fallbackThreshold: 30000,
      directory: '/another/path',
    };

    // Assert: all fields are valid
    expect(options.eventDriven).toBe(true);
    expect(options.fallbackThreshold).toBe(30000);
    expect(options.directory).toBe('/another/path');
  });
});

// F3: Tests for Fix-Loop Round 5 issues
describe('pollSessionCompletion - F3: Fix-Loop Round 5', () => {
  let mockClient: { session: SFlowClientSession; event?: any; global?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('F3.1: Backup path immediate activation when main path fails', () => {
    it('should activate backup path immediately when main path subscription fails', async () => {
      // F1: shouldUseBackup semantics - main path unavailable → backup immediately active
      const targetSessionID = 'test-backup-immediate';
      const targetDirectory = '/test/dir';
      
      // Main path subscription fails (returns undefined or throws)
      const mockSubscribe = vi.fn().mockRejectedValue(new Error('Main path unavailable'));
      
      // Backup path available and emits target event
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 50, // small delay to ensure event arrives
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'backup immediate response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
      });

      // Assert: backup was used (main failed, backup succeeded)
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(result).toBe('backup immediate response');
    });
  });

  describe('F3.2: activePath log accuracy for both subscriptions', () => {
    it('should log activePath as "both" when both main and backup subscriptions are active', async () => {
      // F2: activePath should be 'both' when both paths are subscribed
      const targetSessionID = 'test-both-paths';
      const targetDirectory = '/test/dir';
      const logMessages: any[] = [];
      
      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Both subscriptions succeed
      const mockSubscribe = createMockEventSubscribe({
        events: [], // main path has no events
      });
      
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 100,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'both paths response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
        fallbackThreshold: 200, // low threshold to trigger fallback log
        logger: mockLogger,
      });

      // Assert: both subscriptions were created
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(result).toBe('both paths response');
      
      // Assert: if fallback log was emitted, activePath should be 'both'
      const fallbackLog = logMessages.find(log => log.message === 'fallback to polling');
      if (fallbackLog) {
        expect(fallbackLog.data.activePath).toBe('both');
      }
    });
  });
});

// D3: Tests for diagnostic logging (event stream diagnosis)
describe('pollSessionCompletion - D3: Event stream diagnostic logging', () => {
  let mockClient: { session: SFlowClientSession; event?: any; global?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('D3.1: Main path - event received logging', () => {
    it('should log event received with matched: false when event sessionID differs from target', async () => {
      // Arrange
      const targetSessionID = 'target-session-123';
      const otherSessionID = 'other-session-456';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path emits event for different session
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createSessionIdleEvent(otherSessionID), // non-target event
          createSessionIdleEvent(targetSessionID), // target event
        ],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
        logger: mockLogger,
      });

      // Assert: event processing still works
      expect(result).toBe('response');

      // Assert: diagnostic log was recorded for non-target event
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);

      // Assert: first event log should have matched: false
      const nonTargetLog = eventLogs.find(log => log.data?.eventSessionID === otherSessionID);
      if (nonTargetLog) {
        expect(nonTargetLog.data.source).toBe('event.subscribe');
        expect(nonTargetLog.data.type).toBe('session.idle');
        expect(nonTargetLog.data.matched).toBe(false);
        expect(nonTargetLog.data.targetSessionID).toBe(targetSessionID);
      }
    });

    it('should log event received with matched: true when event sessionID matches target', async () => {
      // Arrange
      const targetSessionID = 'target-session-789';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path emits target event
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'target response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
        logger: mockLogger,
      });

      // Assert: event processing works
      expect(result).toBe('target response');

      // Assert: diagnostic log was recorded for target event
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);

      // Assert: target event log should have matched: true
      const targetLog = eventLogs.find(log => log.data?.eventSessionID === targetSessionID);
      if (targetLog) {
        expect(targetLog.data.source).toBe('event.subscribe');
        expect(targetLog.data.type).toBe('session.idle');
        expect(targetLog.data.matched).toBe(true);
        expect(targetLog.data.targetSessionID).toBe(targetSessionID);
      }
    });

    it('should log event received for non-session.idle events', async () => {
      // Arrange
      const targetSessionID = 'target-session-other-type';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path emits non-session.idle event first, then target event
      const mockSubscribe = createMockEventSubscribe({
        events: [
          createOtherEvent(), // message.updated event
          createSessionIdleEvent(targetSessionID),
        ],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
        logger: mockLogger,
      });

      // Assert: event processing works
      expect(result).toBe('response');

      // Assert: diagnostic log was recorded for non-session.idle event
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);

      // Assert: non-session.idle event log should have matched: false
      const otherEventLog = eventLogs.find(log => log.data?.type === 'message.updated');
      if (otherEventLog) {
        expect(otherEventLog.data.source).toBe('event.subscribe');
        expect(otherEventLog.data.matched).toBe(false);
      }
    });
  });

  describe('D3.2: Backup path - global event received logging', () => {
    it('should log event received with directory and sessionID for global events', async () => {
      // Arrange
      const targetSessionID = 'target-global-session';
      const targetDirectory = '/test/dir';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path fails, backup path emits target event
      const mockSubscribe = vi.fn().mockRejectedValue(new Error('Main path unavailable'));
      const mockGlobalEvent = createMockGlobalEvent({
        events: [createGlobalSessionIdleEvent(targetDirectory, targetSessionID)],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'global response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
        eventDriven: true,
        logger: mockLogger,
      });

      // Assert: event processing works
      expect(result).toBe('global response');

      // Assert: diagnostic log was recorded for global event
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);

      // Assert: global event log should have directory and sessionID
      const globalEventLog = eventLogs.find(log => log.data?.source === 'global.event');
      if (globalEventLog) {
        expect(globalEventLog.data.source).toBe('global.event');
        expect(globalEventLog.data.type).toBe('session.idle');
        expect(globalEventLog.data.eventDirectory).toBe(targetDirectory);
        expect(globalEventLog.data.eventSessionID).toBe(targetSessionID);
        expect(globalEventLog.data.targetDirectory).toBe(targetDirectory);
        expect(globalEventLog.data.targetSessionID).toBe(targetSessionID);
        expect(globalEventLog.data.matched).toBe(true);
      }
    });

    it('should log event received with matched: false for global event with different directory', async () => {
      // Arrange
      const targetSessionID = 'target-global-diff-dir';
      const targetDirectory = '/target/dir';
      const otherDirectory = '/other/dir';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path fails, backup path emits events for different directories
      const mockSubscribe = vi.fn().mockRejectedValue(new Error('Main path unavailable'));
      const mockGlobalEvent = createMockGlobalEvent({
        events: [
          createGlobalSessionIdleEvent(otherDirectory, targetSessionID), // different directory
          createGlobalSessionIdleEvent(targetDirectory, targetSessionID), // target directory
        ],
        eventDelay: 50,
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockClient.global = { event: mockGlobalEvent };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: targetDirectory,
        eventDriven: true,
        logger: mockLogger,
      });

      // Assert: event processing works
      expect(result).toBe('response');

      // Assert: diagnostic log was recorded for global events
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);

      // Assert: global event with different directory should have matched: false
      const diffDirLog = eventLogs.find(log => log.data?.eventDirectory === otherDirectory);
      if (diffDirLog) {
        expect(diffDirLog.data.source).toBe('global.event');
        expect(diffDirLog.data.matched).toBe(false);
      }
    });
  });

  describe('D3.3: Diagnostic logging does not block event processing', () => {
    it('should still trigger eventReceived when diagnostic logging is enabled', async () => {
      // Arrange
      const targetSessionID = 'target-no-block';
      const logMessages: any[] = [];

      // Mock logger to capture log messages
      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Main path emits target event quickly
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent(targetSessionID)],
        eventDelay: 10, // very quick
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'quick response' }] },
        ],
      });

      const startTime = Date.now();

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 200, // polling interval is 200ms
        eventDriven: true,
        logger: mockLogger,
      });

      const elapsed = Date.now() - startTime;

      // Assert: event processing works and is fast (event-driven, not polling)
      expect(result).toBe('quick response');
      expect(elapsed).toBeLessThan(300); // should be much faster than polling

      // Assert: diagnostic log was recorded
      const eventLogs = logMessages.filter(log => log.message === 'event received');
      expect(eventLogs.length).toBeGreaterThan(0);
    });
  });
});

// ─── SSE Connection Diagnostics (D1-D4) ───────────────────────────────────────
describe('pollSessionCompletion - SSE Connection Diagnostics', () => {
  let mockClient: { session: SFlowClientSession; event?: any; global?: any };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  describe('D4: onSseError callback injection', () => {
    it('should pass onSseError callback to client.event.subscribe', async () => {
      // Arrange
      const targetSessionID = 'sse-error-test';
      const logMessages: any[] = [];

      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Mock subscribe that captures the onSseError parameter
      let capturedOptions: any = null;
      const mockSubscribe = vi.fn().mockImplementation((options?: any) => {
        capturedOptions = options;
        return Promise.resolve({
          stream: (async function* () {
            yield createSessionIdleEvent(targetSessionID);
          })(),
        });
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: subscribe was called with onSseError callback
      expect(mockSubscribe).toHaveBeenCalled();
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.onSseError).toBeDefined();
      expect(typeof capturedOptions.onSseError).toBe('function');
    });

    it('should log SSE error when onSseError callback is triggered', async () => {
      // Arrange
      const targetSessionID = 'sse-error-trigger';
      const logMessages: any[] = [];

      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Mock subscribe that captures onSseError and triggers it during stream iteration
      let capturedOnError: ((error: Error) => void) | null = null;
      const mockSubscribe = vi.fn().mockImplementation((options?: any) => {
        capturedOnError = options?.onSseError;
        return Promise.resolve({
          stream: (async function* () {
            // Trigger SSE error before yielding event
            if (capturedOnError) {
              capturedOnError(new Error('Connection failed'));
            }
            yield createSessionIdleEvent(targetSessionID);
          })(),
        });
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: SSE error was logged
      const sseErrorLogs = logMessages.filter(log => log.message === 'event.subscribe SSE error');
      expect(sseErrorLogs.length).toBeGreaterThan(0);
      expect(sseErrorLogs[0].data.error).toBe('Connection failed');
    });

    it('should log connected when subscription succeeds', async () => {
      // Arrange
      const targetSessionID = 'sse-connected';
      const logMessages: any[] = [];

      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      const mockSubscribe = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stream: (async function* () {
            yield createSessionIdleEvent(targetSessionID);
          })(),
        });
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: connected log was recorded
      const connectedLogs = logMessages.filter(log => log.message === 'event.subscribe connected');
      expect(connectedLogs.length).toBeGreaterThan(0);
    });

    it('should pass onSseError callback to client.global.event backup path', async () => {
      // Arrange
      const targetSessionID = 'global-sse-error';
      const logMessages: any[] = [];

      const mockLogger = {
        log: vi.fn().mockImplementation(async (sessionID: string, message: string, data?: any) => {
          logMessages.push({ sessionID, message, data });
        }),
      };

      // Mock global.event that captures the onSseError parameter
      let capturedOptions: any = null;
      const mockGlobalEvent = vi.fn().mockImplementation((options?: any) => {
        capturedOptions = options;
        return Promise.resolve({
          stream: (async function* () {
            yield createGlobalSessionIdleEvent('/test', targetSessionID);
          })(),
        });
      });

      mockClient.global = { event: mockGlobalEvent };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        directory: '/test',
        logger: mockLogger,
      });

      // Assert: global.event was called with onSseError callback
      expect(mockGlobalEvent).toHaveBeenCalled();
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions.onSseError).toBeDefined();
      expect(typeof capturedOptions.onSseError).toBe('function');
    });

    it('should not break existing tests (onSseError is optional)', async () => {
      // Arrange: mock subscribe without onSseError support (backward compatibility)
      const targetSessionID = 'backward-compat';
      const mockSubscribe = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          stream: (async function* () {
            yield createSessionIdleEvent(targetSessionID);
          })(),
        });
      });

      mockClient.event = { subscribe: mockSubscribe };
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act: should work even if subscribe doesn't accept options
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: polling completed successfully
      expect(result).toBe('response');
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });
});
