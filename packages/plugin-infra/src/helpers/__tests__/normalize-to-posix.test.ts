import { describe, expect, it } from 'bun:test';
import { normalizeToPosix } from '../normalize-to-posix.js';

describe('normalizeToPosix', () => {
  it('Windows 反斜杠路径转为正斜杠', () => {
    expect(normalizeToPosix('E:\\work\\nreg\\ai-agent')).toBe('E:/work/nreg/ai-agent');
  });

  it('已是正斜杠的路径原样返回', () => {
    expect(normalizeToPosix('E:/work/nreg/ai-agent')).toBe('E:/work/nreg/ai-agent');
    expect(normalizeToPosix('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('混合分隔符统一为正斜杠', () => {
    expect(normalizeToPosix('E:\\work/nreg\\ai-agent')).toBe('E:/work/nreg/ai-agent');
  });

  it('盘符根 E:\\ 归一为 E:/', () => {
    expect(normalizeToPosix('E:\\')).toBe('E:/');
    expect(normalizeToPosix('C:\\\\')).toBe('C:/');
  });

  it('重复分隔符折叠为单个', () => {
    expect(normalizeToPosix('E:\\work\\\\nreg\\\\\\ai-agent')).toBe('E:/work/nreg/ai-agent');
    expect(normalizeToPosix('/usr//local///bin')).toBe('/usr/local/bin');
  });

  it('相对路径保持相对语义', () => {
    expect(normalizeToPosix('src\\helpers\\__tests__')).toBe('src/helpers/__tests__');
    expect(normalizeToPosix('./a\\b/..\\c')).toBe('./a/b/../c');
  });

  it('空串与裸盘符原样返回', () => {
    expect(normalizeToPosix('')).toBe('');
    expect(normalizeToPosix('E:')).toBe('E:');
  });

  it('UNC 路径前导双斜杠折叠为单斜杠（POSIX 化一致性）', () => {
    expect(normalizeToPosix('\\\\server\\share\\file')).toBe('/server/share/file');
  });
});
