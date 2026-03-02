import { readFileTool, readFileExecute } from './read_file.js';
import { writeFileTool, writeFileExecute } from './write_file.js';
import { runCommandTool, runCommandExecute } from './run_command.js';
import { listFilesTool, listFilesExecute } from './list_files.js';
import { searchInFileTool, searchInFileExecute } from './search_in_file.js';
import { finishTool, finishExecute } from './finish.js';
import type { ToolInput } from '../providers/types.js';

export const tools = [
  readFileTool,
  writeFileTool,
  runCommandTool,
  listFilesTool,
  searchInFileTool,
  finishTool,
] as const;

export const toolInputs: ToolInput[] = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.input_schema,
}));

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'read_file':
      return readFileExecute(input as { path: string });
    case 'write_file':
      return writeFileExecute(input as { path: string; content: string });
    case 'run_command':
      return runCommandExecute(input as { command: string; cwd?: string; timeout?: number });
    case 'list_files':
      return listFilesExecute(input as { path?: string });
    case 'search_in_file':
      return searchInFileExecute(input as { pattern: string; path?: string; regex?: boolean });
    case 'finish':
      return finishExecute(input as { summary: string });
    default:
      return `Unknown tool: ${name}`;
  }
}

export { readFileTool, writeFileTool, runCommandTool, listFilesTool, searchInFileTool, finishTool };
