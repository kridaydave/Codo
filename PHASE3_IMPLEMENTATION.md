# Phase 3 Implementation: Git Worktree Isolation

## Overview

Implement worktree-based isolation for agents, ensuring each agent works in its own git branch and directory. This prevents agents from interfering with each other's work and provides a clean diff for user review before merging to main.

## Architecture

### New Module: `src/git/worktree-manager.ts`

Create a new worktree manager class that handles:

```typescript
export interface WorktreeConfig {
  baseBranch: string; // main or master
  worktreeBasePath: string; // e.g., ./worktrees
  branchPrefix: string; // e.g., "agent-"
}

export interface Worktree {
  id: string;
  branch: string;
  path: string;
  status: 'pending' | 'active' | 'merged' | 'aborted';
  createdAt: Date;
}

export class WorktreeManager {
  constructor(config: WorktreeConfig);

  // Create a new worktree with a unique branch for an agent
  async create(agentId: string): Promise<Worktree>;

  // Generate a diff between the worktree branch and base branch
  async generateDiff(worktree: Worktree): Promise<string>;

  // Merge the worktree branch into the base branch
  async merge(worktree: Worktree): Promise<void>;

  // Abort/revert the worktree (discard changes)
  async abort(worktree: Worktree): Promise<void>;

  // Clean up a worktree (remove branch and directory)
  async cleanup(worktree: Worktree): Promise<void>;

  // List all active worktrees
  async list(): Promise<Worktree[]>;

  // Check if worktree path exists and is valid
  private validateWorktree(worktree: Worktree): boolean;
}
```

### New Module: `src/git/diff-generator.ts`

Create a diff generator service:

```typescript
export interface DiffOptions {
  context?: number; // Lines of context (default: 3)
  color?: boolean; // Colored output (default: true)
  stat?: boolean; // Show file statistics (default: true)
}

export interface DiffResult {
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  diff: string;
}

export class DiffGenerator {
  // Generate diff between worktree branch and base
  async generate(
    worktreePath: string,
    baseBranch: string,
    options?: DiffOptions,
  ): Promise<DiffResult>;

  // Format diff for display to user
  formatForUser(diff: DiffResult): string;
}
```

### New Module: `src/orchestrator/approval-flow.ts`

Create an approval flow handler:

```typescript
export interface ApprovalRequest {
  worktreeId: string;
  task: string;
  diff: DiffResult;
  agentSummary: string;
}

export interface ApprovalDecision {
  decision: 'merge' | 'cancel';
  comment?: string;
}

export class ApprovalFlow {
  // Show diff and prompt user for approval
  async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;

  // Display a formatted diff to the user
  private displayDiff(diff: DiffResult): void;

  // Prompt user with options
  private promptUser(): Promise<ApprovalDecision>;
}
```

### Modified: `src/orchestrator/orchestrator.ts`

Extend the orchestrator to integrate worktree isolation:

```typescript
import { WorktreeManager, Worktree } from '../git/worktree-manager.js';
import { ApprovalFlow } from './approval-flow.js';

export class Orchestrator {
  private worktreeManager: WorktreeManager;
  private approvalFlow: ApprovalFlow;
  private currentWorktree: Worktree | null = null;

  // Modified runTask to use worktree isolation
  async runTaskWithIsolation(task: string): Promise<string>;

  // Get current worktree path for agent execution
  getWorktreePath(): string | null;

  // Abort current worktree
  async abortWorktree(): Promise<void>;
}
```

## Implementation Requirements

### 0. Task Breaking
- Break down user query into smaller tasks
- Divide Tasks equally between agents
- Make git worktree for each agent
- Assign each agent a unique worktree





### 1. Worktree Manager

The `WorktreeManager` must:

- Use `git worktree add` to create new worktrees
- Create branches with pattern `{branchPrefix}{agentId}-{timestamp}`
- Ensure the base branch exists and is up-to-date
- Validate worktree paths to prevent path traversal
- Handle errors gracefully (missing git, invalid branches, etc.)

**Key functions:**

```typescript
async create(agentId: string): Promise<Worktree> {
  // 1. Check if we're in a git repository
  // 2. Verify base branch exists
  // 3. Generate unique branch name: agent-{id}-{timestamp}
  // 4. Create new branch from base
  // 5. Create worktree directory: {worktreeBasePath}/{branchName}
  // 6. Add worktree: git worktree add {path} {branch}
  // 7. Return Worktree object
}
```

### 2. File System Isolation

Modify existing tools to work within worktree context:

- **read_file.ts**: Resolve paths relative to worktree directory, not cwd
- **write_file.ts**: Resolve paths relative to worktree directory, not cwd
- **run_command**: Default cwd to worktree directory

Add a new environment variable or context that tools can access:

```typescript
// Set before agent runs in worktree
process.env.AGENT_WORKTREE_PATH = worktree.path;
```

