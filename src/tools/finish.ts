export const finishTool = {
  name: 'finish',
  description: 'Signal that the task is complete and provide a final summary of what you have done.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of the changes and actions taken.'
      }
    },
    required: ['summary']
  }
};

export async function finishExecute(input: { summary: string }): Promise<string> {
  return `TASK_COMPLETE: ${input.summary}`;
}
