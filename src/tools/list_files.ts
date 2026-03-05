import { readdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';

export const listFilesTool = {
  name: 'list_files',
  description: 'List all files in a directory recursively',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list files from (default: current directory)',
      },
    },
  },
};

async function getAllFiles(dirPath: string, basePath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dirPath);

    for (const entry of entries) {
      // Skip common ignored directories
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry.startsWith('.')) {
        continue;
      }

      const fullPath = join(dirPath, entry);
      const relativePath = relative(basePath, fullPath);

      try {
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          const subFiles = await getAllFiles(fullPath, basePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch (error) {
    return [`Error listing files: ${error}`];
  }

  return files;
}

export async function listFilesExecute(input: { path?: string }): Promise<string> {
  try {
    const sandboxDir = process.env.AGENT_WORKTREE_PATH || process.cwd();
    const basePath = process.env.AGENT_OPERATING_DIR || sandboxDir;
    const searchPath = input.path ? resolve(basePath, input.path) : basePath;

    const files = await getAllFiles(searchPath, basePath);

    if (files.length === 0) {
      return 'No files found';
    }

    return files.sort().join('\n');
  } catch (error) {
    return `Error listing files: ${error}`;
  }
}
