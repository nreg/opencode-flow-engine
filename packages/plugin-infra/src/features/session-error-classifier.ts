/**
 * Session Error Classifier — pure 预分类（D2 / W7）
 *
 * 事件驱动预降级的核心判据：把 SDK 的 session.error 事件体（携带
 * sessionID + error）转换为模型错误分类结果 { kind, model }，供上层
 * handler 做拉黑 + 通知。
 *
 * 约束（与既有降级链路一致）：
 * - C-1：不改动 classifyModelErrorByCode 函数体，仅复用；
 * - C-6：只用错误码 / 错误名（error.name），禁止任何 provider 文案正则匹配；
 * - abort 零降级语义优先：error.name ∈ ABORT_ERROR_NAMES → 返回 null（零动作）。
 *
 * 设计要点：本模块只做「分类」，不持有状态、不写 registry、不写通知，
 * 全部副作用交由上层 handler（有状态、可注入依赖）负责，便于单测。
 */

import {
  classifyModelErrorByCode,
  type ModelErrorCodeClass,
  type ModelErrorCodeInfo,
} from '../helpers/completion-detector.js';
import { ABORT_ERROR_NAMES } from '../tools/call-flow-agent.js';

/** session.error 事件里的 error 对象（SDK EventSessionError.properties.error 联合体） */
export type SessionErrorData =
  | {
      name: string;
      data?: { message?: string; statusCode?: number; isRetryable?: boolean; [k: string]: unknown };
    }
  | { name?: string; message?: string; statusCode?: number; [k: string]: unknown }
  | string
  | unknown;

/** 预分类结果 */
export interface SessionErrorClassification {
  /** non-transient（配额/账号级持久错误）→ 长冷却拉黑；transient → 短冷却 */
  kind: ModelErrorCodeClass;
  /** 待拉黑的模型字符串（已解析） */
  model: string;
  /** 原始分类器返回的附加信息（resetAt 等） */
  info: ModelErrorCodeInfo;
}

/**
 * 精确相等判断 error 名是否属于 abort 取消类（禁止包含式匹配，C-6）。
 */
export function isAbortSessionError(error: SessionErrorData | undefined): boolean {
  const name = extractErrorName(error);
  return name !== undefined && ABORT_ERROR_NAMES.includes(name);
}

/**
 * 从 SDK error 对象中提取错误名（error.name）。
 * SDK 8 种具名错误类型均带 name 字段；ApiError 的 name 为 "APIError"。
 * 兼容部分包装层 error 直接挂在顶层（{ name, message }）。
 */
export function extractErrorName(error: SessionErrorData | undefined): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string') return undefined;
  const obj = error as Record<string, unknown>;
  const name = obj.name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * 将 SDK error 对象序列化为「错误码驱动分类器」可消费的字符串。
 *
 * 关键约束：只转义结构化字段（statusCode / isRetryable / name），
 * 绝不拼接 provider 文案（message）——C-6 禁止错误文案匹配。
 * 分类器对 ApiError（name=APIError）按 statusCode 判定瞬态（429/5xx）
 * 或非瞬态（401/402/403/404），对具名错误类型（MessageOutputLengthError 等）
 * 因无 code 而返回 null（none，不拉黑），与既有「无码报错不分类」语义一致。
 *
 * @param error - SDK session.error 事件里的 error 对象
 * @returns 仅含结构化码的短串；无 statusCode / name 时返回空串（分类器返回 null）
 */
export function serializeErrorForClassifier(error: SessionErrorData | undefined): string {
  if (error === undefined || error === null) return '';
  if (typeof error === 'string') return '';

  const obj = error as Record<string, unknown>;
  const parts: string[] = [];

  // 错误码驱动：仅 statusCode 字段（ApiError.data.statusCode / 顶层 statusCode）
  const statusCode =
    (typeof obj.statusCode === 'number' && obj.statusCode) ||
    (obj.data && typeof (obj.data as Record<string, unknown>).statusCode === 'number'
      ? (obj.data as Record<string, unknown>).statusCode
      : undefined);
  if (typeof statusCode === 'number') {
    // SDK error 的 statusCode 字段 → 转义为 `status: N` 形态，
    // 命中 classifyModelErrorByCode 的 STATUS_FIELD_PATTERN（status[:=]N）。
    // 仅转义 SDK 自有结构化状态码，绝不拼接 provider message 文案（C-6）。
    parts.push(`status: ${statusCode}`);
  }

  // 错误名（仅作为 type 形态兜底，供分类器对 *Quota*/*RateLimit* type 归一化——
  // 但本项目具名错误名不含 Quota/RateLimit 关键字，仅作保留兼容，不影响判定）
  const name = extractErrorName(error);
  if (name !== undefined) {
    parts.push(`type: ${name}`);
  }

  return parts.join(' ');
}

/**
 * 预分类主函数（纯函数）。
 *
 * @param args.sessionID - 事件携带的 sessionID
 * @param args.error - SDK error 对象
 * @param args.modelResolver - sessionID → 模型字符串 解析器（如后台任务注册表查询）；
 *                             解析不到模型时返回 undefined（分类命中但无法定位模型 → 仍返回分类，由上层决定）。
 *                             该解析器已内置 P1-1 归属护栏：仅在 session 尚未换模时返回当前模型，
 *                             换模后的迟到旧模型事件返回 undefined，交由轮询路径处理。
 * @returns 分类结果（含模型），abort / 分类未命中（none）/ 无法定位模型 返回 null
 */
export function classifySessionError(args: {
  sessionID?: string;
  error: SessionErrorData | undefined;
  modelResolver: (sessionID: string | undefined) => string | undefined;
}): SessionErrorClassification | null {
  // 1. abort 零降级优先：直接忽略，不做任何降级
  if (isAbortSessionError(args.error)) {
    return null;
  }

  // 2. 解析待拉黑模型（事件体只带 sessionID + error，不带模型）。
  // modelResolver 已内置 P1-1 护栏：换模后返回 undefined。
  const model = args.modelResolver(args.sessionID);
  if (!model) {
    // 无法定位模型（含 P1-1 换模后护栏命中）：放弃预降级（避免误拉黑默认/无关/健康模型）。
    // 轮询路径仍会按产出正文独立判定，不在此兜底。
    return null;
  }

  // 3. 错误码驱动分类（只转义结构化码，不碰文案，C-6）
  const codeText = serializeErrorForClassifier(args.error);
  const info = classifyModelErrorByCode(codeText);
  if (info === null) {
    // 分类未命中（none）→ 不拉黑、不通知
    return null;
  }

  return { kind: info.kind, model, info };
}
