# Archive Procedure

## Final Checks

- Are required tests passing? (cite the command and output)
- Are execution batches complete? (cite batch-by-batch status)
- Was any scope added without artifact updates? (cite specific files if yes)
- Are there unresolved blockers or known risks?
- Is the change ready to archive, or should it remain active?
- Do delta specs exist that need merging into main specs?
- Has `artifact_inspector` been run? If not, run it now and include the decision-point audit in the archive.

## Archive Rule

Do not archive blindly.

If implementation diverged from the contract, return to `bridging` before closure.

## Post-Verification Routing

After verification completes:

1. Update `.flow-engine/sflow/state.json` with `state: closing` and record the transition timestamp
2. If delta specs were created, route to `spec-merger` before final archiving
3. If no delta specs exist, the change is ready to archive

The closure is not complete until delta specs are merged. Specs that aren't synced become lies.

## Output Standard

Your response should include:

1. verification evidence (command run, output excerpt, exit code)
2. contract obligation status (which passed, which didn't)
3. delivered behavior summary
4. residual risks
5. delta spec status (exist or not)
6. recommended routing (to `spec-merger` or archive)

## Lightweight Closure (hotfix/tweak mode)

When workflow is `hotfix` or `tweak`, release-archivist performs lightweight verification:
1. Verify all changed files exist and are non-empty
2. Run syntax check on code files (`node --check` for .mjs/.js)
3. Skip the full 5-step three-dimensional verification
4. Still record DP-6 (验证失败) and DP-7 (归档确认) decision points
5. Delta specs are NOT generated in lightweight closure (no specs to sync)

## Archive Cleanup Procedure

**触发时机**：DP-7 归档确认后，在写入 `verification-report.md` 和 `archive-metadata.json` 之后执行。

**目的**：清理 `.flow-engine/sflow/` 根目录的 active 工件，避免下次工作流状态检测误判。

### 步骤概览

1. **确定归档目录名** — 优先使用 `state.json` 的 `changeName`，否则用时间戳
2. **创建归档目录** — `.flow-engine/sflow/archive/<change-name>/`
3. **移动 active 工件** — proposal、design、tasks、execution-contract、specs
4. **保留跨变更资产** — lessons、subagent-store、notifications 等
5. **重置 state.json** — 写入初始状态（state: exploring）
6. **记录归档元数据** — 更新 archive-metadata.json

### 详细步骤

#### Step 1: 调用 archiveCleanup 函数（推荐）

归档清理通过跨平台 TypeScript 函数执行，兼容 Windows/macOS/Linux：

```typescript
import { archiveCleanup } from 'opencode-flow-engine/plugin-infra';

const result = await archiveCleanup(process.cwd());

if (result.success) {
  console.log('Archive Cleanup:', result.changeName);
  console.log('Archived files:', result.archivedFiles);
  console.log('Preserved assets:', result.preservedAssets);
  console.log('Archive directory:', result.archiveDir);
} else {
  console.error('Archive cleanup failed:', result.error);
}
```

**函数特性**：
- **跨平台兼容**：使用 `fs/promises` API，不依赖 shell 命令
- **两阶段提交**：先复制到 archive/ → 验证完整性 → 再删除原文件
- **保留原 mode**：state.json 重置时保留 hotfix/tweak 模式
- **事务性保证**：任一步骤失败返回明确错误状态

#### Step 2: POSIX 参考命令（仅作参考）

以下 bash 命令仅用于理解逻辑，**实际执行应使用 TypeScript 函数**：

```bash
# 读取 state.json 获取 changeName
CHANGE_NAME=$(node -e "const s = require('./.flow-engine/sflow/state.json'); console.log(s.changeName || 'change-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))")

# 创建归档目录
ARCHIVE_DIR=".flow-engine/sflow/archive/${CHANGE_NAME}"
mkdir -p "${ARCHIVE_DIR}"
```

**Windows 兼容说明**：
- `mkdir -p` 在 Windows PowerShell 中为 `New-Item -ItemType Directory -Force`
- `mv` 在 Windows 中为 `Move-Item -Force`
- `cp` 在 Windows 中为 `Copy-Item -Force`
- **推荐使用 TypeScript 函数**，避免平台差异

### 示例输出

```
Archive Cleanup: change-auth-service-20260822-143000

✓ Moved proposal.md to archive
✓ Moved design.md to archive
✓ Moved tasks.md to archive
✓ Moved execution-contract.md to archive
✓ Moved specs/ to archive
✓ Reset state.json to exploring

Preserved cross-change assets:
✓ Preserved: lessons.md
✓ Preserved: subagent-store
✓ Preserved: notifications
✓ Preserved: verification-report.md
✓ Preserved: archive-metadata.json

Archive directory: .flow-engine/sflow/archive/change-auth-service-20260822-143000/
Root directory ready for next workflow (state: exploring)
```

### 错误处理

- **归档目录已存在**：追加时间戳后缀（如 `change-auth-20260822-143000-2`）
- **工件不存在**：跳过，记录日志（不视为错误）
- **移动失败**：TypeScript 函数返回 `success: false` 和错误信息
- **state.json 写入失败**：函数返回错误状态，不删除原工件（两阶段提交保护）

### 归档清理后状态

清理完成后，`.flow-engine/sflow/` 根目录应包含：

```
.flow-engine/sflow/
├── state.json              # 初始状态 (state: exploring, mode 保留原值)
├── lessons.md              # 经验教训库
├── subagent-store/         # 子代理状态
├── notifications/          # 通知记录
├── verification-report.md  # 验证报告
├── archive-metadata.json   # 归档元数据
└── archive/
    └── <change-name>/
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        ├── execution-contract.md
        ├── specs/
        ├── boulder-state.json  # 如存在
        └── state.json.backup
```

下次 `detectWorkflowState` 检测时，将正确识别为 `exploring` 状态，新工作流可正常启动。
