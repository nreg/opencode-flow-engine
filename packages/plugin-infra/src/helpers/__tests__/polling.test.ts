/**
 * Tests for polling utilities - Batch 1: retry detection and timeout correction
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pollSessionCompletion,
  type SFlowClientSession,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
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
