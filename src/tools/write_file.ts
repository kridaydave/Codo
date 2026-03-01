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
    const resolvedPath = resolve(process.cwd(), input.path);
    const dir = dirname(resolvedPath);
    
    await mkdir(dir, { recursive: true });
    await writeFile(resolvedPath, input.content, 'utf-8');
    
    return `Successfully wrote to ${input.path}`;
  } catch (error) {
    return `Error writing file: ${error}`;
  }
}
