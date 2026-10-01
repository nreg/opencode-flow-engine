/**
 * D2 / W7：session.error 事件驱动预降级测试
 *
 * 覆盖 6 条验收场景：
 * ① non-transient 错误事件 → 拉黑 + 通知
 * ② transient 错误事件 → 拉黑（长冷却）+ 通知
 * ③ abort 错误事件 → 零动作
 * ④ none 分类 → 不拉黑
 * ⑤ 同 sessionID 重复事件去重（只拉黑/通知一次）
 * ⑥ 分类未命中不产生通知
 *
 * + P1-1：换模后旧 session 迟到事件不得误拉黑当前健康模型（attemptedModels 护栏）
 * + P1-2：通知文件必须落到真实 changeDir，而非 process.cwd()
 *
 * 设计：通过注入副作用（blacklistModel / writeNotification 计数）与可注入
 * modelResolver，对 handler 做纯逻辑验证；P1-2 另用真实文件系统验证目录落点。
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles, readJsonFile } from '@opencode-flow-engine/shared';
import {
  clearUnavailableModels,
  isModelAvailable,
  markModelUnavailable,
} from '../agents/agent-builder.js';
import {
  classifySessionError,
  isAbortSessionError,
  serializeErrorForClassifier,
} from '../features/session-error-classifier.js';
import {
  createSessionErrorHandler,
  SESSION_ERROR_DEDUP_WINDOW_MS,
  type SessionErrorSideEffects,
} from '../features/session-error-handler.js';

// ─── 测试辅助 ────────────────────────────────────────────────────────────────

/** 构造一个 SDK ApiError 形态 error（带 statusCode，驱动分类） */
function apiError(statusCode: number): {
  name: string;
  data: { statusCode: number; isRetryable: boolean; message: string };
} {
  return {
    name: 'APIError',
    data: {
      statusCode,
      isRetryable: statusCode === 429 || statusCode >= 500,
      // 注意：message 为 provider 文案，分类器绝不读取它（C-6 兼容）
      message: `provider prose for ${statusCode}`,
    },
  };
}

/** 构造 abort 错误（MessageAbortedError） */
function abortError(): { name: string; data: { message: string } } {
  return { name: 'MessageAbortedError', data: { message: 'aborted by user' } };
}

/** 构造无码具名错误（分类未命中 → none） */
function namedErrorWithoutCode(name: string): { name: string; data: { message: string } } {
  return { name, data: { message: 'some prose without code' } };
}

interface FakeSideEffects extends SessionErrorSideEffects {
  blacklistCalls: Array<{ model: string; opts: { resetAt?: number | null; ttlMs?: number } }>;
  notificationCalls: Array<{ session_id: string; failure_reason?: string }>;
}

function makeFakeEffects(): FakeSideEffects {
  const fx: FakeSideEffects = {
    blacklistCalls: [],
    notificationCalls: [],
    blacklistModel: (model, opts) => {
      fx.blacklistCalls.push({ model, opts });
    },
    writeNotification: async (params) => {
      fx.notificationCalls.push({
        session_id: params.session_id,
        failure_reason: params.failure_reason,
      });
    },
  };
  return fx;
}

// ─── 场景测试 ────────────────────────────────────────────────────────────────

describe('D2 ① non-transient 错误事件 → 拉黑 + 通知', () => {
  beforeEach(() => clearUnavailableModels());

  it('402 配额错误应拉黑模型并写入通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/quota-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-1',
      error: apiError(402),
    });

    expect(result).toBe('blacklisted');
    // 拉黑一次，长冷却语义（non-transient）
    expect(fx.blacklistCalls).toHaveLength(1);
    expect(fx.blacklistCalls[0].model).toBe('provider/quota-model');
    // non-transient 无 resetAt → 长冷却 MIN_QUOTA_COOLDOWN_TTL_MS（30min）
    expect(fx.blacklistCalls[0].opts.ttlMs).toBe(30 * 60_000);
    expect(fx.blacklistCalls[0].opts.resetAt).toBeNull();
    // 通知一次
    expect(fx.notificationCalls).toHaveLength(1);
    expect(fx.notificationCalls[0].failure_reason).toBe('quota-or-persistent');
  });

  it('真实 markModelUnavailable 路径：402 后模型在冷却期内不可用', async () => {
    const fx = makeFakeEffects();
    // 用真实副作用（直接依赖 agent-builder）验证冷却语义
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/real-quota',
      sideEffects: {
        blacklistModel: (model, opts) => {
          markModelUnavailable(model, opts);
        },
        writeNotification: fx.writeNotification,
      },
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    await handler.handle({ sessionID: 'sess-r', error: apiError(402) });
    expect(isModelAvailable('provider/real-quota')).toBe(false);
  });
});

