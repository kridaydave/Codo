import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const runCommandTool = {
  name: 'run_command',
  description: 'Execute a shell command and return its output',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command (optional, defaults to current directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['command'],
  },
};

const DANGEROUS_PATTERNS = [
  /;/g,
  /\|/g,
  /&&/g,
  /\|\|/g,
  /`/g,
  /\$\(/g,
  />\s*\/dev\/null/g,
  /<\s*\$/g,
  /^\\s*rm\\s+-rf/i,
  /^\\s*mkfs/i,
  /^\\s*dd\\s+if=/i,
  /^\\s*>/i,
  /\\\\s*curl\\s+.*\\|\\s*sh/i,
  /\\\\s*wget\\s+.*\\|\\s*sh/i,
];

function sanitizeCommand(command: string): { valid: boolean; reason?: string } {
  const trimmed = command.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Command cannot be empty' };
  }

  if (trimmed.length > 1000) {
    return { valid: false, reason: 'Command exceeds maximum length of 1000 characters' };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: 'Command contains potentially dangerous characters or patterns',
      };
    }
  }

  const dangerousCommands = [
    'rm -rf',
    'mkfs',
    'dd',
    ':(){:|:&};:',
    'fork()',
    'curl.*\\|',
    'wget.*\\|',
    'sh -c',
    'bash -c',
    'python.*-c',
    'perl.*-e',
    'ruby.*-e',
    'node.*-e',
  ];

  for (const dangerous of dangerousCommands) {
    if (new RegExp(dangerous, 'i').test(trimmed)) {
      return { valid: false, reason: 'Command contains potentially dangerous command patterns' };
    }
  }

  return { valid: true };
}

export async function runCommandExecute(input: {
  command: string;
  cwd?: string;
  timeout?: number;
}): Promise<string> {
  const validation = sanitizeCommand(input.command);
  if (!validation.valid) {
    return `Error: ${validation.reason}`;
  }

  try {
    const cwd = input.cwd || process.env.AGENT_WORKTREE_PATH || process.cwd();
    const timeout = input.timeout || 60000;

    const { stdout, stderr } = await execAsync(input.command, {
      cwd,
      timeout,
    });

    if (stderr) {
      return `stdout:\n${stdout}\n\nWarnings (stderr):\n${stderr}`;
    }
    return stdout || 'Command executed successfully (no output)';
  } catch (error: any) {
    const exitCode = error.code || error.exitCode || 1;
    const stderr = error.stderr || '';
    if (stderr) {
      return `Error (exit code ${exitCode}):\n${error.message}\n\nstderr:\n${stderr}`;
    }
    return `Error (exit code ${exitCode}): ${error.message}`;
  }
}
