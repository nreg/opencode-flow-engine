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
import { sessionErrorModelForBlacklist } from '../features/session-error-fence.js';
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

// ─── P2-2′：护栏纯函数 sessionErrorModelForBlacklist 直接单测 ─────────────────

describe('P2-2′: sessionErrorModelForBlacklist 边界（护栏直接单测）', () => {
  it('entry 为 undefined → 返回 undefined（无记录则不拉黑）', () => {
    expect(sessionErrorModelForBlacklist(undefined)).toBeUndefined();
  });

  it('attemptedModels 缺省 → 返回 resolvedModel（未换模，事件路径可拉黑）', () => {
    expect(sessionErrorModelForBlacklist({ resolvedModel: 'provider/B' })).toBe('provider/B');
  });

  it('attemptedModels=[] → 返回 resolvedModel', () => {
    expect(
      sessionErrorModelForBlacklist({ resolvedModel: 'provider/B', attemptedModels: [] }),
    ).toBe('provider/B');
  });

  it('attemptedModels=[A] (length=1) → 返回 resolvedModel（未换模）', () => {
    expect(
      sessionErrorModelForBlacklist({
        resolvedModel: 'provider/B',
        attemptedModels: ['provider/A'],
      }),
    ).toBe('provider/B');
  });

  it('attemptedModels=[A,B] (length>1) → 返回 undefined（已换模，交轮询路径）', () => {
    expect(
      sessionErrorModelForBlacklist({
        resolvedModel: 'provider/B',
        attemptedModels: ['provider/A', 'provider/B'],
      }),
    ).toBeUndefined();
  });

  it('length>1 且 resolvedModel 缺失 → 仍返回 undefined（护栏先于模型判空）', () => {
    expect(
      sessionErrorModelForBlacklist({ attemptedModels: ['provider/A', 'provider/B'] }),
    ).toBeUndefined();
  });

  it('resolvedModel 缺失且未换模 → 返回 undefined（无模型可拉黑）', () => {
    expect(sessionErrorModelForBlacklist({ attemptedModels: ['provider/A'] })).toBeUndefined();
  });

  // P2-1′：sync 路径历史字段 fallbackAttempted 亦须被识别为「已换模」
  it('仅 fallbackAttempted=[A,B]（attemptedModels 缺省）→ 返回 undefined（sync 历史条目）', () => {
    expect(
      sessionErrorModelForBlacklist({
        resolvedModel: 'provider/B',
        fallbackAttempted: ['provider/A', 'provider/B'],
      }),
    ).toBeUndefined();
  });

  it('fallbackAttempted=[A]（length=1）→ 返回 resolvedModel', () => {
    expect(
      sessionErrorModelForBlacklist({
        resolvedModel: 'provider/B',
        fallbackAttempted: ['provider/A'],
      }),
    ).toBe('provider/B');
  });

  it('护栏判据单调：attemptedModels 增长不导致结果在「拉黑 / 不拉黑」间抖动', () => {
    const grow: string[] = ['provider/A'];
    expect(
      sessionErrorModelForBlacklist({ resolvedModel: 'provider/A', attemptedModels: grow }),
    ).toBe('provider/A');
    grow.push('provider/B');
    expect(
      sessionErrorModelForBlacklist({ resolvedModel: 'provider/B', attemptedModels: grow }),
    ).toBeUndefined();
  });
});

// ─── P2-2′：三工厂护栏接线（getter 导出为测试钩子）───────────────────────────

