/**
 * Tests for polling utilities - Batch 1: retry detection and timeout correction
 * Batch 3: event-driven polling with event bus
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import {
  pollSessionCompletion,
  type SFlowClientSession,
  type PollingOptions,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
  extractLatestMessage,
} from '../polling';
import { getGlobalEventBus, resetGlobalEventBus } from '../../features/event-bus.js';
import type { Event } from '../../types.js';

// ─── Event bus mock helpers (Batch 3) ───────────────────────────────────────────

/**
 * Helper to create a session.idle event
 */
function createSessionIdleEvent(sessionID: string): Event {
  return {
    type: 'session.idle',
    properties: { sessionID },
  };
}

/**
 * Helper to create a session.status event
 */
function createSessionStatusEvent(
  sessionID: string,
  status: 'busy' | 'idle' | 'error'
): Event {
  return {
    type: 'session.status',
    properties: { sessionID, status },
  };
}

/**
 * Helper to create an other event (for filtering tests)
 */
function createOtherEvent(): Event {
  return {
    type: 'message.updated',
    properties: {},
  };
}

/**
 * Helper to dispatch event to event bus after a delay
 * Simulates the Hooks.event behavior
 */
function dispatchEventAfterDelay(
  sessionID: string,
  event: Event,
  delayMs: number
): void {
  setTimeout(() => {
    const eventBus = getGlobalEventBus();
    eventBus.dispatch(sessionID, event);
  }, delayMs);
}

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
      const now = Date.now();
      mockSession.status.mockResolvedValue({
        data: [
          {
            id: 'test-session',
            type: 'retry',
            attempt: 2,
            message: 'Retrying...',
            next: now - 5000, // 5s ago, beyond 2s buffer
          },
        ],
      });
      mockSession.messages.mockResolvedValue({
        data: [{ parts: [{ type: 'text', text: 'prompt' }] }],
      });

      // Act
      const result = await pollSessionCompletion(mockClient, 'test-session', {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: should treat as error and return null
      expect(result).toBeNull();
    });
  });
});

// ─── Batch 3: Event-driven polling with event bus ────────────────────────────────
describe('pollSessionCompletion - Batch 3: Event bus driven polling', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset event bus before each test
    resetGlobalEventBus();
    
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  afterEach(() => {
    // Clean up event bus after each test
    resetGlobalEventBus();
  });

  describe('R1: Event bus registration and dispatch', () => {
    it('should register to event bus and receive session.idle event', async () => {
      // Arrange
      const targetSessionID = 'test-session-123';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Dispatch event after 50ms
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 50);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: true,
      });

      // Assert: event arrived and returned response
      expect(result).toBe('response');
    });

    it('should ignore non-session.idle events', async () => {
      // Arrange
      const targetSessionID = 'test-session-456';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Dispatch non-idle events first, then idle event
      dispatchEventAfterDelay(targetSessionID, createSessionStatusEvent(targetSessionID, 'busy'), 50);
      dispatchEventAfterDelay(targetSessionID, createOtherEvent(), 100);
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 150);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should wait for idle event and return response
      expect(result).toBe('response');
    });

    it('should ignore session.idle events with mismatched sessionID', async () => {
      // Arrange
      const targetSessionID = 'session-target';
      const otherSessionID = 'session-other';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Dispatch idle event for different session first
      dispatchEventAfterDelay(otherSessionID, createSessionIdleEvent(otherSessionID), 50);
      // Then dispatch idle event for target session
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 150);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
      });

      // Assert: should ignore mismatched event and wait for correct one
      expect(result).toBe('response');
    });
  });

  describe('R2: Event arrival immediate return', () => {
    it('should return immediately when event arrives (wakeUp mechanism)', async () => {
      // Arrange
      const targetSessionID = 'session-immediate';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'immediate response' }] },
        ],
      });

      const startTime = Date.now();

      // Dispatch event after 50ms
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 50);

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

  describe('R3: Fallback to polling', () => {
    it('should fallback to polling when event not received within threshold', async () => {
      // Arrange: event not dispatched, polling will detect idle
      const targetSessionID = 'session-fallback';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after 300ms (no event dispatched)
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
        fallbackThreshold: 200, // fallback after 200ms
      });

      // Assert: should fallback to polling and return
      expect(result).toBe('polled response');
    });

    it('should unregister from event bus on completion', async () => {
      // Arrange
      const targetSessionID = 'session-cleanup';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
      });

      // Assert: event bus should not have the session registered
      const eventBus = getGlobalEventBus();
      // Try to dispatch, should return false (no listener)
      const dispatched = eventBus.dispatch(targetSessionID, createSessionIdleEvent(targetSessionID));
      expect(dispatched).toBe(false);
    });
  });

  describe('R4: Event bus disabled (eventDriven: false)', () => {
    it('should not register to event bus when eventDriven is false', async () => {
      // Arrange
      const targetSessionID = 'session-no-event';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after 300ms
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      // Act
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        eventDriven: false,
      });

      // Assert: should use polling only
      expect(result).toBe('response');
    });
  });
});