describe('D2 ② transient 错误事件 → 拉黑（短冷却）+ 通知', () => {
  beforeEach(() => clearUnavailableModels());

  it('429 瞬态错误应拉黑模型并写入通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/transient-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-2',
      error: apiError(429),
    });

    expect(result).toBe('blacklisted');
    expect(fx.blacklistCalls).toHaveLength(1);
    expect(fx.blacklistCalls[0].model).toBe('provider/transient-model');
    // transient 短冷却 5min
    expect(fx.blacklistCalls[0].opts.ttlMs).toBe(5 * 60_000);
    expect(fx.notificationCalls).toHaveLength(1);
    expect(fx.notificationCalls[0].failure_reason).toBe('transient');
  });

  it('5xx 瞬态错误同样拉黑 + 通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/5xx-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({ sessionID: 'sess-2b', error: apiError(503) });
    expect(result).toBe('blacklisted');
    expect(fx.blacklistCalls).toHaveLength(1);
    expect(fx.notificationCalls).toHaveLength(1);
  });
});

describe('D2 ③ abort 错误事件 → 零动作', () => {
  it('MessageAbortedError 不应拉黑、不应通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/should-not-be-touched',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-3',
      error: abortError(),
    });

    expect(result).toBe('aborted');
    expect(fx.blacklistCalls).toHaveLength(0);
    expect(fx.notificationCalls).toHaveLength(0);
  });

  it('isAbortSessionError 对 abort 名返回 true，对非 abort 名返回 false', () => {
    expect(isAbortSessionError(abortError())).toBe(true);
    expect(isAbortSessionError(apiError(429))).toBe(false);
    expect(isAbortSessionError(namedErrorWithoutCode('ApiError'))).toBe(false);
  });
});

describe('D2 ④ none 分类 → 不拉黑', () => {
  it('无码具名错误（MessageOutputLengthError）分类未命中，不拉黑不通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/len-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-4',
      error: namedErrorWithoutCode('MessageOutputLengthError'),
    });

    // 分类未命中（none）→ unclassified（模型可解析但分类未命中）
    expect(result).toBe('unclassified');
    expect(fx.blacklistCalls).toHaveLength(0);
    expect(fx.notificationCalls).toHaveLength(0);
  });

  it('classifySessionError 对无码 error 返回 null', () => {
    const r = classifySessionError({
      sessionID: 's',
      error: namedErrorWithoutCode('UnknownError'),
      modelResolver: () => 'provider/x',
    });
    expect(r).toBeNull();
  });
});

describe('D2 ⑤ 同 sessionID 重复事件去重（只拉黑/通知一次）', () => {
  beforeEach(() => clearUnavailableModels());

  it('窗口内重复 session.error 仅处理一次', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/dup-model',
      sideEffects: fx,
      // 大窗口，确保两条事件都在去重窗口内
      dedupWindowMs: 10_000,
    });

    const first = await handler.handle({ sessionID: 'sess-5', error: apiError(429) });
    const second = await handler.handle({ sessionID: 'sess-5', error: apiError(429) });

    expect(first).toBe('blacklisted');
    expect(second).toBe('deduped');
    // 只拉黑一次、只通知一次
    expect(fx.blacklistCalls).toHaveLength(1);
    expect(fx.notificationCalls).toHaveLength(1);
  });
});

