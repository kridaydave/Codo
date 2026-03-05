import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';

export const writeFileTool = {
  name: 'write_file',
  description: 'Write content to a file. Creates directories if they do not exist.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  },
};

export async function writeFileExecute(input: { path: string; content: string }): Promise<string> {
  try {
    const sandboxDir = process.env.AGENT_WORKTREE_PATH || process.cwd();
    const workingDir = process.env.AGENT_OPERATING_DIR || sandboxDir;

    const resolvedPath = resolve(workingDir, input.path);
    const normalizedResolved = resolvedPath.replace(/\\/g, '/').toLowerCase();
    const normalizedSandbox = sandboxDir.replace(/\\/g, '/').toLowerCase();

    if (
      !normalizedResolved.startsWith(normalizedSandbox + '/') &&
      normalizedResolved !== normalizedSandbox
    ) {
      return `Error: Path traversal detected. Writing outside the project sandbox is not permitted.`;
    }

    const sensitivePaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/etc/sudoers',
      '/windows/system32',
      '/windows/syswow64',
      '/program files',
      '/programdata',
    ];
    for (const sensitive of sensitivePaths) {
      if (normalizedResolved.includes(sensitive)) {
        return `Error: Cannot write to sensitive system path: ${input.path}`;
      }
    }

    const dir = dirname(resolvedPath);

    await mkdir(dir, { recursive: true });
    await writeFile(resolvedPath, input.content, 'utf-8');

    return `Successfully wrote to ${input.path}`;
  } catch (error) {
    return `Error writing file: ${error}`;
  }
}
