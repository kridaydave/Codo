import type { DiffResult } from './worktree-manager.js';

export interface DiffOptions {
    context?: number;
    color?: boolean;
    stat?: boolean;
}

export class DiffGenerator {
    /**
     * Format a DiffResult for user-friendly display in the terminal.
     */
    formatForUser(diff: DiffResult): string {
        const lines: string[] = [];

        lines.push('');
        lines.push('═══ Changes Summary ═══════════════════════════════');
        lines.push('');

        if (diff.summary.filesChanged === 0) {
            lines.push('  No changes detected.');
        } else {
            lines.push(
                `  ${diff.summary.filesChanged} file${diff.summary.filesChanged !== 1 ? 's' : ''} changed`,
            );
            if (diff.summary.insertions > 0) {
                lines.push(`  +${diff.summary.insertions} insertion${diff.summary.insertions !== 1 ? 's' : ''}`);
            }
            if (diff.summary.deletions > 0) {
                lines.push(`  -${diff.summary.deletions} deletion${diff.summary.deletions !== 1 ? 's' : ''}`);
            }
        }

        lines.push('');
        lines.push('═══════════════════════════════════════════════════');

        return lines.join('\n');
    }

    /**
     * Format the full diff text, truncating if too long.
     */
    formatFullDiff(diff: DiffResult, maxLines: number = 200): string {
        if (!diff.diff || diff.diff === '(no diff available)') {
            return 'No diff content available.';
        }

        const diffLines = diff.diff.split('\n');
        if (diffLines.length > maxLines) {
            return (
                diffLines.slice(0, maxLines).join('\n') +
                `\n\n... (${diffLines.length - maxLines} more lines truncated)`
            );
        }

        return diff.diff;
    }
}