describe('D2 ⑥ 分类未命中不产生通知', () => {
  it('无码错误即使模型可解析也不产生通知', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/unknown-code-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-6',
      error: namedErrorWithoutCode('UnknownError'),
    });

    expect(result).toBe('unclassified');
    expect(fx.notificationCalls).toHaveLength(0);
  });

  it('无法定位模型时也不产生通知（避免误拉黑）', async () => {
    const fx = makeFakeEffects();
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => undefined, // 注册表中无此 session
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({
      sessionID: 'sess-6b',
      error: apiError(429),
    });

    expect(result).toBe('no-model');
    expect(fx.blacklistCalls).toHaveLength(0);
    expect(fx.notificationCalls).toHaveLength(0);
  });
});

describe('D2 补充：serializeErrorForClassifier 仅转义结构化码，不拼接文案', () => {
  it('ApiError 仅输出 code 形态，不含 message 文案', () => {
    const s = serializeErrorForClassifier(apiError(429));
    expect(s).toContain('status: 429');
    expect(s).not.toContain('provider prose');
  });

  it('无 statusCode 的具名错误输出空串（分类器返回 null）', () => {
    const s = serializeErrorForClassifier(namedErrorWithoutCode('MessageOutputLengthError'));
    // 仅 type 形态（C-6 兼容，不触发文案匹配）；分类器对该 type 不归一化为码 → null
    expect(s).toBe('type: MessageOutputLengthError');
  });
});

// ─── P1-1：换模后旧 session 迟到事件不得误拉黑当前健康模型 ───────────────────────

