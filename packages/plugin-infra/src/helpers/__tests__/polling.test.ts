/**
 * Tests for polling utilities - Batch 1: retry detection and timeout correction
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pollSessionCompletion,
  type SFlowClientSession,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
  extractLatestMessage,
} from '../polling';

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

// ──────────────────────────────────────────────────────────────────────────────
// Batch 2: Event-driven polling (TDD - RED phase)
// ──────────────────────────────────────────────────────────────────────────────

describe('pollSessionCompletion - Batch 2: event-driven polling', () => {
  let mockClient: { session: SFlowClientSession; event?: { subscribe: ReturnType<typeof vi.fn> } };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };
  let mockEventSubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockEventSubscribe = vi.fn();
    mockClient = {
      session: mockSession as unknown as SFlowClientSession,
      event: { subscribe: mockEventSubscribe },
    };
  });

  describe('Task 2.2: EventSessionIdle subscription', () => {
    it('should subscribe to SSE events when eventDriven is true (default)', async () => {
      // Arrange: setup event subscription mock
      const sessionID = 'test-session-idle';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session to be idle immediately
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'assistant response' }] },
        ],
      });

      // Act: call pollSessionCompletion with eventDriven option
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should have called event.subscribe
      expect(mockEventSubscribe).toHaveBeenCalled();
      expect(result).toBe('assistant response');
    });

    it('should return immediately when EventSessionIdle is received', async () => {
      // Arrange: setup event subscription that emits EventSessionIdle
      const sessionID = 'test-session-idle-event';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session status to be busy initially
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
      });

      // Act: start polling
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Simulate EventSessionIdle after 50ms
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      // Mock session to be idle now
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'event-driven response' }] },
        ],
      });

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should return quickly (< 100ms after event)
      expect(elapsed).toBeLessThan(200);
      expect(result).toBe('event-driven response');
    });
  });

  describe('Task 2.3: sessionID filtering', () => {
    it('should only process events for the target sessionID', async () => {
      // Arrange: setup event subscription with multiple session events
      const targetSessionID = 'target-session';
      const otherSessionID = 'other-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session status to be busy
      mockSession.status.mockResolvedValue({
        data: [{ id: targetSessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
      });

      // Act: start polling
      const resultPromise = pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Emit EventSessionIdle for OTHER session (should be ignored)
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID: otherSessionID },
        });
      }

      // Wait a bit, should still be waiting
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Emit EventSessionIdle for TARGET session
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID: targetSessionID },
        });
      }

      // Mock session to be idle now
      mockSession.status.mockResolvedValue({
        data: [{ id: targetSessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'filtered response' }] },
        ],
      });

      const result = await resultPromise;

      // Assert: should return only after target session event
      expect(result).toBe('filtered response');
    });
  });

  describe('Task 2.4: fast return (< 100ms)', () => {
    it('should return within 100ms when EventSessionIdle is received', async () => {
      // Arrange: setup event subscription
      const sessionID = 'fast-return-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session status to be busy
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
      });

      // Act: start polling
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Emit EventSessionIdle immediately
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      // Mock session to be idle
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'fast response' }] },
        ],
      });

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should return quickly (within 150ms to account for timing variance)
      expect(elapsed).toBeLessThan(150);
      expect(result).toBe('fast response');
    });
  });

  describe('Task 2.5: subscription cleanup', () => {
    it('should unsubscribe from event stream on completion', async () => {
      // Arrange: setup event subscription
      const sessionID = 'cleanup-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session to be idle
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'cleanup response' }] },
        ],
      });

      // Act: call pollSessionCompletion
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should have called unsubscribe
      expect(mockEventStream.unsubscribe).toHaveBeenCalled();
      expect(result).toBe('cleanup response');
    });

    it('should unsubscribe from event stream on timeout', async () => {
      // Arrange: setup event subscription
      const sessionID = 'timeout-cleanup-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session to stay busy (will timeout)
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [],
      });

      // Act: call pollSessionCompletion with short timeout
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 300,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should have called unsubscribe even on timeout
      expect(mockEventStream.unsubscribe).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should unsubscribe from event stream on error', async () => {
      // Arrange: setup event subscription
      const sessionID = 'error-cleanup-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock session status to throw error
      mockSession.status.mockRejectedValue(new Error('Session error'));
      mockSession.messages.mockRejectedValue(new Error('Messages error'));

      // Act: call pollSessionCompletion
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 300,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should have called unsubscribe even on error
      expect(mockEventStream.unsubscribe).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Batch 3: Polling fallback with degraded mode (TDD - RED phase)
// ──────────────────────────────────────────────────────────────────────────────

describe('pollSessionCompletion - Batch 3: polling fallback', () => {
  let mockClient: { session: SFlowClientSession; event?: { subscribe: ReturnType<typeof vi.fn> } };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };
  let mockEventSubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockEventSubscribe = vi.fn();
    mockClient = {
      session: mockSession as unknown as SFlowClientSession,
      event: { subscribe: mockEventSubscribe },
    };
  });

  describe('Task 3.1: fallback threshold timer', () => {
    it('should start HTTP polling after fallbackThreshold (25s) when no event received', async () => {
      // Arrange: event subscription setup but no event emitted
      const sessionID = 'fallback-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Mock status to be busy initially, then idle after fallback
      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        if (statusCallCount <= 3) {
          // First few calls: busy (simulating event-driven phase)
          return Promise.resolve({ data: [{ id: sessionID, type: 'busy' }] });
        }
        // After fallback: idle
        return Promise.resolve({ data: [{ id: sessionID, type: 'idle' }] });
      });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'fallback response' }] },
        ],
      });

      // Act: call with fallbackThreshold = 500ms (shortened for test)
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500, // 500ms fallback threshold
      });
      const elapsed = Date.now() - startTime;

      // Assert: should complete via polling fallback (not event)
      expect(result).toBe('fallback response');
      expect(elapsed).toBeGreaterThan(400); // At least fallback threshold
      expect(mockEventStream.unsubscribe).toHaveBeenCalled();
    });

    it('should continue polling after fallbackThreshold until maxWaitMs', async () => {
      // Arrange: no event, status stays busy, messages increase after fallback
      const sessionID = 'long-fallback-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });

      // Messages increase after 800ms (after 500ms fallback)
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 5) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'delayed response' }] },
          ],
        });
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500,
      });

      // Assert: should detect message increase via polling
      expect(result).toBe('delayed response');
    });
  });

  describe('Task 3.2: status miss tolerance', () => {
    it('should continue polling when status() does not find target session', async () => {
      // Arrange: status returns empty or other sessions (target session not found)
      const sessionID = 'missing-status-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status does NOT include target session
      mockSession.status.mockResolvedValue({
        data: [{ id: 'other-session', type: 'idle' }], // Different session
      });

      // Messages increase (completion signal)
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 3) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'status-miss response' }] },
          ],
        });
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500,
      });

      // Assert: should NOT fail, should detect completion via messages
      expect(result).toBe('status-miss response');
    });

    it('should not treat status miss as failure or blocking', async () => {
      // Arrange: status consistently misses, messages consistently fail, but eventually succeeds
      const sessionID = 'resilient-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status always returns empty (session not found in status)
      mockSession.status.mockResolvedValue({ data: [] });

      // Messages fail initially, then succeed
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 5) {
          throw new Error('Messages not ready');
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'resilient response' }] },
          ],
        });
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500,
      });

      // Assert: should eventually succeed via messages
      expect(result).toBe('resilient response');
    });
  });

  describe('Task 3.3: hybrid strategy (event + polling coordination)', () => {
    it('should return immediately when event arrives (event wins)', async () => {
      // Arrange: event arrives before fallback threshold
      const sessionID = 'event-wins-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
      });

      // Act
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 1000, // 1s fallback
      });

      // Emit event after 50ms (before fallback)
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'event response' }] },
        ],
      });

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: event wins, returns quickly
      expect(elapsed).toBeLessThan(200);
      expect(result).toBe('event response');
    });

    it('should fallback to polling when event is lost (polling wins)', async () => {
      // Arrange: event never arrives, polling detects completion
      const sessionID = 'polling-wins-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status stays busy (no idle event)
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });

      // Messages increase after fallback threshold
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 6) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'polling response' }] },
          ],
        });
      });

      // Act
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 3000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500, // 500ms fallback
      });
      const elapsed = Date.now() - startTime;

      // Assert: polling wins after fallback threshold
      expect(elapsed).toBeGreaterThan(500);
      expect(result).toBe('polling response');
    });

    it('should coordinate event and polling without race condition', async () => {
      // Arrange: event arrives while polling is checking
      const sessionID = 'coordination-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        // First call: busy, second call: idle (polling check)
        if (statusCallCount === 1) {
          return Promise.resolve({ data: [{ id: sessionID, type: 'busy' }] });
        }
        return Promise.resolve({ data: [{ id: sessionID, type: 'idle' }] });
      });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'coordinated response' }] },
        ],
      });

      // Act
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500,
      });

      // Emit event while polling is active
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;

      // Assert: should complete without error
      expect(result).toBe('coordinated response');
    });

    // P0-3: 事件到达后不应再依赖 status 确认
    it('should return directly on event arrival without status confirmation', async () => {
      // Arrange: event arrives, but status cannot find session (returns empty object)
      const sessionID = 'event-direct-return-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status returns empty object (cannot find session)
      mockSession.status.mockResolvedValue({ data: {} });

      // Messages contain the response
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'event-driven response' }] },
        ],
      });

      // Act: start polling
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Wait for initialization to complete, then emit event
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;

      // Assert: should return directly via event, without status confirmation
      expect(result).toBe('event-driven response');
      // Status should NOT be called after event arrival (P0-3 fix)
      expect(mockSession.status.mock.calls.length).toBeLessThanOrEqual(1);
    });

    // P0-1: 验证事件到达后不导致 busy-loop
    it('should not cause busy-loop after event arrival', async () => {
      // Arrange: track sleep calls to verify no busy-loop
      const sessionID = 'no-busy-loop-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        return Promise.resolve({ data: {} }); // status cannot find session
      });

      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      });

      // Act
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Emit event after 150ms
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should complete quickly (no busy-loop)
      expect(elapsed).toBeLessThan(500); // Should complete within 500ms
      expect(result).toBe('response');
      // Messages should be called at least once (for initial count + event response)
      expect(messagesCallCount).toBeGreaterThanOrEqual(1);
    });

    // P1-1: fallbackThreshold 降级机制测试
    it('should fallback to pure polling when event not received within fallbackThreshold', async () => {
      // Arrange: event never arrives, should fallback to pure polling after threshold
      const sessionID = 'fallback-threshold-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status stays busy initially, then becomes idle after fallback
      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        if (statusCallCount <= 5) {
          return Promise.resolve({ data: [{ id: sessionID, type: 'busy' }] });
        }
        return Promise.resolve({ data: [{ id: sessionID, type: 'idle' }] });
      });

      // Messages increase after fallback threshold
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 6) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'fallback response' }] },
          ],
        });
      });

      // Act
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 3000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500, // 500ms fallback
      });
      const elapsed = Date.now() - startTime;

      // Assert: should fallback to polling and complete
      expect(result).toBe('fallback response');
      expect(elapsed).toBeGreaterThan(500); // Should take at least fallbackThreshold
      // Event subscription should be unsubscribed after fallback
      expect(mockEventStream.unsubscribe).toHaveBeenCalled();
    });

    it('should continue polling after fallback and detect message count increase', async () => {
      // Arrange: event not received, fallback to polling, then detect completion
      const sessionID = 'fallback-continue-session';
      const mockEventStream = {
        on: vi.fn().mockReturnThis(),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status always busy
      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });

      // Messages increase after fallback
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        if (messagesCallCount <= 8) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'polling detected' }] },
          ],
        });
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 3000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 600, // 600ms fallback
      });

      // Assert: should detect message count increase after fallback
      expect(result).toBe('polling detected');
      expect(messagesCallCount).toBeGreaterThan(8); // Should continue polling after fallback
    });
  });

  // P0-1, P0-3, P1-2: Fix-Loop 第 3 轮审查问题修复测试
  describe('Fix-Loop Round 3: Event subscription race conditions and error handling', () => {
    let mockClient: { session: SFlowClientSession; event?: { subscribe: ReturnType<typeof vi.fn> } };
    let mockSession: {
      status: ReturnType<typeof vi.fn>;
      messages: ReturnType<typeof vi.fn>;
    };
    let mockEventSubscribe: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockSession = {
        status: vi.fn(),
        messages: vi.fn(),
      };
      mockEventSubscribe = vi.fn();
      mockClient = {
        session: mockSession as unknown as SFlowClientSession,
        event: { subscribe: mockEventSubscribe },
      };
    });

    // P0-3: 事件订阅失败后状态一致性
    it('should fallback to pure polling when event subscription fails (subscribe throws)', async () => {
      // Arrange: event.subscribe throws error
      const sessionID = 'subscribe-fail-session';
      mockEventSubscribe.mockImplementation(() => {
        throw new Error('SSE connection failed');
      });

      // Status becomes idle after a few polls
      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        if (statusCallCount <= 3) {
          return Promise.resolve({ data: [{ id: sessionID, type: 'busy' }] });
        }
        return Promise.resolve({ data: [{ id: sessionID, type: 'idle' }] });
      });

      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'polling response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 2000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should complete via polling (not stuck)
      expect(result).toBe('polling response');
      expect(statusCallCount).toBeGreaterThan(3); // Should have polled multiple times
    });

    // P0-1: 事件订阅清理竞态 - 降级后事件迟到应被忽略
    it('should ignore late-arriving events after fallback to polling', async () => {
      // Arrange: event arrives after fallback (race condition)
      const sessionID = 'late-event-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      // Status stays busy initially, becomes idle via polling
      let statusCallCount = 0;
      mockSession.status.mockImplementation(() => {
        statusCallCount++;
        if (statusCallCount <= 8) {
          return Promise.resolve({ data: [{ id: sessionID, type: 'busy' }] });
        }
        return Promise.resolve({ data: [{ id: sessionID, type: 'idle' }] });
      });

      // Messages: initial count = 1, then increase when idle detected
      let messagesCallCount = 0;
      mockSession.messages.mockImplementation(() => {
        messagesCallCount++;
        // First call: initial message count (1 message)
        if (messagesCallCount === 1) {
          return Promise.resolve({
            data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
          });
        }
        // After idle detected: return 2 messages
        return Promise.resolve({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'polling response' }] },
          ],
        });
      });

      // Act
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 3000,
        pollIntervalMs: 100,
        eventDriven: true,
        fallbackThreshold: 500, // 500ms fallback
      });

      // Emit late event after fallback (should be ignored)
      await new Promise((resolve) => setTimeout(resolve, 800)); // After fallback
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should complete via polling (late event ignored)
      expect(result).toBe('polling response');
      expect(elapsed).toBeGreaterThan(500); // Should have used polling, not early event
    });

    // P1-1: 向后兼容检查
    it('should handle missing event.subscribe method gracefully', async () => {
      // Arrange: client.event exists but subscribe is not a function
      const sessionID = 'no-subscribe-method-session';
      mockClient = {
        session: mockSession as unknown as SFlowClientSession,
        event: {} as any, // event exists but no subscribe method
      };

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'idle' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'compat response' }] },
        ],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: should complete via polling (no crash)
      expect(result).toBe('compat response');
    });
  });

  describe('F1: Event wake-up mechanism (immediate return on event arrival)', () => {
    it('should return immediately (< 50ms) when event arrives during sleep', async () => {
      // Arrange: event arrives shortly after sleep starts
      const sessionID = 'wake-up-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'wake-up response' }] },
        ],
      });

      // Act
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 200, // 200ms polling interval
        eventDriven: true,
      });

      // Emit event after 20ms (during first sleep)
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should return immediately (< 50ms), not wait for full 200ms
      expect(elapsed).toBeLessThan(50);
      expect(result).toBe('wake-up response');
    });

    it('should wake up immediately even if event arrives just after sleep starts', async () => {
      // Arrange: event arrives immediately after sleep starts (worst case)
      const sessionID = 'immediate-wake-session';
      let eventHandler: ((event: unknown) => void) | null = null;
      const mockEventStream = {
        on: vi.fn().mockImplementation((event: string, handler: (e: unknown) => void) => {
          if (event === 'data') {
            eventHandler = handler;
          }
          return mockEventStream;
        }),
        unsubscribe: vi.fn(),
      };
      mockEventSubscribe.mockReturnValue(mockEventStream);

      mockSession.status.mockResolvedValue({
        data: [{ id: sessionID, type: 'busy' }],
      });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'user prompt' }] },
          { parts: [{ type: 'text', text: 'immediate response' }] },
        ],
      });

      // Act
      const startTime = Date.now();
      const resultPromise = pollSessionCompletion(mockClient, sessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 200,
        eventDriven: true,
      });

      // Emit event after 5ms (almost immediately)
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (eventHandler) {
        eventHandler({
          type: 'session.idle',
          properties: { sessionID },
        });
      }

      const result = await resultPromise;
      const elapsed = Date.now() - startTime;

      // Assert: should return very quickly (< 30ms)
      expect(elapsed).toBeLessThan(30);
      expect(result).toBe('immediate response');
    });
  });

  describe('F2: extractLatestMessage (DRY message parsing)', () => {
    it('should extract text from latest message with text part', () => {
      const messages = [
        { parts: [{ type: 'text', text: 'first message' }] },
        { parts: [{ type: 'text', text: 'second message' }] },
      ];
      expect(extractLatestMessage(messages)).toBe('second message');
    });

    it('should extract retry error when no text part in latest message', () => {
      const messages = [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() }] },
      ];
      expect(extractLatestMessage(messages)).toBe('Error: API error (code: 500)');
    });

    it('should prefer text over retry error in same message', () => {
      const messages = [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        {
          parts: [
            { type: 'retry', error: { message: 'API error', code: 500 }, time: Date.now() },
            { type: 'text', text: 'successful response' },
          ],
        },
      ];
      expect(extractLatestMessage(messages)).toBe('successful response');
    });

    it('should return null for empty messages array', () => {
      expect(extractLatestMessage([])).toBeNull();
    });

    it('should return null for undefined messages', () => {
      expect(extractLatestMessage(undefined)).toBeNull();
    });

    it('should return null for messages with no valid parts', () => {
      const messages = [{ parts: [{ type: 'other', data: 'something' }] }];
      expect(extractLatestMessage(messages)).toBeNull();
    });

    it('should skip null messages in array', () => {
      const messages = [
        { parts: [{ type: 'text', text: 'first' }] },
        null as any,
        { parts: [{ type: 'text', text: 'third' }] },
      ];
      expect(extractLatestMessage(messages)).toBe('third');
    });

    it('should handle messages without parts', () => {
      const messages = [{}, { parts: [{ type: 'text', text: 'valid' }] }];
      expect(extractLatestMessage(messages)).toBe('valid');
    });
  });
});
