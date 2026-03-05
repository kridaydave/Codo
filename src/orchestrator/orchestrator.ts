import { EventEmitter } from 'events';
import { BaseAgent } from '../agents/BaseAgent.js';
import { createAgent, Agent } from '../core/agent.js';
import { CheckpointManager } from '../core/checkpoint-manager.js';
import { WorktreeManager, DiffGenerator } from '../git/index.js';
import { ApprovalFlow } from './approval-flow.js';
import { decomposeTasks } from './task-decomposer.js';
import { taskBus, createAgentCard, createTaskId } from '../a2a/index.js';
import { A2ABus } from '../a2a/bus.js';
import { historyManager } from '../core/history-manager.js';
import { TokenOptimizer } from './token-optimizer.js';
import type { Worktree, DiffResult } from '../git/index.js';
import type { ProviderType } from '../providers/index.js';

export interface AgentState {
  id: string;
  model: string;
  status: 'idle' | 'running' | 'stuck' | 'done' | 'error' | 'aborted' | 'awaiting_approval';
  currentAction: string;
  startTime?: number;
  endTime?: number;
  subtask?: string;
}

export class Orchestrator extends BaseAgent {
  // Agent pool
  private agents: Map<string, Agent> = new Map();
  private agentStates: Map<string, AgentState> = new Map();
  private abortController: AbortController | null = null;

  // Primary agent state (backward compat)
  public agentState: AgentState = {
    id: 'agent-1',
    model: 'anthropic',
    status: 'idle',
    currentAction: 'Waiting for tasks...',
  };
  public lastTaskResult: string | null = null;
  public lastTaskError: string | null = null;

  // Git isolation
  private worktreeManager: WorktreeManager;
  private diffGenerator: DiffGenerator;
  public approvalFlow: ApprovalFlow;
  private activeWorktrees: Map<string, Worktree> = new Map();
  private worktreeInitialized: boolean = false;

  private currentProvider: ProviderType = 'anthropic';
  private maxAgents: number = 4;

  // Checkpointing
  private checkpointManager: CheckpointManager;
  private currentTaskId: string | null = null;

  constructor() {
    super({
      agentId: 'orchestrator',
      name: 'Orchestrator',
      description: 'Coordinates tasks',
      skills: [],
      endpoint: 'agent://orchestrator',
      version: '1.0'
    });
    this.worktreeManager = new WorktreeManager();
    this.diffGenerator = new DiffGenerator();
    this.approvalFlow = new ApprovalFlow();
    this.checkpointManager = new CheckpointManager();

    // Forward A2A task bus events to UI (a2a:bus only — a2a:delegation is emitted
    // explicitly in runTask with the correct { from, to, subtasks } shape)
    taskBus.on('bus', (evt) => {
      this.emit('a2a:bus', evt);
    });

    process.on('SIGINT', () => this.cleanupOnExit());
    process.on('SIGTERM', () => this.cleanupOnExit());
    process.on('exit', () => this.cleanupOnExit());

    // Intercept A2A broadcast to trigger handoffs between sequential agents
    A2ABus.on('broadcast', (envelope) => {
      if (envelope.params.from === this.agentId) return;

      if (envelope.method === 'task_done' && envelope.params.from.startsWith('agent-')) {
        const fromId = envelope.params.from;
        const match = fromId.match(/agent-(\d+)/);
        if (match) {
          const nextIdx = parseInt(match[1], 10) + 1;
          const nextAgentId = `agent-${nextIdx}`;

          // If the next agent exists in our subtask pool, forward the context and trigger it
          if (this.agents.has(nextAgentId)) {
            const payload = envelope.params.payload;
            const contextId = envelope.params.contextId;

            this.sendMessage(nextAgentId, 'context_share', payload, contextId);
            this.sendMessage(nextAgentId, 'task_done', { ready: true, contextId }, contextId);
          }
        }
      }
    });
  }

  onContextReady(contextId: string, payload: Record<string, unknown>): void {
    // Orchestrator handles A2A via the generic broadcast listener above.
  }  // Let's rely on standard events if we can. Actually Orchestrator has all agents in this.agents map
  // When 'agent1' emits 'task_done', it goes to broadcast or to 'orchestrator'.
  // We can just add another listener in constructor:
  // Note: For now we'll handle the requirement directly in the next chunk.