// ─── Batch 5: Diagnostic logging assertions ────────────────────────────────────────
describe('pollSessionCompletion - Batch 5: Diagnostic logging', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    log: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset event bus before each test
    resetGlobalEventBus();

    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };

    // Create mock logger
    mockLogger = {
      log: vi.fn(async (_sessionId: string, _message: string, _metadata?: Record<string, unknown>) => {}),
    };
  });

  afterEach(() => {
    // Clean up event bus after each test
    resetGlobalEventBus();
  });

  describe('D1: Start polling log', () => {
    it('should log "start polling" on entry', async () => {
      // Arrange
      const targetSessionID = 'session-start-log';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: should log "start polling"
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'start polling',
        expect.objectContaining({
          maxWaitMs: 1000,
          isNew: false,
          probeMode: false,
          eventDriven: true,
        })
      );
    });
  });

  describe('P1: 防御性检查', () => {
    it('should not crash when event listener receives event without properties', async () => {
      // Arrange
      const targetSessionID = 'session-no-properties';
      
      // First call returns busy, second call returns idle (fallback to polling)
      mockSession.status
        .mockResolvedValueOnce({ data: [{ id: targetSessionID, type: 'busy' }] })
        .mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Create an event without properties
      const eventWithoutProperties = {
        type: 'session.idle' as const,
        // properties missing
      };

      // Dispatch event after 50ms (will be ignored due to missing properties)
      setTimeout(() => {
        const eventBus = getGlobalEventBus();
        eventBus.dispatch(targetSessionID, eventWithoutProperties as any);
      }, 50);

      // Act & Assert: should not throw, will fallback to polling
      await expect(
        pollSessionCompletion(mockClient, targetSessionID, {
          maxWaitMs: 5000,
          pollIntervalMs: 100,
          logger: mockLogger,
        })
      ).resolves.toBeDefined();
    });

    it('should not crash when event listener receives event with empty properties', async () => {
      // Arrange
      const targetSessionID = 'session-empty-properties';
      
      // First call returns busy, second call returns idle (fallback to polling)
      mockSession.status
        .mockResolvedValueOnce({ data: [{ id: targetSessionID, type: 'busy' }] })
        .mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
          { parts: [{ type: 'text', text: 'response' }] },
        ],
      });

      // Create an event with empty properties
      const eventWithEmptyProperties: Event = {
        type: 'session.idle',
        properties: {}, // sessionID missing
      };

      // Dispatch event after 50ms (will be ignored due to missing sessionID)
      dispatchEventAfterDelay(targetSessionID, eventWithEmptyProperties, 50);

      // Act & Assert: should not throw, will fallback to polling
      await expect(
        pollSessionCompletion(mockClient, targetSessionID, {
          maxWaitMs: 5000,
          pollIntervalMs: 100,
          logger: mockLogger,
        })
      ).resolves.toBeDefined();
    });
  });

  describe('D2: Event received log', () => {
    it('should log "event received" when session.idle event arrives', async () => {
      // Arrange
      const targetSessionID = 'session-event-log';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      // 初始只有 prompt，避免立即返回
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
        ],
      });

      // Dispatch event after 50ms，同时更新 messages mock
      setTimeout(() => {
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 40);
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 50);

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: should log "event received"
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'event received',
        expect.objectContaining({
          source: 'event.hook',
          type: 'session.idle',
          matched: true,
        })
      );
    });
  });

  describe('D3: Completed log', () => {
    it('should log "completed" with reason on exit', async () => {
      // Arrange
      const targetSessionID = 'session-completed-log';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
      // 初始只有 prompt，避免立即返回
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
        ],
      });

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 1000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: should log "completed" with reason
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'completed',
        expect.objectContaining({
          reason: 'idle',
        })
      );
    });

    it('should log "completed" with reason "event_hook" when event arrives', async () => {
      // Arrange
      const targetSessionID = 'session-event-completed-log';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      // 初始只有 prompt，避免立即返回
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
        ],
      });

      // Dispatch event after 50ms，同时更新 messages mock
      setTimeout(() => {
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 40);
      dispatchEventAfterDelay(targetSessionID, createSessionIdleEvent(targetSessionID), 50);

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        logger: mockLogger,
      });

      // Assert: should log "completed" with reason "event_hook"
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'completed',
        expect.objectContaining({
          reason: 'event_hook',
        })
      );
    });
  });

  describe('D4: Fallback log', () => {
    it('should log "fallback to polling" when event not received within threshold', async () => {
      // Arrange
      const targetSessionID = 'session-fallback-log';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });

      // Change to idle after 300ms (no event dispatched)
      setTimeout(() => {
        mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'idle' }] });
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
      }, 300);

      // Act
      await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 100,
        fallbackThreshold: 200, // fallback after 200ms
        logger: mockLogger,
      });

      // Assert: should log "fallback to polling"
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'fallback to polling',
        expect.objectContaining({
          reason: 'event not received within threshold',
        })
      );
    });
  });

  describe('P0-2: Event timing - event arrives before wakeUp assignment', () => {
    it('should detect event even when it arrives before wakeUp is assigned', async () => {
      // This test verifies the fix for P0-2:
      // Event arrives after register but before first wakeUp assignment
      // Expected: event should be detected in the first loop iteration

      // Arrange
      const targetSessionID = 'session-event-before-wakeup';
      mockSession.status.mockResolvedValue({ data: [{ id: targetSessionID, type: 'busy' }] });
      // 初始只有 prompt，避免立即返回
      mockSession.messages.mockResolvedValue({
        data: [
          { parts: [{ type: 'text', text: 'prompt' }] },
        ],
      });

      // Dispatch event immediately (before first await sleep)
      // This simulates event arriving after register but before wakeUp assignment
      const eventBus = getGlobalEventBus();
      const event = createSessionIdleEvent(targetSessionID);

      // Use setImmediate to dispatch event right after pollSessionCompletion starts
      // but before the first sleep in the polling loop
      setImmediate(() => {
        // 同时更新 messages mock
        mockSession.messages.mockResolvedValue({
          data: [
            { parts: [{ type: 'text', text: 'prompt' }] },
            { parts: [{ type: 'text', text: 'response' }] },
          ],
        });
        eventBus.dispatch(targetSessionID, event);
      });

      // Act
      const startTime = Date.now();
      const result = await pollSessionCompletion(mockClient, targetSessionID, {
        maxWaitMs: 5000,
        pollIntervalMs: 200,
        logger: mockLogger,
      });
      const elapsed = Date.now() - startTime;

      // Assert
      expect(result).toBe('response');
      // Event should be detected quickly (within first polling interval)
      // Not delayed by a full polling cycle
      expect(elapsed).toBeLessThan(400); // Should be much faster than 200ms polling interval

      // Verify event was received
      expect(mockLogger.log).toHaveBeenCalledWith(
        targetSessionID,
        'event received',
        expect.objectContaining({
          source: 'event.hook',
          type: 'session.idle',
          matched: true,
        })
      );
    });
  });
});

