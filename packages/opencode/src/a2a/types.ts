import z from "zod"
import { Identifier } from "../id/id"

/**
 * A2A (Agent-to-Agent) Protocol Types
 * Based on the A2A protocol specification for agent interoperability
 */

export namespace A2A {
  // ============================================================================
  // Common Types
  // ============================================================================

  export const TaskState = z.enum([
    "submitted",
    "working",
    "input-required",
    "completed",
    "canceled",
    "failed",
  ])
  export type TaskState = z.infer<typeof TaskState>

  export const Role = z.enum(["user", "agent"])
  export type Role = z.infer<typeof Role>

  // ============================================================================
  // Artifact Types
  // ============================================================================

  export const Artifact = z
    .object({
      id: z.string().optional().describe("Unique identifier for the artifact"),
      name: z.string().optional().describe("Human-readable name of the artifact"),
      description: z.string().optional().describe("Description of the artifact"),
      parts: z.array(z.any()).describe("Parts that make up the artifact content"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
      createdAt: z.string().datetime().optional().describe("ISO timestamp when artifact was created"),
      lastUpdated: z.string().datetime().optional().describe("ISO timestamp when artifact was last updated"),
    })
    .meta({
      ref: "A2AArtifact",
    })
  export type Artifact = z.infer<typeof Artifact>

  // ============================================================================
  // Message Types
  // ============================================================================

  export const TextPart = z.object({
    type: z.literal("text"),
    text: z.string().describe("The text content"),
  })

  export const FilePart = z.object({
    type: z.literal("file"),
    file: z.object({
      name: z.string().optional().describe("Filename"),
      mimeType: z.string().optional().describe("MIME type of the file"),
      bytes: z.string().optional().describe("Base64-encoded file content"),
      uri: z.string().optional().describe("URI reference to the file"),
    }),
  })

  export const DataPart = z.object({
    type: z.literal("data"),
    data: z.record(z.string(), z.any()).describe("Structured data object"),
  })

  export const MessagePart = z.discriminatedUnion("type", [TextPart, FilePart, DataPart])
  export type MessagePart = z.infer<typeof MessagePart>

  export const Message = z
    .object({
      id: z.string().optional().describe("Unique identifier for the message"),
      role: Role.describe("The role of the message sender"),
      parts: z.array(MessagePart).describe("Content parts of the message"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
      createdAt: z.string().datetime().optional().describe("ISO timestamp when message was created"),
    })
    .meta({
      ref: "A2AMessage",
    })
  export type Message = z.infer<typeof Message>

  // ============================================================================
  // Task Types
  // ============================================================================

  export const TaskStatus = z
    .object({
      state: TaskState.describe("Current state of the task"),
      message: Message.optional().describe("Status message or update"),
      timestamp: z.string().datetime().describe("ISO timestamp of the status update"),
    })
    .meta({
      ref: "A2ATaskStatus",
    })
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const Task = z
    .object({
      id: z
        .string()
        .describe("Unique identifier for the task")
        .refine((val) => val.startsWith("tsk_"), {
          message: "Task ID must start with 'tsk_'",
        }),
      sessionId: z
        .string()
        .optional()
        .describe("Optional session ID for grouping related tasks"),
      status: TaskStatus.describe("Current status of the task"),
      messages: z.array(Message).optional().describe("Messages exchanged during the task"),
      artifacts: z.array(Artifact).optional().describe("Artifacts produced by the task"),
      history: z.array(Message).optional().describe("Historical messages for context"),
      metadata: z.record(z.string(), z.any()).optional().describe("Additional task metadata"),
      createdAt: z.string().datetime().describe("ISO timestamp when task was created"),
      updatedAt: z.string().datetime().describe("ISO timestamp when task was last updated"),
    })
    .meta({
      ref: "A2ATask",
    })
  export type Task = z.infer<typeof Task>

  // ============================================================================
  // Agent Card Types (Discovery)
  // ============================================================================

  export const AgentCapability = z.object({
    type: z.string().describe("Type of capability (e.g., 'tools', 'streaming', 'push_notifications')"),
    description: z.string().optional().describe("Human-readable description"),
    config: z.record(z.string(), z.any()).optional().describe("Capability-specific configuration"),
  })

  export const AgentSkill = z.object({
    id: z.string().describe("Unique identifier for the skill"),
    name: z.string().describe("Human-readable name of the skill"),
    description: z.string().optional().describe("Description of what the skill does"),
    examples: z.array(z.string()).optional().describe("Example inputs for this skill"),
    inputModes: z.array(z.string()).optional().describe("Supported input modes (e.g., 'text', 'file')"),
    outputModes: z.array(z.string()).optional().describe("Supported output modes (e.g., 'text', 'file')"),
    config: z.record(z.string(), z.any()).optional().describe("Skill-specific configuration"),
  })

  export const AgentAuthentication = z.object({
    type: z.enum(["none", "api_key", "oauth2", "basic"]).describe("Authentication type"),
    description: z.string().optional().describe("Human-readable description"),
    config: z.record(z.string(), z.any()).optional().describe("Authentication configuration"),
  })

  export const AgentCard = z
    .object({
      name: z.string().describe("Human-readable name of the agent"),
      description: z.string().optional().describe("Description of the agent's purpose and capabilities"),
      url: z.string().url().describe("URL endpoint for the agent"),
      provider: z
        .object({
          name: z.string().describe("Organization providing the agent"),
          url: z.string().url().optional().describe("URL of the provider"),
        })
        .optional(),
      version: z.string().describe("Version of the agent"),
      documentationUrl: z.string().url().optional().describe("URL to agent documentation"),
      capabilities: z.array(AgentCapability).describe("List of agent capabilities"),
      skills: z.array(AgentSkill).describe("List of skills the agent can perform"),
      authentication: AgentAuthentication.describe("Authentication requirements"),
      defaultInputModes: z.array(z.string()).describe("Default supported input modes"),
      defaultOutputModes: z.array(z.string()).describe("Default supported output modes"),
      maxTokens: z.number().int().optional().describe("Maximum tokens the agent can process"),
      rateLimits: z
        .object({
          requestsPerMinute: z.number().int().optional(),
          requestsPerHour: z.number().int().optional(),
          requestsPerDay: z.number().int().optional(),
        })
        .optional(),
    })
    .meta({
      ref: "A2AAgentCard",
    })
  export type AgentCard = z.infer<typeof AgentCard>

  // ============================================================================
  // Request/Response Types
  // ============================================================================

  export const TaskCreateRequest = z.object({
    id: z.string().optional().describe("Optional client-provided task ID"),
    sessionId: z.string().optional().describe("Optional session ID for grouping"),
    message: Message.describe("Initial message to start the task"),
    history: z.array(Message).optional().describe("Historical context messages"),
    metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
  })

  export const TaskQueryRequest = z.object({
    id: z.string().describe("Task ID to query"),
  })

  export const TaskUpdateRequest = z.object({
    id: z.string().describe("Task ID to update"),
    message: Message.describe("Update message"),
    metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
  })

  export const TaskCancelRequest = z.object({
    id: z.string().describe("Task ID to cancel"),
  })

  // ============================================================================
  // ID Generation
  // ============================================================================

  export function createTaskID(): string {
    return Identifier.create("task" as any, false)
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  export function createTask(params: {
    id?: string
    sessionId?: string
    message: Message
    history?: Message[]
    metadata?: Record<string, any>
  }): Task {
    const now = new Date().toISOString()
    const id = params.id ?? createTaskID()

    return {
      id,
      sessionId: params.sessionId,
      status: {
        state: "submitted",
        timestamp: now,
      },
      messages: [params.message],
      artifacts: [],
      history: params.history ?? [],
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }
  }

  export function updateTaskStatus(
    task: Task,
    state: TaskState,
    message?: Message,
  ): Task {
    const now = new Date().toISOString()
    return {
      ...task,
      status: {
        state,
        message,
        timestamp: now,
      },
      updatedAt: now,
    }
  }

  export function addMessageToTask(task: Task, message: Message): Task {
    return {
      ...task,
      messages: [...(task.messages ?? []), message],
      updatedAt: new Date().toISOString(),
    }
  }

  export function addArtifactToTask(task: Task, artifact: Artifact): Task {
    return {
      ...task,
      artifacts: [...(task.artifacts ?? []), artifact],
      updatedAt: new Date().toISOString(),
    }
  }
}
