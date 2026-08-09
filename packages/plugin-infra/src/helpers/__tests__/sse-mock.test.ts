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
    it('should create valid EventSessionIdle event', () => {
      const event = createSessionIdleEvent('test-session', '/project');
      
      expect(event).toEqual({
        directory: '/project',
        payload: {
          type: 'session.idle',
          properties: { sessionID: 'test-session' },
        },
      });
    });

    it('should create valid EventSessionStatus event', () => {
      const event = createSessionStatusEvent('test-session', 'busy', '/project');
      
      expect(event).toEqual({
        directory: '/project',
        payload: {
          type: 'session.status',
          properties: { sessionID: 'test-session', status: 'busy' },
        },
      });
    });

    it('should create valid other event type', () => {
      const event = createOtherEvent('/project');
      
      expect(event).toEqual({
        directory: '/project',
        payload: {
          type: 'message.updated',
          properties: {},
        },
      });
    });

    it('should use default directory if not specified', () => {
      const event = createSessionIdleEvent('test-session');
      expect(event.directory).toBe('/test');
    });
  });

  describe('Real-world usage scenarios', () => {
    it('should simulate session.idle event arrival (matching sessionID)', async () => {
      const targetSessionID = 'target-session';
      const events = [createSessionIdleEvent(targetSessionID)];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      let receivedEvent = null;
      for await (const event of stream) {
        if (event.payload.type === 'session.idle' && 
            event.payload.properties.sessionID === targetSessionID) {
          receivedEvent = event;
        }
      }
      
      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent?.payload.type).toBe('session.idle');
    });

    it('should simulate session.idle event arrival (non-matching sessionID)', async () => {
      const targetSessionID = 'target-session';
      const otherSessionID = 'other-session';
      const events = [createSessionIdleEvent(otherSessionID)];
      
      const mockSubscribe = createMockEventSubscribe({ events });
      const { stream } = await mockSubscribe();
      
      let receivedEvent = null;
      for await (const event of stream) {
        if (event.payload.type === 'session.idle' && 
            event.payload.properties.sessionID === targetSessionID) {
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
});
