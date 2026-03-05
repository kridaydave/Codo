import { readdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';

export const listDirectoryTool = {
  name: 'list_directory',
  description: 'List contents of a directory (files and subdirectories) non-recursively',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list (default: current directory)',
      },
    },
  },
};

export async function listDirectoryExecute(input: { path?: string }): Promise<string> {
  try {
    const sandboxDir = process.env.AGENT_WORKTREE_PATH || process.cwd();
    const basePath = process.env.AGENT_OPERATING_DIR || sandboxDir;
    const searchPath = input.path ? resolve(basePath, input.path) : basePath;

    const entries = await readdir(searchPath, { withFileTypes: true });
    
    const results = entries
      .filter(entry => {
        const name = entry.name;
        return !(name === 'node_modules' || name === '.git' || name === 'dist' || name.startsWith('.'));
      })
      .map(entry => {
        return entry.isDirectory() ? `${entry.name}/` : entry.name;
      })
      .sort();

    if (results.length === 0) {
      return 'No files found';
    }

    return results.join('\n');
  } catch (error) {
    return `Error listing directory: ${error}`;
  }
}
