export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  tool_call_id?: string; // For OpenAI/Gemini tool results
  name?: string; // For OpenAI tool results
}

export interface ToolInput {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id?: string;
  output: string;
  isError?: boolean;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMProvider {
  name: string;
  sendMessage(
    messages: Message[],
    tools: ToolInput[]
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    usage?: Usage;
  }>;
}
