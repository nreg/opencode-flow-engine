/**
 * Type tests for AgentFactory interface
 * Wave 1 - Task 1.1: Extend AgentFactory with optional config parameter
 */
import { describe, it, expect } from 'bun:test';
import type { AgentFactory } from './types.js';
import type { SFlowConfig } from './config-loader.js';
import type { AgentConfig } from '@opencode-ai/sdk';

describe('AgentFactory Type', () => {
  it('should accept config parameter in options', () => {
    // This test verifies that AgentFactory accepts config parameter
    // The type check happens at compile time
    const factory: AgentFactory = (model, options) => {
      return {
        model,
        temperature: options?.temperature,
        // config should be accessible here after type extension
        systemPrompt: options?.config ? `Config version: ${options.config.version}` : undefined,
      } as AgentConfig;
    };

    // Test with config parameter
    const config: SFlowConfig = { version: '1.0.0', mode: 'full' };
    const result = factory('test-model', { temperature: 0.7, config });
    
    expect(result.model).toBe('test-model');
    expect(result.temperature).toBe(0.7);
    expect(result.systemPrompt).toContain('1.0.0');
  });

  it('should work without config parameter (backward compatibility)', () => {
    // This test verifies backward compatibility
    const factory: AgentFactory = (model, options) => {
      return {
        model,
        temperature: options?.temperature,
      } as AgentConfig;
    };

    // Test without config parameter
    const result = factory('test-model', { temperature: 0.5 });
    
    expect(result.model).toBe('test-model');
    expect(result.temperature).toBe(0.5);
  });

  it('should accept all optional parameters', () => {
    const factory: AgentFactory = (model, options) => {
      return {
        model,
        temperature: options?.temperature,
        systemPrompt: options?.skillContent,
      } as AgentConfig;
    };

    // Test with all parameters
    const config: SFlowConfig = { version: '2.0.0' };
    const result = factory('test-model', { 
      temperature: 0.8, 
      skillContent: 'Test skill',
      config
    });
    
    expect(result.model).toBe('test-model');
    expect(result.temperature).toBe(0.8);
    expect(result.systemPrompt).toBe('Test skill');
  });
});
