/**
 * Tests for OutputExtractor — P2: Output Schema Structuring
 *
 * Covers:
 * - extractJsonBlock: code fence extraction
 * - extractJsonBlock: bare JSON object extraction
 * - extractJsonBlock: fallback (no JSON found)
 * - extractJsonBlock: JSON parse failure fallback
 * - getSchemaHint: build-executor / verifier / unconfigured type
 * - AGENT_OUTPUT_SCHEMAS: configuration structure validation
 */
import { describe, it, expect } from 'bun:test';
import {
  extractJsonBlock,
  getSchemaHint,
  AGENT_OUTPUT_SCHEMAS,
} from '../output-extractor.js';

// ─── extractJsonBlock ──────────────────────────────────────────────────────

describe('extractJsonBlock', () => {
  // ─── Code fence extraction ───────────────────────────────────────────

  describe('code fence extraction', () => {
    it('should extract JSON from ```json ... ``` code fence', () => {
      const output = '任务完成\n```json\n{"files_changed": ["a.ts"], "tests_passed": true, "blockers": []}\n```';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.files_changed).toEqual(['a.ts']);
      expect(result!.tests_passed).toBe(true);
      expect(result!.blockers).toEqual([]);
    });

    it('should extract JSON from code fence with extra whitespace', () => {
      const output = 'Some text\n```json  \n  {"key": "value"}  \n```\nMore text';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.key).toBe('value');
    });

    it('should extract nested JSON from code fence', () => {
      const output = '```json\n{"outer": {"inner": 42}}\n```';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect((result!.outer as Record<string, unknown>).inner).toBe(42);
    });

    it('should prefer code fence over bare JSON', () => {
      const output = '{"bare": true}\n```json\n{"fenced": true}\n```';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.fenced).toBe(true);
      expect(result!.bare).toBeUndefined();
    });
  });

  // ─── Bare JSON object extraction ─────────────────────────────────────

  describe('bare JSON object extraction', () => {
    it('should extract bare JSON object from text', () => {
      const output = '结果如下：\n{"files_changed": ["a.ts"], "tests_passed": true, "blockers": []}';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.files_changed).toEqual(['a.ts']);
      expect(result!.tests_passed).toBe(true);
    });

    it('should extract JSON object with surrounding text', () => {
      const output = 'Here is the result: {"score": 85, "warnings": []} end of output';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.score).toBe(85);
    });

    it('should extract JSON spanning multiple lines', () => {
      const output = 'Output:\n{\n  "key1": "value1",\n  "key2": 42\n}\nDone';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.key1).toBe('value1');
      expect(result!.key2).toBe(42);
    });
  });

  // ─── Fallback: no JSON found ─────────────────────────────────────────

  describe('fallback: no JSON found', () => {
    it('should return null for plain text without JSON', () => {
      const output = '任务完成，所有文件已修改';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = extractJsonBlock('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      const result = extractJsonBlock('   \n  \t  ');
      expect(result).toBeNull();
    });

    it('should return null when text has braces but not valid JSON object', () => {
      const output = 'Some text with { and } but not JSON';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });
  });

  // ─── Fallback: JSON parse failure ────────────────────────────────────

  describe('fallback: JSON parse failure', () => {
    it('should return null for invalid JSON in code fence', () => {
      const output = '```json\n{invalid json}\n```';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for truncated JSON in code fence', () => {
      const output = '```json\n{"key": "value"\n```';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for JSON array (not object) in code fence', () => {
      const output = '```json\n[1, 2, 3]\n```';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for bare JSON array', () => {
      const output = 'Result: [1, 2, 3]';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for JSON null in code fence', () => {
      const output = '```json\nnull\n```';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });

    it('should return null for JSON primitive in code fence', () => {
      const output = '```json\n"hello"\n```';
      const result = extractJsonBlock(output);
      expect(result).toBeNull();
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle null input', () => {
      const result = extractJsonBlock(null as unknown as string);
      expect(result).toBeNull();
    });

    it('should handle undefined input', () => {
      const result = extractJsonBlock(undefined as unknown as string);
      expect(result).toBeNull();
    });

    it('should handle multiple code fences (use first valid)', () => {
      const output = '```json\n{"first": true}\n```\nSome text\n```json\n{"second": true}\n```';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.first).toBe(true);
    });

    it('should fall through to bare JSON if code fence has invalid JSON', () => {
      const output = '```json\n{invalid}\n```\n{"valid": true}';
      const result = extractJsonBlock(output);
      expect(result).not.toBeNull();
      expect(result!.valid).toBe(true);
    });
  });
});

// ─── getSchemaHint ─────────────────────────────────────────────────────────

describe('getSchemaHint', () => {
  it('should return schema hint for build-executor', () => {
    const hint = getSchemaHint('build-executor');
    expect(hint).not.toBeNull();
    expect(hint).toContain('files_changed');
    expect(hint).toContain('tests_passed');
    expect(hint).toContain('blockers');
  });

  it('should return schema hint for verifier', () => {
    const hint = getSchemaHint('verifier');
    expect(hint).not.toBeNull();
    expect(hint).toContain('blockers');
    expect(hint).toContain('warnings');
    expect(hint).toContain('score');
  });

  it('should return null for unconfigured agent type', () => {
    const hint = getSchemaHint('spec-writer');
    expect(hint).toBeNull();
  });

  it('should return null for unknown agent type', () => {
    const hint = getSchemaHint('nonexistent-agent');
    expect(hint).toBeNull();
  });
});

// ─── AGENT_OUTPUT_SCHEMAS ──────────────────────────────────────────────────

describe('AGENT_OUTPUT_SCHEMAS', () => {
  it('should have build-executor configuration', () => {
    expect(AGENT_OUTPUT_SCHEMAS['build-executor']).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['build-executor'].hint).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['build-executor'].schema).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['build-executor'].schema.files_changed).toEqual([]);
    expect(AGENT_OUTPUT_SCHEMAS['build-executor'].schema.tests_passed).toBe(false);
    expect(AGENT_OUTPUT_SCHEMAS['build-executor'].schema.blockers).toEqual([]);
  });

  it('should have verifier configuration', () => {
    expect(AGENT_OUTPUT_SCHEMAS['verifier']).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['verifier'].hint).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['verifier'].schema).toBeDefined();
    expect(AGENT_OUTPUT_SCHEMAS['verifier'].schema.blockers).toEqual([]);
    expect(AGENT_OUTPUT_SCHEMAS['verifier'].schema.warnings).toEqual([]);
    expect(AGENT_OUTPUT_SCHEMAS['verifier'].schema.score).toBe(0);
  });

  it('should have hint containing json code fence format', () => {
    const buildHint = AGENT_OUTPUT_SCHEMAS['build-executor'].hint;
    expect(buildHint).toContain('```json');
    expect(buildHint).toContain('```');

    const verifierHint = AGENT_OUTPUT_SCHEMAS['verifier'].hint;
    expect(verifierHint).toContain('```json');
    expect(verifierHint).toContain('```');
  });
});
