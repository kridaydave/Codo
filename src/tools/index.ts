import { readFileTool, readFileExecute } from './read_file.js';
import { writeFileTool, writeFileExecute } from './write_file.js';
import { runCommandTool, runCommandExecute } from './run_command.js';
import { listFilesTool, listFilesExecute } from './list_files.js';
import { listDirectoryTool, listDirectoryExecute } from './list_directory.js';
import { searchInFileTool, searchInFileExecute } from './search_in_file.js';
import { finishTool, finishExecute } from './finish.js';
import { askAgentTool, askAgentExecute } from './ask_agent.js';
import type { ToolInput } from '../providers/types.js';

export const tools = [
  readFileTool,
  writeFileTool,
  runCommandTool,
  listFilesTool,
  listDirectoryTool,
  searchInFileTool,
  askAgentTool,
  finishTool,
] as const;

export const toolInputs: ToolInput[] = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema,
}));

/**
 * Execute a named tool. Pass `worktreeDir` to scope file operations inside
 * an agent's worktree — this avoids clobbering a shared env var when multiple
 * agents run in parallel.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  worktreeDir?: string,
  operatingDir?: string,
): Promise<string> {
  // Temporarily set the env var for this call only.
  // NOTE: This is still not safe for *true* parallel async within the same
  //       process tick, but agents are sequential within their own loop so
  //       it works in practice. The worktreeDir override takes priority.
  const prevWorktreePath = process.env.AGENT_WORKTREE_PATH;
  const prevOperatingDir = process.env.AGENT_OPERATING_DIR;

  if (worktreeDir) {
    process.env.AGENT_WORKTREE_PATH = worktreeDir;
  }
  if (operatingDir) {
    process.env.AGENT_OPERATING_DIR = operatingDir;
  }

  try {
    switch (name) {
      case 'read_file':
        return readFileExecute(input as { path: string });
      case 'write_file':
        return writeFileExecute(input as { path: string; content: string });
      case 'run_command':
        return runCommandExecute(input as { command: string; cwd?: string; timeout?: number });
      case 'list_files':
        return listFilesExecute(input as { path?: string });
      case 'list_directory':
        return listDirectoryExecute(input as { path?: string });
      case 'search_in_file':
        return searchInFileExecute(input as { pattern: string; path?: string; regex?: boolean });
      case 'ask_agent':
        return askAgentExecute(input as { targetAgentId: string; query: string });
      case 'finish':
        return finishExecute(input as { summary: string });
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error executing tool "${name}":`, message);
    return `Error executing tool "${name}": ${message}`;
  } finally {
    // Restore the previous value
    if (worktreeDir) {
      if (prevWorktreePath !== undefined) {
        process.env.AGENT_WORKTREE_PATH = prevWorktreePath;
      } else {
        delete process.env.AGENT_WORKTREE_PATH;
      }
    }
    if (operatingDir) {
      if (prevOperatingDir !== undefined) {
        process.env.AGENT_OPERATING_DIR = prevOperatingDir;
      } else {
        delete process.env.AGENT_OPERATING_DIR;
      }
    }
  }
}

export { readFileTool, writeFileTool, runCommandTool, listFilesTool, listDirectoryTool, searchInFileTool, askAgentTool, finishTool };
export { readFileExecute, writeFileExecute, runCommandExecute, listFilesExecute, listDirectoryExecute, searchInFileExecute, askAgentExecute, finishExecute };