  async initialize(provider: ProviderType = 'anthropic', maxAgents: number = 4) {
    this.currentProvider = provider;
    this.maxAgents = Math.max(1, Math.min(maxAgents, 8));
    this.agentState.model = provider;

    try {
      // Create the primary agent
      const primary = await createAgent({ provider, emitter: this });
      this.agents.set('agent-1', primary);

      const primaryState: AgentState = {
        id: 'agent-1',
        model: provider,
        status: 'idle',
        currentAction: 'Waiting for tasks...',
      };
      this.agentStates.set('agent-1', primaryState);
      this.agentState = primaryState;

      // Register on A2A task bus
      taskBus.registerAgent(createAgentCard('agent-1', provider));

      // Git worktree init (non-fatal)
      try {
        await this.worktreeManager.initialize();
        this.worktreeInitialized = true;
      } catch {
        this.worktreeInitialized = false;
      }

      this.emitAllStates();

      // Check for incomplete checkpoints from a previous crash
      try {
        const incomplete = await this.checkpointManager.loadLatest();
        if (incomplete) {
          this.emit('checkpoint:found', {
            taskId: incomplete.taskId,
            task: incomplete.originalTask,
            agentCount: incomplete.agents.length,
            updatedAt: incomplete.updatedAt,
          });
        }
      } catch {
        // Non-fatal — no checkpoint recovery available
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.agentState.status = 'error';
      this.agentState.currentAction = `Init failed: ${msg}`;
      this.emitAllStates();
      throw new Error(`Failed to initialize: ${msg}`);
    }
  }

  private emitAllStates() {
    const states = Array.from(this.agentStates.values());
    this.emit('agent:state', this.agentState);
    this.emit('agents:state', states);
  }

  private updateAgentState(agentId: string, updates: Partial<AgentState>) {
    const current = this.agentStates.get(agentId) ?? {
      id: agentId,
      model: this.currentProvider,
      status: 'idle' as const,
      currentAction: '',
    };
    const updated = { ...current, ...updates };
    this.agentStates.set(agentId, updated);
    if (agentId === 'agent-1') this.agentState = updated;
    this.emitAllStates();
  }

  /** Backward-compatibility shim used by old UI code. */
  public updateState(updates: Partial<AgentState>) {
    this.updateAgentState('agent-1', updates);
  }

  // ─────────────────────────────────────────────────────────────
  // Main task entry point
  // ─────────────────────────────────────────────────────────────

  async runTask(task: string) {
    const primaryAgent = this.agents.get('agent-1');
    if (!primaryAgent) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    primaryAgent.reset();

    this.abortController = new AbortController();
    this.lastTaskResult = null;
    this.lastTaskError = null;

    try {
      this.updateAgentState('agent-1', {
        status: 'running',
        currentAction: 'Analyzing task...',
        startTime: Date.now(),
      });

      // Always attempt decomposition
      const decomposition = await decomposeTasks(task, this.currentProvider, this.maxAgents);
      const { subtasks, method } = decomposition;

      if (subtasks.length > 1) {
        this.emit(
          'agent:action',
          `[A2A] Decomposed into ${subtasks.length} subtasks via ${method} → spawning ${subtasks.length} agents`,
        );

        // Emit delegation event for A2A log
        const agentIds = subtasks.map((_, i) => `agent-${i + 1}`);
        this.emit('a2a:delegation', {
          from: 'orchestrator',
          to: agentIds,
          subtasks,
          method,
        });

        return this._runMultiAgent(task, subtasks);
      }

      return this._runSingleAgent('agent-1', subtasks[0]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        this.updateAgentState('agent-1', {
          status: 'aborted',
          currentAction: 'Aborted',
          endTime: Date.now(),
        });
        return;
      }
      this.lastTaskError = msg;
      this.updateAgentState('agent-1', {
        status: 'error',
        currentAction: `Error: ${msg}`,
        endTime: Date.now(),
      });
      throw err;
    } finally {
      const duration = this.agentState.startTime ? Date.now() - this.agentState.startTime : undefined;
      await historyManager.saveEntry({
        taskId: this.currentTaskId || `task-${Date.now()}`,
        task,
        timestamp: Date.now(),
        status: this.lastTaskError ? 'error' : 'done',
        duration,
        provider: this.currentProvider,
        model: this.agentState.model,
      }).catch(() => { });

      this.abortController = null;
      // Mark checkpoint as completed on success or failure
      if (this.currentTaskId) {
        await this.checkpointManager.complete(this.currentTaskId).catch(() => { });
        this.currentTaskId = null;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Single agent
  // ─────────────────────────────────────────────────────────────

  private async _runSingleAgent(agentId: string, task: string): Promise<string | undefined> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    return this.worktreeInitialized
      ? this._runWithWorktree(agentId, agent, task)
      : this._runDirect(agentId, agent, task);
  }

  // ─────────────────────────────────────────────────────────────
  // Multi-agent parallel execution via A2A task bus
  // ─────────────────────────────────────────────────────────────

  private async _runMultiAgent(
    originalTask: string,
    subtasks: string[],
  ): Promise<string | undefined> {
    this.updateAgentState('agent-1', {
      status: 'running',
      currentAction: 'Optimizing task context...',
    });

    const optimizedSubtasks = await Promise.all(
      subtasks.map((subtask) =>
        TokenOptimizer.optimizeDelegation(originalTask, subtask, this.currentProvider)
      )
    );

    const agentIds: string[] = [];

    // Broadcast the full global plan so that agents are aware of each other's tasks
    this.broadcastMessage('context_share', {
      globalTask: originalTask,
      totalAgents: subtasks.length,
      plan: subtasks.map((task, i) => ({ agent: `agent-${i + 1}`, task }))
    });

    for (let i = 0; i < subtasks.length; i++) {
      const agentId = `agent-${i + 1}`;
      agentIds.push(agentId);

      // Always create a fresh, tagged emitter for every agent in multi-agent mode
      // (including agent-1 — it normally uses the orchestrator, but that causes issues here)
      const agentEmitter = new EventEmitter();
      agentEmitter.on('agent:action', (a: string) => {
        this.emit('agent:action', `[${agentId}] ${a}`);
        this.updateAgentState(agentId, { currentAction: a });
      });
      (['agent:tool_call', 'agent:tool_result', 'agent:usage'] as const).forEach((ev) => {
        agentEmitter.on(ev, (d: unknown) => this.emit(ev, d));
      });

      const agent = await createAgent({ provider: this.currentProvider, emitter: agentEmitter, role: 'sub-agent' });
      this.agents.set(agentId, agent);
      taskBus.registerAgent(createAgentCard(agentId, this.currentProvider));

      // Set initial state
      this.agentStates.set(agentId, {
        id: agentId,
        model: this.currentProvider,
        status: 'idle',
        currentAction: 'Queued...',
        subtask: subtasks[i],
      });
    }

    this.emitAllStates();

    // Submit tasks to A2A bus
    const taskIds = subtasks.map((subtask, i) => {
      const taskId = createTaskId(agentIds[i]);
      taskBus.submitTask({
        id: taskId,
        instruction: subtask,
        assignedTo: agentIds[i],
        state: 'submitted',
        submittedAt: Date.now(),
      });
      return taskId;
    });

    // Stagger agent starts by 300ms each to avoid hitting rate limits simultaneously
    const STAGGER_MS = 300;
    const results = await Promise.allSettled(
      subtasks.map((subtask, i) => {
        const agentId = agentIds[i];
        const taskId = taskIds[i];

        return new Promise<string | undefined>((resolve, reject) => {
          setTimeout(() => {
            taskBus.reportWorking(taskId, agentId, 'Starting...');
            this._runSingleAgent(agentId, optimizedSubtasks[i])
              .then((res) => {
                taskBus.reportCompleted(taskId, agentId, res ?? '');
                resolve(res);
              })
              .catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                taskBus.reportFailed(taskId, agentId, msg);
                reject(err);
              });
          }, i * STAGGER_MS);
        });
      }),
    );

    const successes: string[] = [];
    const failures: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        successes.push(`✓ ${agentIds[i]}: ${r.value ?? 'done'}`);
      } else {
        failures.push(`✗ ${agentIds[i]}: ${r.reason}`);
      }
    });

    const combined = [...successes, ...failures].join('\n\n');
    this.lastTaskResult = combined;

    this.updateAgentState('agent-1', {
      status: failures.length === subtasks.length ? 'error' : 'done',
      currentAction:
        failures.length === 0
          ? `All ${subtasks.length} agents completed`
          : `${failures.length} agent(s) failed`,
      endTime: Date.now(),
    });

    taskBus.clearCompleted();
    return combined;
  }

  // ─────────────────────────────────────────────────────────────
  // Direct execution (no worktree)
  // ─────────────────────────────────────────────────────────────

  private async _runDirect(
    agentId: string,
    agent: Agent,
    task: string,
  ): Promise<string | undefined> {
    this.updateAgentState(agentId, {
      status: 'running',
      currentAction: 'Running...',
      startTime: Date.now(),
    });
    try {
      const result = await agent.run(task, this.abortController?.signal);

      // Save checkpoint after successful direct run
      await this._saveCheckpoint(task, agentId, agent).catch(() => { });

      this.updateAgentState(agentId, {
        status: 'done',
        currentAction: 'Done ✓',
        endTime: Date.now(),
      });
      if (agentId === 'agent-1') this.lastTaskResult = result;
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        this.updateAgentState(agentId, {
          status: 'aborted',
          currentAction: 'Aborted',
          endTime: Date.now(),
        });
        return;
      }
      this.updateAgentState(agentId, {
        status: 'error',
        currentAction: `Error: ${msg}`,
        endTime: Date.now(),
      });
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Worktree-isolated execution
  // ─────────────────────────────────────────────────────────────

  private async _runWithWorktree(
    agentId: string,
    agent: Agent,
    task: string,
  ): Promise<string | undefined> {
    this.updateAgentState(agentId, {
      status: 'running',
      currentAction: 'Creating worktree...',
      startTime: Date.now(),
    });

    let worktree: Worktree | null = null;

    try {
      worktree = await this.worktreeManager.create(agentId);
      this.activeWorktrees.set(agentId, worktree);
      this.emit('agent:action', `[${agentId}] Worktree → ${worktree.branch}`);

      // Use public method instead of private property hack
      agent.setWorktreeDir(worktree.path, worktree.operatingPath);

      this.updateAgentState(agentId, { status: 'running', currentAction: 'Running task...' });
      const result = await agent.run(task, this.abortController?.signal);

      this.updateAgentState(agentId, { status: 'running', currentAction: 'Generating diff...' });
      const diff = await this.worktreeManager.generateDiff(worktree);

      if (diff.summary.filesChanged === 0) {
        await this.worktreeManager.abort(worktree);
        this.activeWorktrees.delete(agentId);
        this.updateAgentState(agentId, {
          status: 'done',
          currentAction: 'Done ✓ (no changes)',
          endTime: Date.now(),
        });
        if (agentId === 'agent-1') this.lastTaskResult = result;
        return result;
      }

      this.updateAgentState(agentId, {
        status: 'awaiting_approval',
        currentAction: 'Awaiting approval...',
      });
      this.emit('agent:action', this.diffGenerator.formatForUser(diff));

      const decision = await this.approvalFlow.requestApproval({
        worktreeId: worktree.id,
        task,
        diff,
        agentSummary: result ?? 'Task completed',
      });

      if (decision.decision === 'merge') {
        // Check for conflicts before attempting the real merge
        this.updateAgentState(agentId, { status: 'running', currentAction: 'Checking for conflicts...' });
        const conflicts = await this.worktreeManager.checkConflicts(worktree);

        if (conflicts.hasConflicts) {
          const conflictMsg = conflicts.files.length > 0
            ? `Conflict in: ${conflicts.files.join(', ')}`
            : 'Merge conflict detected';
          this.emit('agent:action', `[${agentId}] ⚠ ${conflictMsg} — skipping merge to protect codebase`);
          this.updateAgentState(agentId, {
            status: 'error',
            currentAction: `Conflict: ${conflictMsg}`,
            endTime: Date.now(),
          });
          // Don't abort the worktree — keep the branch alive so user can resolve manually
          return `Merge skipped due to conflicts. Branch "${worktree.branch}" is preserved for manual resolution.\n${conflictMsg}`;
        }

        this.updateAgentState(agentId, { status: 'running', currentAction: 'Merging...' });
        await this.worktreeManager.merge(worktree);
        this.updateAgentState(agentId, {
          status: 'done',
          currentAction: 'Merged ✓',
          endTime: Date.now(),
        });
      } else {
        await this.worktreeManager.abort(worktree);
        this.updateAgentState(agentId, {
          status: 'done',
          currentAction: 'Discarded',
          endTime: Date.now(),
        });
        return 'Changes discarded.';
      }

      this.activeWorktrees.delete(agentId);
      if (agentId === 'agent-1') this.lastTaskResult = result;
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (worktree) {
        await this.worktreeManager.abort(worktree).catch(() => { });
        this.activeWorktrees.delete(agentId);
      }
      if (err instanceof Error && err.name === 'AbortError') {
        this.updateAgentState(agentId, {
          status: 'aborted',
          currentAction: 'Aborted',
          endTime: Date.now(),
        });
        return;
      }
      this.updateAgentState(agentId, {
        status: 'error',
        currentAction: `Error: ${msg}`,
        endTime: Date.now(),
      });
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  abort() {
    this.approvalFlow.cancelPending();
    if (this.abortController) {
      this.abortController.abort();
    } else {
      this.updateAgentState('agent-1', {
        status: 'aborted',
        currentAction: 'Aborted',
        endTime: Date.now(),
      });
    }
  }

  getAllAgentStates(): AgentState[] {
    return Array.from(this.agentStates.values());
  }

  async getCurrentDiff(): Promise<DiffResult | null> {
    const wt = this.activeWorktrees.get('agent-1');
    return wt ? this.worktreeManager.generateDiff(wt) : null;
  }

  /** Resume a task from a saved checkpoint. */
  async resumeFromCheckpoint(taskId: string): Promise<string | undefined> {
    const checkpoint = await this.checkpointManager.load(taskId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${taskId} not found`);
    }

    this.currentTaskId = taskId;
    this.abortController = new AbortController();
    this.lastTaskResult = null;
    this.lastTaskError = null;

    // Restore the primary agent from checkpoint
    const agentCp = checkpoint.agents[0];
    if (!agentCp) {
      throw new Error('Checkpoint has no agent state');
    }

    this.emit('agent:action', `Resuming task from checkpoint (${new Date(checkpoint.updatedAt).toLocaleTimeString()})...`);

    const agent = this.agents.get('agent-1');
    if (!agent) {
      throw new Error('Primary agent not initialized');
    }

    this.updateAgentState('agent-1', {
      status: 'running',
      currentAction: 'Resuming from checkpoint...',
      startTime: Date.now(),
    });

    try {
      // Re-run with the original task text — the agent starts fresh but
      // the user sees continuity. The restored messages are lost (can't
      // inject mid-conversation without provider support), but the
      // worktree branch still exists on disk with all prior file changes.
      const result = await agent.run(
        `[RESUMED] Continue the following task from where you left off. ` +
        `Previous progress may be visible in the working directory. ` +
        `Original task: ${checkpoint.originalTask}`,
        this.abortController.signal,
      );

      await this.checkpointManager.complete(taskId);
      this.currentTaskId = null;

      this.updateAgentState('agent-1', {
        status: 'done',
        currentAction: 'Resumed & done ✓',
        endTime: Date.now(),
      });
      this.lastTaskResult = result;
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        this.updateAgentState('agent-1', { status: 'aborted', currentAction: 'Aborted', endTime: Date.now() });
        return;
      }
      this.lastTaskError = msg;
      this.updateAgentState('agent-1', { status: 'error', currentAction: `Error: ${msg}`, endTime: Date.now() });
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  /** Dismiss (discard) an incomplete checkpoint without resuming. */
  async dismissCheckpoint(taskId: string): Promise<void> {
    await this.checkpointManager.complete(taskId);
    await this.checkpointManager.cleanup();
    this.emit('agent:action', 'Previous checkpoint dismissed.');
  }

  private cleanupOnExit() {
    // Attempt to save a crash-recovery checkpoint
    if (this.currentTaskId) {
      const agent = this.agents.get('agent-1');
      if (agent) {
        this._saveCheckpoint('', 'agent-1', agent).catch(() => { });
      }
    }
    for (const wt of this.activeWorktrees.values()) {
      this.worktreeManager.abort(wt).catch(() => { });
    }
  }

  /** Save a checkpoint with current agent state. */
  private async _saveCheckpoint(task: string, agentId: string, agent: Agent): Promise<void> {
    if (!this.currentTaskId) {
      this.currentTaskId = `task-${Date.now()}`;
    }

    const worktree = this.activeWorktrees.get(agentId);
    const state = this.agentStates.get(agentId);

    await this.checkpointManager.save({
      taskId: this.currentTaskId,
      createdAt: state?.startTime ?? Date.now(),
      updatedAt: Date.now(),
      provider: this.currentProvider,
      originalTask: task,
      agents: [{
        id: agentId,
        messages: agent.getMessages(),
        worktreeId: worktree?.id,
        worktreeBranch: worktree?.branch,
        worktreePath: worktree?.path,
        status: state?.status ?? 'running',
        subtask: task,
        iteration: 0,
      }],
      taskBusTasks: taskBus.getTasks(),
      completed: false,
    });
  }
}

export const orchestrator = new Orchestrator();
