/**
 * Mock helpers for SSE event stream testing
 * 
 * Simulates the real SDK behavior:
 * - client.event.subscribe() returns Promise<{ stream: AsyncGenerator }>
 * - stream yields Event objects (bare objects with type and properties)
 * - stream can end normally or throw errors
 * 
 * P0-1 Fix: Real SDK returns bare Event objects, not GlobalEvent with payload wrapper.
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:3374-3379
 */

/**
 * Inlined types from @opencode-ai/sdk for test mock purposes.
 * This avoids module resolution issues in test environment.
 * 
 * P0-1: Event is a bare object with type and properties fields.
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:602 (union type)
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:413-418 (EventSessionIdle)
 */
export type Event = {
  type: string;
  properties?: Record<string, unknown>;
};

/**
 * GlobalEvent is used by client.global.event(), NOT by client.event.subscribe()
 * Kept for reference but not used in event.subscribe() mocks.
 */
export type GlobalEvent = {
  directory: string;
  payload: Event;
};

/**
 * Options for creating a mock event stream
 */
export interface MockEventStreamOptions {
  /** Events to yield (in order). If empty, stream ends immediately. */
  events?: Event[];
  /** Delay between events in milliseconds (default: 0) */
  eventDelay?: number;
  /** Error to throw during iteration (simulates network error) */
  error?: Error;
  /** After how many events to throw the error (default: throw on first iteration) */
  errorAfterEvents?: number;
}

/**
 * Create a mock AsyncGenerator that yields events
 * 
 * @param options Configuration for the mock stream
 * @returns AsyncGenerator<Event> (bare Event objects, no payload wrapper)
 */
export async function* createMockEventStream(
  options: MockEventStreamOptions = {}
): AsyncGenerator<Event> {
  const { events = [], eventDelay = 0, error, errorAfterEvents = 0 } = options;
  
  let eventCount = 0;
  
  for (const event of events) {
    // Check if we should throw an error
    if (error && eventCount >= errorAfterEvents) {
      throw error;
    }
    
    // Yield the event
    yield event;
    eventCount++;
    
    // Delay before next event (if specified)
    if (eventDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, eventDelay));
    }
  }
  
  // If error is set and we haven't thrown yet, throw after all events
  if (error && eventCount >= errorAfterEvents) {
    throw error;
  }
}

/**
 * Create a mock event.subscribe function that returns Promise<{ stream: AsyncGenerator }>
 * 
 * This matches the real SDK interface:
 * ```typescript
 * client.event.subscribe(args: { query?: { directory?: string } }): Promise<{ stream: AsyncGenerator<Event> }>
 * ```
 * 
 * P0-1: Returns bare Event objects, not GlobalEvent with payload wrapper.
 * 
 * @param options Configuration for the mock stream
 * @returns Mock subscribe function
 */
export function createMockEventSubscribe(options: MockEventStreamOptions = {}) {
  return vi.fn().mockImplementation(() => {
    return Promise.resolve({
      stream: createMockEventStream(options),
    });
  });
}

/**
 * Helper to create a bare EventSessionIdle object
 * 
 * P0-1: Returns bare Event object (no payload wrapper).
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:413-418
 */
export function createSessionIdleEvent(sessionID: string): Event {
  return {
    type: 'session.idle',
    properties: { sessionID },
  };
}

/**
 * Helper to create a bare EventSessionStatus object
 * 
 * P0-1: Returns bare Event object (no payload wrapper).
 */
export function createSessionStatusEvent(
  sessionID: string,
  status: 'busy' | 'idle' | 'error'
): Event {
  return {
    type: 'session.status',
    properties: { sessionID, status },
  };
}

/**
 * Helper to create a bare Event with a different type (for filtering tests)
 * 
 * P0-1: Returns bare Event object (no payload wrapper).
 */
export function createOtherEvent(): Event {
  return {
    type: 'message.updated',
    properties: {},
  };
}

// ─── GlobalEvent mock helpers (F1: dual-path subscription) ───────────────────────

/**
 * Options for creating a mock global event stream
 */
export interface MockGlobalEventStreamOptions {
  /** GlobalEvents to yield (in order). If empty, stream ends immediately. */
  events?: GlobalEvent[];
  /** Delay between events in milliseconds (default: 0) */
  eventDelay?: number;
  /** Error to throw during iteration (simulates network error) */
  error?: Error;
  /** After how many events to throw the error (default: throw on first iteration) */
  errorAfterEvents?: number;
}

/**
 * Create a mock AsyncGenerator that yields GlobalEvent objects
 * 
 * F1: Used by client.global.event() backup subscription path.
 * 
 * @param options Configuration for the mock stream
 * @returns AsyncGenerator<GlobalEvent> (each event has directory + payload wrapper)
 */
export async function* createMockGlobalEventStream(
  options: MockGlobalEventStreamOptions = {}
): AsyncGenerator<GlobalEvent> {
  const { events = [], eventDelay = 0, error, errorAfterEvents = 0 } = options;
  
  let eventCount = 0;
  
  for (const event of events) {
    // Check if we should throw an error
    if (error && eventCount >= errorAfterEvents) {
      throw error;
    }
    
    // Yield the event
    yield event;
    eventCount++;
    
    // Delay before next event (if specified)
    if (eventDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, eventDelay));
    }
  }
  
  // If error is set and we haven't thrown yet, throw after all events
  if (error && eventCount >= errorAfterEvents) {
    throw error;
  }
}

/**
 * Create a mock global.event function that returns Promise<{ stream: AsyncGenerator }>
 * 
 * This matches the real SDK interface:
 * ```typescript
 * client.global.event(): Promise<{ stream: AsyncGenerator<GlobalEvent> }>
 * ```
 * 
 * F1: Returns GlobalEvent objects with directory + payload wrapper.
 * 
 * @param options Configuration for the mock stream
 * @returns Mock global.event function
 */
export function createMockGlobalEvent(options: MockGlobalEventStreamOptions = {}) {
  return vi.fn().mockImplementation(() => {
    return Promise.resolve({
      stream: createMockGlobalEventStream(options),
    });
  });
}

/**
 * Helper to create a GlobalEvent with session.idle payload
 * 
 * F1: Returns GlobalEvent (directory + payload wrapper).
 * 
 * @param directory Target directory
 * @param sessionID Session ID
 * @returns GlobalEvent with session.idle payload
 */
export function createGlobalSessionIdleEvent(directory: string, sessionID: string): GlobalEvent {
  return {
    directory,
    payload: {
      type: 'session.idle',
      properties: { sessionID },
    },
  };
}

/**
 * Helper to create a GlobalEvent with a different payload type (for filtering tests)
 * 
 * F1: Returns GlobalEvent (directory + payload wrapper).
 * 
 * @param directory Target directory
 * @returns GlobalEvent with non-session.idle payload
 */
export function createGlobalOtherEvent(directory: string): GlobalEvent {
  return {
    directory,
    payload: {
      type: 'message.updated',
      properties: {},
    },
  };
}

// Import vi for mocking from bun:test
import { vi } from 'bun:test';
