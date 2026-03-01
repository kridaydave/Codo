import { readFile } from 'fs/promises';
import { resolve } from 'path';

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
    const resolvedPath = resolve(process.cwd(), input.path);
    const content = await readFile(resolvedPath, 'utf-8');
    return content;
  } catch (error) {
    return `Error reading file: ${error}`;
  }
}
