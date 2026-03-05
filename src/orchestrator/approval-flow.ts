import { EventEmitter } from 'events';
import type { DiffResult } from '../git/index.js';

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

/**
 * ApprovalFlow manages the user approval process for worktree changes.
 * It emits events to communicate with the UI and waits for user decisions.
 */
export class ApprovalFlow extends EventEmitter {
    private pendingResolve: ((decision: ApprovalDecision) => void) | null = null;

    /**
     * Request approval from the user. Emits 'approval:request' event
     * and returns a promise that resolves when the user makes a decision.
     */
    async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
        return new Promise<ApprovalDecision>((resolve) => {
            this.pendingResolve = resolve;
            this.emit('approval:request', request);
        });
    }

    /**
     * Submit a decision (called by the UI when user makes a choice).
     */
    submitDecision(decision: ApprovalDecision): void {
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            this.emit('approval:complete', decision);
            resolve(decision);
        }
    }

    /**
     * Check if there is a pending approval request.
     */
    hasPendingApproval(): boolean {
        return this.pendingResolve !== null;
    }

    /**
     * Cancel any pending approval (e.g., on abort).
     */
    cancelPending(): void {
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            resolve({ decision: 'cancel', comment: 'Aborted by user' });
        }
    }
}
