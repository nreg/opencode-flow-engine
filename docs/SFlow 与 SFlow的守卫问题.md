不是所有 sFlow 守卫 iFlow 都该跳过。需要区分"工作流特定"和"通用"守卫：
守卫	是否适用于 iFlow	理由
checkArtifactAndPhaseConsistency	✅ 是	iFlow 也有 artifact 一致性要求
checkPresetUpgrade	❌ 否	iFlow 没有 hotfix/tweak 模式
checkContractStalenessGuard	❌ 否	iFlow 没有 execution-contract
checkTaskCompletion	❌ 否	iFlow 用 PLAN.md 而非 tasks.md
checkDebuggingState	❌ 否	iFlow 没有 debugging 状态
checkProgressAntiRepeatGuard	✅ 是	iFlow 也需要防重复
checkFileWriteGuard	✅ 是	iFlow 也需要文件写入边界
checkReadFilesBoundary	✅ 是	iFlow 也需要读文件边界
checkGitCommitBoundary	✅ 是	iFlow 也需要 git commit 边界
checkLessonsGuard	✅ 是	iFlow 也需要 LESSONS 检查
checkOmoUsageGuard	✅ 是	iFlow 也应该使用 OMO

对于 iFlow 不适用的守卫（presetUpgrade, contractStaleness, taskCompletion, debuggingState），改为检查特定文件/状态的存在性：
- checkPresetUpgrade: 检查 .sflow/state.json 中是否有 mode 字段
- checkContractStalenessGuard: 检查 execution-contract.md 是否存在
- checkTaskCompletion: 检查 PLAN.md 是否存在
- checkDebuggingState: 检查 .sflow/state.json 中 state 是否为 debugging