/**
 * Output Extractor — P2: Output Schema Structuring
 *
 * Provides JSON block extraction from subagent output text and
 * agent-specific schema hint configuration.
 *
 * Extraction strategy (ordered):
 * 1. Extract content from ```json ... ``` code fences
 * 2. Extract bare JSON objects ({...}) from first { to last }
 * 3. Both fail → return null (fallback)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Schema hint configuration for a specific agent type */
export interface OutputSchemaHint {
  /** Prompt suffix instructing the agent to output structured JSON */
  hint: string;
  /** Default schema object showing expected structure */
  schema: Record<string, unknown>;
}

// ─── Agent Output Schema Configuration ──────────────────────────────────────

export const AGENT_OUTPUT_SCHEMAS: Record<string, OutputSchemaHint> = {
  'build-executor': {
    hint: '请在输出末尾包含如下格式的 JSON block：\n```json\n{"files_changed": ["string"], "tests_passed": boolean, "blockers": ["string"]}\n```',
    schema: { files_changed: [], tests_passed: false, blockers: [] },
  },
  'verifier': {
    hint: '请在输出末尾包含如下格式的 JSON block：\n```json\n{"blockers": ["string"], "warnings": ["string"], "score": number}\n```',
    schema: { blockers: [], warnings: [], score: 0 },
  },
};

// ─── Extraction Functions ───────────────────────────────────────────────────

/**
 * Extract and parse a JSON block from subagent output text.
 *
 * Strategy:
 * 1. Try to extract from ```json ... ``` code fence
 * 2. Try to extract bare JSON object (first { to last })
 * 3. Both fail → return null
 *
 * @param output - The raw output text from the subagent
 * @returns Parsed JSON object, or null if extraction/parsing fails
 */
export function extractJsonBlock(output: string): Record<string, unknown> | null {
  if (!output || typeof output !== 'string') {
    return null;
  }

  // Strategy 1: Extract from ```json ... ``` code fence
  const codeFenceMatch = output.match(/```json\s*\n([\s\S]*?)\n```/);
  if (codeFenceMatch) {
    const jsonStr = codeFenceMatch[1]?.trim();
    if (jsonStr) {
      const parsed = safeParseJson(jsonStr);
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  // Strategy 2: Extract bare JSON object (first { to last })
  // First, strip code fences to avoid interference from invalid code fence content
  const strippedOutput = output.replace(/```[\s\S]*?```/g, '');
  const firstBrace = strippedOutput.indexOf('{');
  const lastBrace = strippedOutput.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = strippedOutput.slice(firstBrace, lastBrace + 1);
    const parsed = safeParseJson(jsonStr);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }

  return null;
}

/**
 * Safely parse a JSON string, returning null on failure.
 */
function safeParseJson(str: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(str);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the schema hint for a given agent type.
 *
 * @param subagentType - The subagent type identifier
 * @returns The schema hint string, or null if no configuration exists
 */
export function getSchemaHint(subagentType: string): string | null {
  const config = AGENT_OUTPUT_SCHEMAS[subagentType];
  return config?.hint ?? null;
}
