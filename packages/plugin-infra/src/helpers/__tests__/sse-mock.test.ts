/**
 * Tests for SSE mock helpers
 * 
 * Verifies that mock functions correctly simulate real SDK behavior:
 * - createMockEventStream creates AsyncGenerator
 * - createMockEventSubscribe returns Promise<{ stream: AsyncGenerator }>
 * - Events can be controlled (normal, error, end)
 */
import { describe, it, expect } from 'bun:test';
import {
  createMockEventStream,
  createMockEventSubscribe,
  createSessionIdleEvent,
  createSessionStatusEvent,
  createOtherEvent,
} from './sse-mock';

describe('SSE Mock Helpers', () => {
  describe('createMockEventStream', () => {
    it('should create an AsyncGenerator', () => {
      const stream = createMockEventStream();
      // AsyncGenerator should have next(), return(), throw() methods
      expect(stream.next).toBeTypeOf('function');
      expect(stream.return).toBeTypeOf('function');
      expect(stream.throw).toBeTypeOf('function');
      expect(Symbol.asyncIterator in stream).toBe(true);
    });

    it('should yield events in order', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        createSessionIdleEvent('session-2'),
      ];
      
      const stream = createMockEventStream({ events });
      const results = [];
      
      for await (const event of stream) {
        results.push(event);
      }
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(events[0]);
      expect(results[1]).toEqual(events[1]);
    });

    it('should end immediately if no events provided', async () => {
      const stream = createMockEventStream({ events: [] });
      const results = [];
      
      for await (const event of stream) {
        results.push(event);
      }
      
      expect(results).toHaveLength(0);
    });

    it('should throw error during iteration', async () => {
      const events = [createSessionIdleEvent('session-1')];
      const error = new Error('Network error');
      
      const stream = createMockEventStream({ events, error, errorAfterEvents: 0 });
      
      let errorThrown = false;
      try {
        for await (const _ of stream) {
          // Should throw before yielding anything
        }
      } catch (err) {
        errorThrown = true;
        expect((err as Error).message).toBe('Network error');
      }
      
      expect(errorThrown).toBe(true);
    });

    it('should throw error after specified number of events', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        createSessionIdleEvent('session-2'),
      ];
      const error = new Error('Stream interrupted');
      
      const stream = createMockEventStream({ events, error, errorAfterEvents: 1 });
      const results = [];
      
      let errorThrown = false;
      try {
        for await (const event of stream) {
          results.push(event);
        }
      } catch (err) {
        errorThrown = true;
        expect((err as Error).message).toBe('Stream interrupted');
      }
      
      expect(errorThrown).toBe(true);
      // Should have yielded 1 event before error
      expect(results).toHaveLength(1);
    });

    it('should delay between events if eventDelay is set', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        createSessionIdleEvent('session-2'),
      ];
      
      const startTime = Date.now();
      const stream = createMockEventStream({ events, eventDelay: 50 });
      
      for await (const _ of stream) {
        // Just iterate
      }
      
      const elapsed = Date.now() - startTime;
      // Should have at least 50ms delay between 2 events
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some variance
    });
  });

  describe('createMockEventSubscribe', () => {
    it('should return a mock function', () => {
      const mockSubscribe = createMockEventSubscribe();
      expect(mockSubscribe).toBeTypeOf('function');
      expect('mockImplementation' in mockSubscribe).toBe(true);
    });

    it('should return Promise<{ stream: AsyncGenerator }>', async () => {
      const mockSubscribe = createMockEventSubscribe();
      const result = await mockSubscribe();
      
      expect(result).toHaveProperty('stream');
      expect(result.stream.next).toBeTypeOf('function');
      expect(Symbol.asyncIterator in result.stream).toBe(true);
    });

    it('should yield events when stream is consumed', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        createSessionIdleEvent('session-2'),
      ];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      const results = [];
      for await (const event of stream) {
        results.push(event);
      }
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(events[0]);
      expect(results[1]).toEqual(events[1]);
    });

    it('should throw error when stream encounters error', async () => {
      const events = [createSessionIdleEvent('session-1')];
      const error = new Error('Connection lost');
      
      const mockSubscribe = createMockEventSubscribe({ events, error, errorAfterEvents: 0 });
      const { stream } = await mockSubscribe();
      
      let errorThrown = false;
      try {
        for await (const _ of stream) {
          // Should throw
        }
      } catch (err) {
        errorThrown = true;
        expect((err as Error).message).toBe('Connection lost');
      }
      
      expect(errorThrown).toBe(true);
    });
  });

  describe('Event creation helpers', () => {
    it('should create valid EventSessionIdle event (P0-1: bare object, no payload wrapper)', () => {
      const event = createSessionIdleEvent('test-session');
      
      expect(event).toEqual({
        type: 'session.idle',
        properties: { sessionID: 'test-session' },
      });
    });

    it('should create valid EventSessionStatus event (P0-1: bare object, no payload wrapper)', () => {
      const event = createSessionStatusEvent('test-session', 'busy');
      
      expect(event).toEqual({
        type: 'session.status',
        properties: { sessionID: 'test-session', status: 'busy' },
      });
    });

    it('should create valid other event type (P0-1: bare object, no payload wrapper)', () => {
      const event = createOtherEvent();
      
      expect(event).toEqual({
        type: 'message.updated',
        properties: {},
      });
    });
  });

  describe('Real-world usage scenarios', () => {
    it('should simulate session.idle event arrival (matching sessionID) - P0-1: bare event access', async () => {
      const targetSessionID = 'target-session';
      const events = [createSessionIdleEvent(targetSessionID)];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      let receivedEvent = null;
      for await (const event of stream) {
        // P0-1: Access event.type and event.properties directly (no payload wrapper)
        if (event.type === 'session.idle' && 
            event.properties?.sessionID === targetSessionID) {
          receivedEvent = event;
        }
      }
      
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent?.type).toBe('session.idle');
    });

    it('should simulate session.idle event arrival (non-matching sessionID) - P0-1: bare event access', async () => {
      const targetSessionID = 'target-session';
      const otherSessionID = 'other-session';
      const events = [createSessionIdleEvent(otherSessionID)];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      let receivedEvent = null;
      for await (const event of stream) {
        // P0-1: Access event.type and event.properties directly (no payload wrapper)
        if (event.type === 'session.idle' && 
            event.properties?.sessionID === targetSessionID) {
          receivedEvent = event;
        }
      }
      
      expect(receivedEvent).toBeNull();
    });

    it('should simulate event stream interruption (normal end)', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        // Stream ends after this event
      ];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      const results = [];
      for await (const event of stream) {
        results.push(event);
      }
      
      // Stream should end normally after yielding all events
      expect(results).toHaveLength(1);
    });

    it('should simulate event stream error (network failure)', async () => {
      const events = [
        createSessionIdleEvent('session-1'),
        createSessionIdleEvent('session-2'),
      ];
      const error = new Error('ECONNRESET');
      
      const mockSubscribe = createMockEventSubscribe({ 
        events, 
        error, 
        errorAfterEvents: 1 
      });
      const { stream } = await mockSubscribe();
      
      const results = [];
      let errorThrown = false;
      
      try {
        for await (const event of stream) {
          results.push(event);
        }
      } catch (err) {
        errorThrown = true;
        expect((err as Error).message).toBe('ECONNRESET');
      }
      
      expect(errorThrown).toBe(true);
      expect(results).toHaveLength(1); // Got 1 event before error
    });
  });

  // TO-8: Mock 支持目录断言
  describe('TO-8: Mock call argument recording for directory assertion', () => {
    it('should record query.directory parameter in mock.calls', async () => {
      // Arrange
      const mockSubscribe = createMockEventSubscribe();

      // Act: call subscribe with directory parameter
      await mockSubscribe({ query: { directory: '/test/path' } });

      // Assert: mock.calls should record the argument
      expect(mockSubscribe).toHaveBeenCalled();
      expect(mockSubscribe.mock.calls).toHaveLength(1);
      expect(mockSubscribe.mock.calls[0][0]).toEqual({ query: { directory: '/test/path' } });
    });

    it('should record empty query when directory is not provided', async () => {
      // Arrange
      const mockSubscribe = createMockEventSubscribe();

      // Act: call subscribe without directory
      await mockSubscribe({ query: {} });

      // Assert: mock.calls should record empty query
      expect(mockSubscribe.mock.calls[0][0]).toEqual({ query: {} });
    });

    it('should record multiple calls with different directories', async () => {
      // Arrange
      const mockSubscribe = createMockEventSubscribe();

      // Act: call subscribe multiple times
      await mockSubscribe({ query: { directory: '/path/one' } });
      await mockSubscribe({ query: { directory: '/path/two' } });

      // Assert: both calls should be recorded
      expect(mockSubscribe.mock.calls).toHaveLength(2);
      expect(mockSubscribe.mock.calls[0][0]).toEqual({ query: { directory: '/path/one' } });
      expect(mockSubscribe.mock.calls[1][0]).toEqual({ query: { directory: '/path/two' } });
    });

    it('should support asserting directory in real-world polling scenario', async () => {
      // Arrange: simulate polling.ts calling subscribe with directory
      const targetDirectory = '/project/root';
      const mockSubscribe = createMockEventSubscribe({
        events: [createSessionIdleEvent('test-session')],
      });

      // Act: simulate what polling.ts does
      const query = targetDirectory ? { directory: targetDirectory } : {};
      await mockSubscribe({ query });

      // Assert: can verify directory was passed correctly
      expect(mockSubscribe.mock.calls[0][0].query?.directory).toBe(targetDirectory);
    });
  });
});
