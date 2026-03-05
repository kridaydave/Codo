import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\./,
  /\.git[\/\\]/,
  /[\/\\]\.git$/,
  /id_rsa/,
  /id_dsa/,
  /id_ecdsa/,
  /id_ed25519/,
  /\.ssh[\/\\]/,
  /[\/\\]\.ssh$/,
  /\.aws[\/\\]/,
  /[\/\\]\.aws$/,
  /[\/\\]node_modules[\/\\]/,
];

const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
  '.tiff',
  '.tif',
];

function isSensitivePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}

function isImageFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
}

export const readFileTool = {
  name: 'read_file',
  description: 'Read the contents of a file',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
    },
    required: ['path'],
  },
};

export async function readFileExecute(input: { path: string }): Promise<string> {
  try {
    const sandboxDir = process.env.AGENT_WORKTREE_PATH || process.cwd();
    const workingDir = process.env.AGENT_OPERATING_DIR || sandboxDir;

    const resolvedPath = resolve(workingDir, input.path);
    const normalizedResolved = resolvedPath.replace(/\\/g, '/');
    const normalizedSandbox = sandboxDir.replace(/\\/g, '/');

    if (!normalizedResolved.startsWith(normalizedSandbox + '/')) {
      return 'Error: Access denied. Path traversal detected. File must be within the project sandbox.';
    }

    if (isSensitivePath(resolvedPath)) {
      return 'Error: Access denied. Cannot read sensitive files (.env, .git, .ssh, etc.).';
    }

    if (isImageFile(resolvedPath)) {
      return 'Error: Cannot read image files. This AI model does not support image input. Please describe what you need from the image instead of trying to read it directly.';
    }

    const content = await readFile(resolvedPath, 'utf-8');
    return content;
  } catch (error) {
    return `Error reading file: ${error}`;
  }
}
