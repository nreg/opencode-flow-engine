/**
 * Unit tests for tokenizer
 * Ported from spec-superflow
 */

import { describe, it, expect } from 'bun:test';
import { tokenize, detectLanguage } from './tokenizer.js';

describe('tokenize', () => {
  describe('English', () => {
    it('should tokenize English text', () => {
      const tokens = tokenize('User authentication login system', 'en');
      expect(tokens.size).toBeGreaterThan(0);
      expect(tokens.has('authentic')).toBe(true); // "authentication" stems to "authentic"
      expect(tokens.has('login')).toBe(true);
    });

    it('should remove stop words', () => {
      const tokens = tokenize('The user is logged in to the system', 'en');
      expect(tokens.has('the')).toBe(false);
      expect(tokens.has('is')).toBe(false);
      expect(tokens.has('user')).toBe(true);
    });

    it('should apply stemming', () => {
      const tokens1 = tokenize('limiting', 'en');
      const tokens2 = tokenize('limiter', 'en');
      const tokens3 = tokenize('limit', 'en');
      // All should stem to the same root
      expect(tokens1.has('limit')).toBe(true);
      expect(tokens2.has('limit')).toBe(true);
      expect(tokens3.has('limit')).toBe(true);
    });

    it('should filter short tokens', () => {
      const tokens = tokenize('a b c do', 'en');
      // Tokens less than 3 chars should be filtered
      for (const token of tokens) {
        expect(token.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('Chinese', () => {
    it('should tokenize Chinese text with sliding window', () => {
      const tokens = tokenize('用户认证登录系统', 'zh');
      expect(tokens.size).toBeGreaterThan(0);
    });

    it('should produce bigrams and trigrams', () => {
      const tokens = tokenize('用户认证系统', 'zh');
      // Should contain sliding window tokens
      expect(tokens.has('用户认证')).toBe(true);
      expect(tokens.has('认证系统')).toBe(true);
    });

    it('should remove Chinese stop words', () => {
      const tokens = tokenize('的用户的登录', 'zh');
      expect(tokens.has('的')).toBe(false);
    });
  });

  describe('Auto-detection', () => {
    it('should auto-detect English', () => {
      const tokens = tokenize('User authentication system');
      expect(tokens.size).toBeGreaterThan(0);
    });

    it('should auto-detect Chinese', () => {
      const tokens = tokenize('用户认证系统');
      expect(tokens.size).toBeGreaterThan(0);
    });

    it('should handle mixed content', () => {
      const tokens = tokenize('用户使用JWT认证');
      expect(tokens.size).toBeGreaterThan(0);
    });
  });
});

describe('detectLanguage', () => {
  it('should detect English', () => {
    expect(detectLanguage('This is an English sentence.')).toBe('en');
  });

  it('should detect Chinese', () => {
    expect(detectLanguage('这是一个中文句子。')).toBe('zh');
  });

  it('should detect mixed', () => {
    expect(detectLanguage('用户使用JWT认证系统')).toBe('mixed');
  });
});
