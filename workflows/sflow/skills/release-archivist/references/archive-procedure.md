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

#### Step 1: 确定归档目录名

```bash
# 读取 state.json 获取 changeName
CHANGE_NAME=$(node -e "const s = require('./.flow-engine/sflow/state.json'); console.log(s.changeName || 'change-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))")

# 创建归档目录
ARCHIVE_DIR=".flow-engine/sflow/archive/${CHANGE_NAME}"
mkdir -p "${ARCHIVE_DIR}"
```

#### Step 2: 移动 Active 工件

```bash
# 移动单个文件
move_artifact() {
  local src=".flow-engine/sflow/$1"
  local dst="${ARCHIVE_DIR}/$1"
  if [ -f "$src" ]; then
    mv "$src" "$dst"
    echo "✓ Moved $1 to archive"
  fi
}

# 移动目录
move_directory() {
  local src=".flow-engine/sflow/$1"
  local dst="${ARCHIVE_DIR}/$1"
  if [ -d "$src" ]; then
    mv "$src" "$dst"
    echo "✓ Moved $1/ to archive"
  fi
}

# 执行移动
move_artifact "proposal.md"
move_artifact "design.md"
move_artifact "tasks.md"
move_artifact "execution-contract.md"
move_artifact "boulder-state.json"
move_directory "specs"
```

#### Step 3: 备份并重置 state.json

```bash
# 备份原 state.json
if [ -f ".flow-engine/sflow/state.json" ]; then
  cp ".flow-engine/sflow/state.json" "${ARCHIVE_DIR}/state.json.backup"
fi

# 写入初始状态
cat > ".flow-engine/sflow/state.json" << EOF
{
  "state": "exploring",
  "changeName": "",
  "mode": "full",
  "batches_completed": 0,
  "last_transition": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "✓ Reset state.json to exploring"
```

#### Step 4: 验证跨变更资产保留

```bash
# 确认以下资产仍在根目录
check_preserved() {
  local asset=".flow-engine/sflow/$1"
  if [ -e "$asset" ]; then
    echo "✓ Preserved: $1"
  else
    echo "⚠ Not found: $1 (may not exist yet)"
  fi
}

check_preserved "lessons.md"
check_preserved "subagent-store"
check_preserved "notifications"
check_preserved "verification-report.md"
check_preserved "archive-metadata.json"
```

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
- **移动失败**：停止清理，报告错误，不重置 state.json
- **state.json 写入失败**：回滚移动操作，报告严重错误

### 归档清理后状态

清理完成后，`.flow-engine/sflow/` 根目录应包含：

```
.flow-engine/sflow/
├── state.json              # 初始状态 (state: exploring)
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
        └── state.json.backup
```

下次 `detectWorkflowState` 检测时，将正确识别为 `exploring` 状态，新工作流可正常启动。
