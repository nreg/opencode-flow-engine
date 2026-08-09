/**
 * Mock helpers for SSE event stream testing
 * 
 * Simulates the real SDK behavior:
 * - client.event.subscribe() returns Promise<{ stream: AsyncGenerator }>
 * - stream yields GlobalEvent objects
 * - stream can end normally or throw errors
 */

/**
 * Inlined types from @opencode-ai/sdk for test mock purposes.
 * This avoids module resolution issues in test environment.
 */
export type Event = {
  type: string;
  properties: Record<string, unknown>;
};

export type GlobalEvent = {
  directory: string;
  payload: Event;
};

/**
 * Options for creating a mock event stream
 */
export interface MockEventStreamOptions {
  /** Events to yield (in order). If empty, stream ends immediately. */
  events?: GlobalEvent[];
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
 * @returns AsyncGenerator<GlobalEvent>
 */
export async function* createMockEventStream(
  options: MockEventStreamOptions = {}
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
 * Create a mock event.subscribe function that returns Promise<{ stream: AsyncGenerator }>
 * 
 * This matches the real SDK interface:
 * ```typescript
 * client.event.subscribe(args: { query?: { directory?: string } }): Promise<{ stream: AsyncGenerator<GlobalEvent> }>
 * ```
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
 * Helper to create a GlobalEvent with EventSessionIdle payload
 */
export function createSessionIdleEvent(sessionID: string, directory: string = '/test'): GlobalEvent {
  return {
    directory,
    payload: {
      type: 'session.idle',
      properties: { sessionID },
    } as Event,
  };
}

/**
 * Helper to create a GlobalEvent with EventSessionStatus payload
 */
export function createSessionStatusEvent(
  sessionID: string,
  status: 'busy' | 'idle' | 'error',
  directory: string = '/test'
): GlobalEvent {
  return {
    directory,
    payload: {
      type: 'session.status',
      properties: { sessionID, status },
    } as Event,
  };
}

/**
 * Helper to create a GlobalEvent with a different event type (for filtering tests)
 */
export function createOtherEvent(directory: string = '/test'): GlobalEvent {
  return {
    directory,
    payload: {
      type: 'message.updated',
      properties: {},
    } as Event,
  };
}

// Import vi for mocking from bun:test
import { vi } from 'bun:test';