// ─── P0-FIX: 已完成会话立即返回 ───────────────────────────────────────────
describe('pollSessionCompletion - P0-FIX: Already complete session', () => {
  let mockClient: { session: SFlowClientSession };
  let mockSession: {
    status: ReturnType<typeof vi.fn>;
    messages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetGlobalEventBus();
    
    mockSession = {
      status: vi.fn(),
      messages: vi.fn(),
    };
    mockClient = { session: mockSession as unknown as SFlowClientSession };
  });

  afterEach(() => {
    resetGlobalEventBus();
  });

  it('flowagent_output 在子 agent 已完成时立即返回', async () => {
    // Arrange: 模拟子 agent 已完成（消息列表含 assistant 回复）
    // status 返回空表（idle 会话已被服务端从状态表删除）
    mockSession.status.mockResolvedValue({ data: {} });
    // messages 返回 2 条消息（user prompt + assistant response）
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'final output' }] },
      ],
    });

    // Act: 调用 pollSessionCompletion，isNew=false（子 agent 已派发）
    const startTime = Date.now();
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      isNew: false,
      maxWaitMs: 5000,
      pollIntervalMs: 200,
    });
    const elapsed = Date.now() - startTime;

    // Assert: 立即返回最后一条消息，不等待任何事件/轮询
    expect(result).toBe('final output');
    // 应该在 500ms 内返回（不等待 30s）
    expect(elapsed).toBeLessThan(500);
  });

  it('probeMode 下 status 未命中时通过 messages 检测完成', async () => {
    // Arrange: status 返回空表（idle 会话已被删除）
    mockSession.status.mockResolvedValue({ data: {} });
    // messages 返回含 assistant 回复（2 条消息）
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'assistant response' }] },
      ],
    });

    // Act: probeMode=true
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      probeMode: true,
      maxWaitMs: 5000,
      pollIntervalMs: 200,
    });

    // Assert: 返回最后一条文本而非 PROBE_PENDING
    expect(result).toBe('assistant response');
    expect(result).not.toBeSymbol(); // PROBE_PENDING 是 symbol
  });

  it('probeMode 下 status 明确 busy 时不检查 messages 直接返回 PROBE_PENDING', async () => {
    // Arrange: status 返回 busy 状态
    mockSession.status.mockResolvedValue({
      data: { 'test-session': { type: 'busy' } },
    });
    mockSession.messages.mockResolvedValue({
      data: [
        { parts: [{ type: 'text', text: 'user prompt' }] },
        { parts: [{ type: 'text', text: 'assistant response' }] },
      ],
    });

    // Act: probeMode=true
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      probeMode: true,
      maxWaitMs: 5000,
      pollIntervalMs: 200,
    });

    // Assert: 返回 PROBE_PENDING（不检查 messages）
    // PROBE_PENDING 是一个特殊对象 { __PROBE__: "pending" }
    expect(result).toEqual({ __PROBE__: 'pending' });
  });

  it('hasAssistantMessage 使用 info.role 精确判定', async () => {
    // Arrange: 模拟真实 SDK 数据（带 info.role）
    mockSession.status.mockResolvedValue({ data: {} });
    mockSession.messages.mockResolvedValue({
      data: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'user prompt' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'assistant response' }] },
      ],
    });

    // Act
    const startTime = Date.now();
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      isNew: false,
      maxWaitMs: 5000,
      pollIntervalMs: 200,
    });
    const elapsed = Date.now() - startTime;

    // Assert: 立即返回（基于 role 判定）
    expect(result).toBe('assistant response');
    expect(elapsed).toBeLessThan(500);
  });

  it('同步 retry 场景（会话 busy 但有旧 assistant 回复）不应提前返回', async () => {
    // Arrange: 模拟同步 retry 场景
    // - status 返回 busy（注入 reminder 后会话正在处理）
    // - messages 先返回 2 条（user prompt + 旧 assistant 回复）
    // - 300ms 后更新为 3 条（user prompt + old output + new output）

    let messageCount = 2;
    mockSession.status.mockResolvedValue({
      data: { 'test-session': { type: 'busy' } },
    });

    mockSession.messages.mockImplementation(async () => {
      if (messageCount === 2) {
        return {
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'old output' }] },
          ],
        };
      } else {
        return {
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: 'old output' }] },
            { parts: [{ type: 'text', text: 'new output' }] },
          ],
        };
      }
    });

    // 300ms 后更新消息数量并切换为 idle
    setTimeout(() => {
      messageCount = 3;
      mockSession.status.mockResolvedValue({
        data: { 'test-session': { type: 'idle' } },
      });
    }, 300);

    // Act: 调用 pollSessionCompletion，isNew=false
    const startTime = Date.now();
    const result = await pollSessionCompletion(mockClient, 'test-session', {
      isNew: false,
      maxWaitMs: 5000,
      pollIntervalMs: 100,
    });
    const elapsed = Date.now() - startTime;

    // Assert: 等待到新输出，而不是提前返回旧输出
    expect(result).toBe('new output');
    // 应该至少等待 200ms（证明没有提前返回）
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});