### 3. Diff Generation

The diff generator should:

- Use `git diff baseBranch...HEAD` for changed files
- Use `git diff --stat` for summary
- Parse and format output for user display
- Handle binary files gracefully
- Show only relevant changes (ignore node_modules, etc.)

### 4. Approval Flow

The approval workflow:

1. Agent completes task in worktree
2. Generate diff between worktree and main
3. Display diff to user with summary (files changed, +/insertions, -/deletions)
4. Prompt user: `[M]erge to main`, `[C]ancel (discard changes)`, `[V]iew full diff`
5. If merge: checkout main, merge branch, cleanup worktree
6. If cancel: cleanup worktree (discard changes)

### 5. Clean Teardown

Handle cleanup in these scenarios:

- **After merge**: Remove worktree directory and branch
- **After cancel**: Remove worktree directory and branch (changes lost)
- **On error**: Attempt cleanup, log failures
- **On abort signal**: Clean up current worktree before exiting

## Tests to Write

### Unit Tests: `tests/git/worktree-manager.test.ts`

```typescript
describe('WorktreeManager', () => {
  describe('create()', () => {
    it('creates a new worktree with unique branch');
    it('fails if not in a git repository');
    it('fails if base branch does not exist');
    it('creates worktree in correct directory');
  });

  describe('generateDiff()', () => {
    it('generates diff for changed files');
    it('shows correct summary statistics');
    it('handles no changes gracefully');
  });

  describe('merge()', () => {
    it('merges branch to main successfully');
    it('handles merge conflicts');
  });

  describe('cleanup()', () => {
    it('removes worktree directory');
    it('removes git branch');
    it('handles missing files gracefully');
  });
});
```

### Integration Tests: `tests/git/worktree-isolation.test.ts`

```typescript
describe('Worktree Isolation', () => {
  it('two worktrees can exist simultaneously');
  it('changes in one worktree do not affect another');
  it('diff shows only worktree-specific changes');
  it('cleanup removes all worktree artifacts');
});
```

### Approval Flow Tests: `tests/orchestrator/approval-flow.test.ts`

```typescript
describe('ApprovalFlow', () => {
  it('displays formatted diff to user');
  it('returns merge decision when user approves');
  it('returns cancel decision when user declines');
  it('handles user abort gracefully');
});
```

## User Workflow

```
User: "Fix the bug in login"

Orchestrator:
1. Create worktree: agent-login-1234567890
   - Branch: agent-login-1234567890
   - Path: ./worktrees/agent-login-1234567890

2. Run agent in worktree context
   - Agent reads/writes to worktree directory
   - Tools resolve paths relative to worktree

3. Agent completes task
   - Call finish tool with summary

4. Generate diff
   - Compare agent-login-1234567890 to main
   - Show: "3 files changed, +15, -3"

5. User approval prompt:
```

=== Changes Summary ===
src/auth/login.ts | +10 -2
tests/login.test.ts| +5 -1

[M]erge to main [C]ancel [V]iew full diff

```

6a. User types 'm':
- git checkout main
- git merge agent-login-1234567890
- Cleanup worktree

6b. User types 'c':
- Cleanup worktree (changes discarded)
```

## Edge Cases to Handle

1. **No git repository**: Initialize git or show clear error
2. **Uncommitted changes in main**: Stash or show warning
3. **Merge conflicts**: Show conflict details, allow user to resolve or cancel
4. **Worktree already exists**: Use unique ID or clean up old one
5. **Agent crashes mid-task**: Clean up worktree on abort
6. **User closes terminal**: Register cleanup handlers
7. **Git not installed**: Show clear dependency requirement

## File Structure After Implementation

```
src/
├── git/
│   ├── worktree-manager.ts    # NEW
│   ├── diff-generator.ts      # NEW
│   └── index.ts               # NEW (export both)
├── orchestrator/
│   ├── orchestrator.ts        # MODIFIED
│   ├── approval-flow.ts       # NEW
│   └── index.ts               # MODIFIED (export approval flow)
├── tools/
│   ├── read_file.ts           # MODIFIED (support worktree path)
│   ├── write_file.ts          # MODIFIED (support worktree path)
│   └── ...
└── ...

tests/
├── git/
│   ├── worktree-manager.test.ts
│   ├── diff-generator.test.ts
│   └── worktree-isolation.test.ts
└── orchestrator/
    └── approval-flow.test.ts
```

## Exit Criteria Checklist

- [ ] Agent runs in its own git worktree branch
- [ ] File system isolation works (agents can't touch each other's files)
- [ ] Two worktrees can exist simultaneously without conflicts
- [ ] Diff is generated showing exactly what changed
- [ ] User sees diff and can approve/reject before merge
- [ ] Worktree is cleaned up after merge or cancellation
- [ ] All new code has tests
- [ ] Existing tests still pass
