# Plan: {{title}}

## Objective
{{what_and_why}}

## Context
{{context_references}}

## Tasks

> **Nyquist Rule**: 每个任务必须包含可执行的自动化验证命令（`<automated>` 标签）。不可只写人工验证步骤。如果测试尚不存在，Wave 0 必须先创建测试。

### Task 1: {{description}}
- **Type**: auto | checkpoint | tdd
- **Complexity**: S | M | L | XL
- **Score**: {{numeric_score}}
- **Wave**: 1
- **Depends On**: (none)
- **Files**: {{file_paths}}
- **Actions**:
  1. {{specific_action}}
  2. {{specific_action}}
- **Assessment**: {{rationale}}
- **Verification**:
  ```xml
  <automated>{{automated_verify_command}}</automated>
  ```
  {{manual_verify_steps}}

### Task 2: {{description}}
- **Type**: auto
- **Complexity**: S | M | L | XL
- **Score**: {{numeric_score}}
- **Wave**: 1 | 2
- **Depends On**: Task 1
- **Files**: {{file_paths}}
- **Actions**:
  1. {{specific_action}}
- **Assessment**: {{rationale}}
- **Verification**:
  ```xml
  <automated>{{automated_verify_command}}</automated>
  ```
  {{manual_verify_steps}}

## Success Criteria
- [ ] {{criterion_1}}
- [ ] {{criterion_2}}
