import { promises as fs } from 'fs';
import { join } from 'path';

export interface HistoryEntry {
    taskId: string;
    task: string;
    timestamp: number;
    status: 'done' | 'error';
    duration?: number;
    provider: string;
    model: string;
}

const HISTORY_FILE = '.codo/history.json';

export class HistoryManager {
    private baseDir: string;
    private historyPath: string;

    constructor(cwd?: string) {
        this.baseDir = join(cwd ?? process.cwd(), '.codo');
        this.historyPath = join(this.baseDir, 'history.json');
    }

    async saveEntry(entry: HistoryEntry): Promise<void> {
        const history = await this.loadHistory();
        history.unshift(entry);
        // Keep only last 20 entries
        const limitedHistory = history.slice(0, 20);
        
        await fs.mkdir(this.baseDir, { recursive: true });
        await fs.writeFile(
            this.historyPath,
            JSON.stringify(limitedHistory, null, 2),
            'utf-8',
        );
    }

    async loadHistory(): Promise<HistoryEntry[]> {
        try {
            const raw = await fs.readFile(this.historyPath, 'utf-8');
            return JSON.parse(raw) as HistoryEntry[];
        } catch {
            return [];
        }
    }

    async clearHistory(): Promise<void> {
        try {
            await fs.unlink(this.historyPath);
        } catch {
            // Already gone
        }
    }
}

export const historyManager = new HistoryManager();