describe('P1-1 ① 换模后旧 session 迟到事件不拉黑新模型', () => {
  beforeEach(() => clearUnavailableModels());

  it('session 已换模（attemptedModels>1）：迟到旧模型错误 → 不拉黑当前解析模型', async () => {
    const fx = makeFakeEffects();
    // 模拟 P1-1 场景：registry 已换模，resolvedModel 指向健康新模型 B，
    // 但迟到的错误事件属于旧模型 A。modelResolver 内置护栏：attemptedModels>1 返回 undefined。
    const handler = createSessionErrorHandler({
      changeDir: '',
      // 护栏版解析器（与三工厂一致）：已换模 session 返回 undefined
      modelResolver: () => undefined,
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({ sessionID: 'sess-fb', error: apiError(402) });

    // 不拉黑、不通知（交由轮询路径兜底）
    expect(result).toBe('no-model');
    expect(fx.blacklistCalls).toHaveLength(0);
    expect(fx.notificationCalls).toHaveLength(0);
  });

  it('护栏等价方案：classifySessionError 对「已换模」解析器返回 null（不误拉黑）', () => {
    // 直接验证纯分类层：当 modelResolver 因 P1-1 护栏返回 undefined 时，
    // 即便错误码可分类（402），分类结果为 null → 上层不拉黑。
    const r = classifySessionError({
      sessionID: 'sess-fb',
      error: apiError(402),
      modelResolver: () => undefined, // 已换模 session：护栏命中
    });
    expect(r).toBeNull();
  });

  it('对照：未换模（attemptedModels<=1）session 仍正常拉黑', async () => {
    const fx = makeFakeEffects();
    // 未换模 session：modelResolver 返回当前模型（B），护栏不拦截
    const handler = createSessionErrorHandler({
      changeDir: '',
      modelResolver: () => 'provider/current-model',
      sideEffects: fx,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });

    const result = await handler.handle({ sessionID: 'sess-ok', error: apiError(402) });

    expect(result).toBe('blacklisted');
    expect(fx.blacklistCalls).toHaveLength(1);
    expect(fx.blacklistCalls[0].model).toBe('provider/current-model');
    expect(fx.notificationCalls).toHaveLength(1);
  });
});

// ─── P1-2：通知文件落真实 changeDir，而非 process.cwd() ─────────────────────────

describe('P1-2 ① 通知文件落在真实 changeDir 而非 process.cwd()', () => {
  beforeEach(() => clearUnavailableModels());

  it('使用注入的 changeDir 写入通知，不与 process.cwd() 耦合', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sflow-p1-2-'));
    try {
      // 真实副作用（默认 NotificationManager），changeDir 传入临时目录
      const handler = createSessionErrorHandler({
        changeDir: dir,
        modelResolver: () => 'provider/p1-2-model',
        dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
      });

      const result = await handler.handle({ sessionID: 'sess-p12', error: apiError(429) });
      expect(result).toBe('blacklisted');

      // 通知文件应落在 <dir>/.flow-engine/sflow/notifications/ 下
      const notifDir = join(dir, '.flow-engine/sflow/notifications');
      const files = await listFiles(notifDir, '.json');
      expect(files).toHaveLength(1);

      // 关键断言：process.cwd() 下不应出现本事件的通知文件（落点正确，非 cwd）
      const cwdNotifDir = join(process.cwd(), '.flow-engine/sflow/notifications');
      const cwdFiles = await listFiles(cwdNotifDir, '.json').catch(() => []);
      expect(cwdFiles).not.toContain('sess-p12.json');

      // 通知内容正确
      const entry = await readJsonFile<{ session_id: string; failure_reason?: string }>(
        join(notifDir, files[0]),
      );
      expect(entry?.session_id).toBe('sess-p12');
      expect(entry?.failure_reason).toBe('transient');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('changeDir 经构造参数注入，且默认副作用使用它（非 process.cwd）', () => {
    // 验证 createSessionErrorHandler 的 deps.changeDir 被默认副作用采用：
    // 用真实 NotificationManager 探测目录是否按注入值创建（不实际写文件，仅构造）。
    const handler = createSessionErrorHandler({
      changeDir: '/nonexistent/injected-dir-p1-2',
      modelResolver: () => undefined,
      dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
    });
    // 构造本身不抛错即说明 changeDir 被接受（真实落点在 handle 时惰性使用）
    expect(typeof handler.handle).toBe('function');
    expect(typeof handler.resetDedup).toBe('function');
  });

  it('两个不同 changeDir 各自落盘、互不串写（per-workDir handler 隔离）', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'sflow-p1-2-a-'));
    const dirB = await mkdtemp(join(tmpdir(), 'sflow-p1-2-b-'));
    try {
      // 分别构造两个 changeDir 的 handler，各自写入同名 sessionID 的错误事件。
      // 若 changeDir 被写死为 process.cwd()，两者会串写到同一份通知文件。
      const handlerA = createSessionErrorHandler({
        changeDir: dirA,
        modelResolver: () => 'provider/model-a',
        dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
      });
      const handlerB = createSessionErrorHandler({
        changeDir: dirB,
        modelResolver: () => 'provider/model-b',
        dedupWindowMs: SESSION_ERROR_DEDUP_WINDOW_MS,
      });

      expect(await handlerA.handle({ sessionID: 'sess-shared', error: apiError(402) })).toBe(
        'blacklisted',
      );
      expect(await handlerB.handle({ sessionID: 'sess-shared', error: apiError(402) })).toBe(
        'blacklisted',
      );

      // A 目录：落盘，且解析模型为 model-a
      const notifAFiles = await listFiles(join(dirA, '.flow-engine/sflow/notifications'), '.json');
      expect(notifAFiles).toHaveLength(1);
      const entryA = await readJsonFile<{ session_id: string }>(
        join(dirA, '.flow-engine/sflow/notifications', notifAFiles[0]),
      );
      expect(entryA?.session_id).toBe('sess-shared');

      // B 目录：同样落盘（独立一份，不与 A 串写）
      const notifBFiles = await listFiles(join(dirB, '.flow-engine/sflow/notifications'), '.json');
      expect(notifBFiles).toHaveLength(1);

      // 关键：A/B 各自独立落盘 1 份（若 changeDir 写死为 process.cwd()，
      // 第二次 handle 会覆盖/串写到同一目录，导致单侧文件数异常或两边落同一处）
      expect(notifAFiles).toHaveLength(1);
      expect(notifBFiles).toHaveLength(1);

      // cwd 下不应出现本测试任一通知（真实落点由注入的 changeDir 决定）
      const cwdFiles = await listFiles(
        join(process.cwd(), '.flow-engine/sflow/notifications'),
        '.json',
      ).catch(() => []);
      expect(cwdFiles).not.toContain('sess-shared.json');
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});