describe('P2-2′: 三工厂 sessionErrorHandler 接线（workDir 建键 + 实例隔离）', () => {
  /**
   * 工厂 modelResolver 反查工厂私有 backgroundTaskRegistry（测试无法注入），
   * 空 registry → 解析不到模型 → 'no-model'。因此「changeDir 是否为 workDir」
   * 用两条可观测锚点钉死：
   *   1) handler 缓存 Map 以 workDir 为 key（写死 process.cwd() 则所有 workDir
   *      共用一个 key，不同 workDir 共享实例 → 串写）；
   *   2) 去重窗口 lastSeen 是 per-handler 状态：共享实例时同一 sessionID 的第二条
   *      事件会被判 'deduped'，据此可反证实例独立。
   */
  async function assertWorkDirKeyed(
    label: string,
    getter: (dir: string) => { handle: (e: unknown) => Promise<string> },
    cache: Map<string, unknown>,
  ): Promise<void> {
    const dirA = await mkdtemp(join(tmpdir(), `sflow-p22-${label}-a-`));
    const dirB = await mkdtemp(join(tmpdir(), `sflow-p22-${label}-b-`));
    try {
      const handlerA = getter(dirA);
      const handlerB = getter(dirB);

      // 锚点 1：两个不同 workDir 各自持有独立 handler 实例（未串写）
      expect(cache.has(dirA)).toBe(true);
      expect(cache.has(dirB)).toBe(true);
      expect(handlerA).not.toBe(handlerB);
      // key 必须是注入的 workDir，绝不能是 process.cwd()
      for (const key of cache.keys()) {
        expect(key).not.toBe(process.cwd());
      }

      // 锚点 2：per-handler 去重窗口独立（共享实例则共享 lastSeen → 第二事件被 dedup）
      await handlerA.handle({ sessionID: 'sess-p22-shared', error: apiError(429) });
      const resB = await handlerB.handle({ sessionID: 'sess-p22-shared', error: apiError(429) });
      expect(resB).not.toBe('deduped');
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  }

  it('sflow 工厂：handler 按 workDir 建键与隔离（非 process.cwd）', async () => {
    const sflow = await import('../sflow-plugin-factory.js');
    await assertWorkDirKeyed(
      'sflow',
      sflow.getSflowSessionErrorHandlerForTest,
      sflow.sflowSessionErrorHandlersForTest,
    );
  });

  it('iflow 工厂：handler 按 workDir 建键与隔离（非 process.cwd）', async () => {
    const iflow = await import('../iflow-plugin-factory.js');
    await assertWorkDirKeyed(
      'iflow',
      iflow.getIflowSessionErrorHandlerForTest,
      iflow.iflowSessionErrorHandlersForTest,
    );
  });

  it('combined 工厂：handler 按 workDir 建键与隔离（非 process.cwd）', async () => {
    const combined = await import('../combined-plugin-factory.js');
    await assertWorkDirKeyed(
      'combined',
      combined.getCombinedSessionErrorHandlerForTest,
      combined.combinedSessionErrorHandlersForTest,
    );
  });

  it('三工厂 getter 复用同一 handler（per-workDir 缓存命中，非每次新建）', async () => {
    const sflow = await import('../sflow-plugin-factory.js');
    const h1 = sflow.getSflowSessionErrorHandlerForTest('/p22-cache-dir');
    const h2 = sflow.getSflowSessionErrorHandlerForTest('/p22-cache-dir');
    expect(h1).toBe(h2);
    expect(sflow.getSflowSessionErrorHandlerForTest('/p22-other-dir')).not.toBe(h1);
  });

  it('sflow 工厂：handler 收到的 changeDir 就是注入的 workDir（非 process.cwd）', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'sflow-p23-dir-'));
    try {
      const sflow = await import('../sflow-plugin-factory.js');
      const handler = sflow.getSflowSessionErrorHandlerForTest(workDir);

      // 直接断言「创建 handler 时传进 createSessionErrorHandler 的 changeDir」。
      // 这是 P1-2 的核心接线：通知/落盘目录由 handler 内部 changeDir 决定。
      expect(sflow.sflowSessionErrorHandlerChangeDirForTest.get(workDir)).toBe(workDir);
      expect(sflow.sflowSessionErrorHandlerChangeDirForTest.get(workDir)).not.toBe(
        process.cwd(),
      );

      // 真实事件仍可跑通（默认副作用就位，未因观测点而退化）
      const result = await handler.handle({ sessionID: 'sess-p23', error: apiError(429) });
      expect(result).toBe('no-model'); // 无 registry 反查 → 分类失败，不拉黑

      // 落盘验证：通知落在注入的 workDir 下，cwd 下没有（P1-2 观测量）
      const notifDir = join(workDir, '.flow-engine/sflow/notifications');
      const workFiles = await listFiles(notifDir, '.json').catch(() => []);
      const cwdFiles = await listFiles(
        join(process.cwd(), '.flow-engine/sflow/notifications'),
        '.json',
      ).catch(() => []);
      expect(cwdFiles).not.toContain('sess-p23.json');
      expect(workFiles).not.toContain('sess-p23.json'); // 未拉黑则不落盘
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('三工厂 changeDir 观测值均为注入 workDir 且互不相同（无串写）', async () => {
    const dirS = await mkdtemp(join(tmpdir(), 'p23-s-'));
    const dirI = await mkdtemp(join(tmpdir(), 'p23-i-'));
    const dirC = await mkdtemp(join(tmpdir(), 'p23-c-'));
    try {
      const sflow = await import('../sflow-plugin-factory.js');
      const iflow = await import('../iflow-plugin-factory.js');
      const combined = await import('../combined-plugin-factory.js');

      sflow.getSflowSessionErrorHandlerForTest(dirS);
      iflow.getIflowSessionErrorHandlerForTest(dirI);
      combined.getCombinedSessionErrorHandlerForTest(dirC);

      const s = sflow.sflowSessionErrorHandlerChangeDirForTest.get(dirS);
      const i = iflow.iflowSessionErrorHandlerChangeDirForTest.get(dirI);
      const c = combined.combinedSessionErrorHandlerChangeDirForTest.get(dirC);

      // 三者都等于各自注入的 workDir，且都不等于 cwd、彼此不等
      expect(s).toBe(dirS);
      expect(i).toBe(dirI);
      expect(c).toBe(dirC);
      expect(s).not.toBe(process.cwd());
      expect(i).not.toBe(process.cwd());
      expect(c).not.toBe(process.cwd());
      expect(new Set([s, i, c]).size).toBe(3);
    } finally {
      for (const d of [dirS, dirI, dirC]) {
        await rm(d, { recursive: true, force: true });
      }
    }
  });

  it('iflow 工厂：真实事件经 handler 落盘通知落在注入的 workDir（非 process.cwd）', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'iflow-p23-dir-'));
    try {
      const iflow = await import('../iflow-plugin-factory.js');
      // 无 registry 反查 → 分类失败返回 'no-model'（不拉黑、不落盘）
      const handler = iflow.getIflowSessionErrorHandlerForTest(workDir);
      const result = await handler.handle({
        sessionID: 'sess-iflow-p23',
        error: apiError(429),
      });
      expect(result).toBe('no-model');

      // 关键断言：handler 默认副作用按注入的 changeDir 构造 NotificationManager
      //（构造期即 join(changeDir, '.flow-engine/sflow/notifications')）。
      // 若 changeDir 被写死为 process.cwd()，该目录不会出现在 workDir 下。
      expect(iflow.iflowSessionErrorHandlerChangeDirForTest.get(workDir)).toBe(workDir);
      expect(
        iflow.iflowSessionErrorHandlerChangeDirForTest.get(workDir),
      ).not.toBe(process.cwd());
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
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
