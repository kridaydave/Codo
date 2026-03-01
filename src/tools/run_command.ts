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

export async function runCommandExecute(input: { 
  command: string; 
  cwd?: string;
  timeout?: number;
}): Promise<string> {
  try {
    const cwd = input.cwd || process.cwd();
    const timeout = input.timeout || 60000;
    
    const { stdout, stderr } = await execAsync(input.command, {
      cwd,
      timeout,
    });
    
    if (stderr) {
      return `stdout:\n${stdout}\nstderr:\n${stderr}`;
    }
    return stdout || 'Command executed successfully (no output)';
  } catch (error: any) {
    return `Error executing command: ${error.message}`;
  }
}
