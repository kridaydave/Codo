import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { resolve, normalize } from 'path';

const execAsync = promisify(exec);

export interface WorktreeConfig {
  baseBranch: string;
  worktreeBasePath: string;
  branchPrefix: string;
}

export interface Worktree {
  id: string;
  branch: string;
  path: string;
  rootPath: string;
  status: 'pending' | 'active' | 'merged' | 'aborted';
  createdAt: Date;
}

export interface DiffResult {
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  diff: string;
}

const DEFAULT_CONFIG: WorktreeConfig = {
  baseBranch: 'main',
  worktreeBasePath: './worktrees',
  branchPrefix: 'agent-',
};

export class WorktreeManager {
  private config: WorktreeConfig;
  private worktrees: Map<string, Worktree> = new Map();
  private repoRoot: string = process.cwd();
  private operatingDir: string = process.cwd();
  private mergeLock: Promise<void> = Promise.resolve();

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.operatingDir = process.cwd();
  }

  async initialize(): Promise<void> {
    this.operatingDir = process.cwd();

    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', {
        cwd: this.operatingDir,
      });
      this.repoRoot = stdout.trim();
    } catch {
      throw new Error('Not inside a git repository. Please initialize git first: git init');
    }

    try {
      await execAsync(`git rev-parse --verify ${this.config.baseBranch}`, {
        cwd: this.repoRoot,
      });
    } catch {
      const fallback = this.config.baseBranch === 'main' ? 'master' : 'main';
      try {
        await execAsync(`git rev-parse --verify ${fallback}`, {
          cwd: this.repoRoot,
        });
        this.config.baseBranch = fallback;
      } catch {
        throw new Error(
          `Base branch "${this.config.baseBranch}" not found. Ensure you have at least one commit on main or master.`,
        );
      }
    }

    try {
      await execAsync('git worktree prune', { cwd: this.repoRoot });
    } catch {
      // Non-fatal
    }
  }

  async create(agentId: string): Promise<Worktree> {
    const timestamp = Date.now();
    const branchName = `${this.config.branchPrefix}${agentId}-${timestamp}`;

    const worktreePath = resolve(this.operatingDir, this.config.worktreeBasePath, branchName);

    const normalizedBase = normalize(this.operatingDir);
    const normalizedPath = normalize(worktreePath);
    if (!normalizedPath.startsWith(normalizedBase)) {
      throw new Error('Invalid worktree path: path traversal detected.');
    }

    try {
      await execAsync(
        `git worktree add -b "${branchName}" "${worktreePath}" "${this.config.baseBranch}"`,
        { cwd: this.repoRoot },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create worktree: ${msg}`);
    }

    const worktree: Worktree = {
      id: `${agentId}-${timestamp}`,
      branch: branchName,
      path: worktreePath,
      rootPath: worktreePath,
      status: 'active',
      createdAt: new Date(),
    };

    this.worktrees.set(worktree.id, worktree);
    return worktree;
  }

  async generateDiff(worktree: Worktree): Promise<DiffResult> {
    try {
      await execAsync('git add -A', { cwd: worktree.rootPath });
      await execAsync('git diff --cached --quiet', { cwd: worktree.rootPath }).catch(async () => {
        await execAsync(`git commit -m "Agent changes for ${worktree.id}" --allow-empty`, {
          cwd: worktree.rootPath,
        });
      });
    } catch {
      // Ignore
    }

    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;

    try {
      const { stdout: statOutput } = await execAsync(
        `git diff --stat "${this.config.baseBranch}...${worktree.branch}"`,
        { cwd: worktree.rootPath },
      );

      const statMatch = statOutput.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
      );
      if (statMatch) {
        filesChanged = parseInt(statMatch[1] || '0', 10);
        insertions = parseInt(statMatch[2] || '0', 10);
        deletions = parseInt(statMatch[3] || '0', 10);
      }
    } catch {
      // No stat
    }

    let diff = '';
    try {
      const { stdout } = await execAsync(
        `git diff "${this.config.baseBranch}...${worktree.branch}" -- . ":(exclude)node_modules" ":(exclude).git"`,
        { cwd: worktree.rootPath },
      );
      diff = stdout;
    } catch {
      diff = '(no diff available)';
    }

    return {
      summary: { filesChanged, insertions, deletions },
      diff,
    };
  }

  /**
   * Dry-run merge to detect conflicts before the real merge.
   * Returns a list of conflicting file paths (empty if clean).
   */
  async checkConflicts(worktree: Worktree): Promise<{ hasConflicts: boolean; files: string[] }> {
    try {
      // Attempt a no-commit merge to see if there are conflicts
      await execAsync(
        `git merge --no-commit --no-ff "${worktree.branch}"`,
        { cwd: this.repoRoot },
      );
      // Clean merge — abort the uncommitted merge state
      await execAsync('git merge --abort', { cwd: this.repoRoot }).catch(() => { });
      return { hasConflicts: false, files: [] };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      // Extract conflicting file names from git output
      const conflictFiles: string[] = [];
      const lineMatches = msg.match(/CONFLICT \(.*?\): .*?(?:in |Merge conflict in )(.+)/g);
      if (lineMatches) {
        for (const line of lineMatches) {
          const fileMatch = line.match(/(?:in |Merge conflict in )(.+)$/);
          if (fileMatch) conflictFiles.push(fileMatch[1].trim());
        }
      }
      // Always abort so repo is clean for next try
      await execAsync('git merge --abort', { cwd: this.repoRoot }).catch(() => { });
      return { hasConflicts: true, files: conflictFiles };
    }
  }

  /**
   * Merge with sequential locking — prevents concurrent merges.
   * Queues behind any in-progress merge so only one runs at a time.
   */
  async merge(worktree: Worktree): Promise<void> {
    // Chain onto the merge lock so merges execute sequentially
    const doMerge = this.mergeLock.then(() => this._doMerge(worktree));
    this.mergeLock = doMerge.catch(() => { }); // keep chain alive even on failure
    return doMerge;
  }

  private async _doMerge(worktree: Worktree): Promise<void> {
    try {
      await execAsync('git add -A', { cwd: worktree.rootPath });
      await execAsync(`git commit -m "Final agent changes for ${worktree.id}" --allow-empty`, {
        cwd: worktree.rootPath,
      });
    } catch {
      // Nothing to commit
    }

    try {
      await execAsync(
        `git merge "${worktree.branch}" --no-ff -m "Merge agent work: ${worktree.id}"`,
        { cwd: this.repoRoot },
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('CONFLICT') || msg.includes('conflict')) {
        await execAsync('git merge --abort', { cwd: this.repoRoot }).catch(() => { });
        throw new Error(
          `Merge conflict detected. The merge has been aborted. Please resolve conflicts manually.\n${msg}`,
        );
      }
      throw new Error(`Merge failed: ${msg}`);
    }

    worktree.status = 'merged';
    await this.cleanup(worktree);
  }

  async abort(worktree: Worktree): Promise<void> {
    worktree.status = 'aborted';
    await this.cleanup(worktree);
  }

  async cleanup(worktree: Worktree): Promise<void> {
    try {
      await execAsync(`git worktree remove "${worktree.path}" --force`, {
        cwd: this.repoRoot,
      });
    } catch {
      if (existsSync(worktree.path)) {
        try {
          await rm(worktree.path, { recursive: true, force: true });
        } catch {
          // Best effort
        }
      }
    }

    try {
      await execAsync('git worktree prune', { cwd: this.repoRoot });
    } catch {
      // Non-fatal
    }

    try {
      await execAsync(`git branch -D "${worktree.branch}"`, {
        cwd: this.repoRoot,
      });
    } catch {
      // Branch may already be deleted
    }

    this.worktrees.delete(worktree.id);
  }

  async list(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  async cleanupAll(): Promise<void> {
    const worktrees = Array.from(this.worktrees.values());
    for (const wt of worktrees) {
      try {
        await this.cleanup(wt);
      } catch {
        // Best effort
      }
    }
  }

  getBaseBranch(): string {
    return this.config.baseBranch;
  }

  getRepoRoot(): string {
    return this.repoRoot;
  }
}
