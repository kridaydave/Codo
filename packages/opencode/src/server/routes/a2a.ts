import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { A2A } from "../../a2a/types"
import { Agent } from "../../agent/agent"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { Installation } from "@/installation"
import { Orchestrator } from "@/a2a/orchestrator"

const log = Log.create({ service: "a2a" })

/**
 * In-memory task store for A2A tasks
 * In production, this should be replaced with a persistent store
 */
const taskStore = new Map<string, A2A.Task>()

/**
 * A2A Routes - Agent-to-Agent Protocol Implementation
 * Implements the core A2A protocol for agent discovery and task management
 */
export const A2ARoutes = lazy(() =>
  new Hono()
    // ============================================================================
    // Agent Discovery Endpoint
    // ============================================================================
    .get(
      "/agent-card",
      describeRoute({
        summary: "Get Agent Card",
        description: "Retrieve the agent's capabilities and metadata for A2A protocol discovery.",
        operationId: "a2a.agentCard",
        responses: {
          200: {
            description: "Agent card with capabilities",
            content: {
              "application/json": {
                schema: resolver(A2A.AgentCard),
              },
            },
          },
        },
      }),
      async (c) => {
        const agentCard = await buildAgentCard(c.req.url)
        return c.json(agentCard)
      },
    )

    // ============================================================================
    // Task Management Endpoints
    // ============================================================================

    // Create a new task
    .post(
      "/tasks",
      describeRoute({
        summary: "Create Task",
        description: "Create a new A2A task and start processing it.",
        operationId: "a2a.task.create",
        responses: {
          200: {
            description: "Task created successfully",
            content: {
              "application/json": {
                schema: resolver(A2A.Task),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", A2A.TaskCreateRequest),
      async (c) => {
        const body = c.req.valid("json")
        const task = A2A.createTask(body)

        // Store the task
        taskStore.set(task.id, task)

        log.info("Task created", { taskId: task.id, sessionId: task.sessionId })

        // Start processing the task asynchronously
        processTaskAsync(task.id).catch((error) => {
          log.error("Task processing failed", { taskId: task.id, error })
        })

        return c.json(task)
      },
    )

    // Get task status/details
    .get(
      "/tasks/:taskId",
      describeRoute({
        summary: "Get Task",
        description: "Retrieve the current status and details of an A2A task.",
        operationId: "a2a.task.get",
        responses: {
          200: {
            description: "Task details",
            content: {
              "application/json": {
                schema: resolver(A2A.Task),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          taskId: z.string().describe("Task ID"),
        }),
      ),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const task = taskStore.get(taskId)

        if (!task) {
          return c.json({ error: "Task not found" }, 404)
        }

        return c.json(task)
      },
    )

    // Update task (send additional input)
    .post(
      "/tasks/:taskId",
      describeRoute({
        summary: "Update Task",
        description: "Send additional input or updates to an existing A2A task.",
        operationId: "a2a.task.update",
        responses: {
          200: {
            description: "Task updated successfully",
            content: {
              "application/json": {
                schema: resolver(A2A.Task),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          taskId: z.string().describe("Task ID"),
        }),
      ),
      validator("json", A2A.Message.omit({ id: true, createdAt: true })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const messageData = c.req.valid("json")
        const task = taskStore.get(taskId)

        if (!task) {
          return c.json({ error: "Task not found" }, 404)
        }

        // Create the message with ID and timestamp
        const message: A2A.Message = {
          id: `msg_${Date.now()}`,
          ...messageData,
          createdAt: new Date().toISOString(),
        }

        // Add message to task
        const updatedTask = A2A.addMessageToTask(task, message)

        // If task was waiting for input, resume processing
        if (task.status.state === "input-required") {
          const resumedTask = A2A.updateTaskStatus(updatedTask, "working")
          taskStore.set(taskId, resumedTask)

          // Resume processing
          processTaskAsync(taskId).catch((error) => {
            log.error("Task processing failed", { taskId, error })
          })

          return c.json(resumedTask)
        }

        taskStore.set(taskId, updatedTask)
        return c.json(updatedTask)
      },
    )

    // Cancel a task
    .delete(
      "/tasks/:taskId",
      describeRoute({
        summary: "Cancel Task",
        description: "Cancel an active or pending A2A task.",
        operationId: "a2a.task.cancel",
        responses: {
          200: {
            description: "Task canceled successfully",
            content: {
              "application/json": {
                schema: resolver(A2A.Task),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          taskId: z.string().describe("Task ID"),
        }),
      ),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const task = taskStore.get(taskId)

        if (!task) {
          return c.json({ error: "Task not found" }, 404)
        }

        const canceledTask = A2A.updateTaskStatus(task, "canceled")
        taskStore.set(taskId, canceledTask)

        log.info("Task canceled", { taskId })

        return c.json(canceledTask)
      },
    )

    // List tasks
    .get(
      "/tasks",
      describeRoute({
        summary: "List Tasks",
        description: "List all A2A tasks with optional filtering.",
        operationId: "a2a.task.list",
        responses: {
          200: {
            description: "List of tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    tasks: A2A.Task.array(),
                    total: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          sessionId: z.string().optional().describe("Filter by session ID"),
          state: A2A.TaskState.optional().describe("Filter by task state"),
          limit: z.coerce.number().default(100).describe("Maximum number of tasks to return"),
          offset: z.coerce.number().default(0).describe("Offset for pagination"),
        }),
      ),
      async (c) => {
        const { sessionId, state, limit, offset } = c.req.valid("query")

        let tasks = Array.from(taskStore.values())

        // Apply filters
        if (sessionId) {
          tasks = tasks.filter((t) => t.sessionId === sessionId)
        }
        if (state) {
          tasks = tasks.filter((t) => t.status.state === state)
        }

        // Sort by creation date (newest first)
        tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        const total = tasks.length
        const paginatedTasks = tasks.slice(offset, offset + limit)

        return c.json({
          tasks: paginatedTasks,
          total,
        })
      },
    )

    // ============================================================================
    // Sub-Agent Management Endpoints (Orchestrator)
    // ============================================================================

    // Spawn a new sub-agent
    .post(
      "/agents",
      describeRoute({
        summary: "Spawn Sub-Agent",
        description: "Spawn a new sub-agent instance and return its connection details.",
        operationId: "a2a.agent.spawn",
        responses: {
          200: {
            description: "Sub-agent spawned successfully",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    url: z.string(),
                    port: z.number(),
                    spawnedAt: z.string().datetime(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          directory: z.string().optional().describe("Working directory for the sub-agent"),
          env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
          agentType: z.string().optional().describe("Agent type/specialization"),
          metadata: z.record(z.string(), z.any()).optional().describe("Additional metadata"),
        }),
      ),
      async (c) => {
        const orchestrator = Orchestrator.getInstance()
        const body = c.req.valid("json")

        const agent = await orchestrator.spawnAgent({
          directory: body.directory,
          env: body.env,
          agentType: body.agentType,
          metadata: body.metadata,
        })

        return c.json({
          id: agent.id,
          url: agent.url,
          port: agent.port,
          spawnedAt: agent.spawnedAt.toISOString(),
        })
      },
    )

    // List active sub-agents
    .get(
      "/agents",
      describeRoute({
        summary: "List Sub-Agents",
        description: "List all active sub-agents managed by the orchestrator.",
        operationId: "a2a.agent.list",
        responses: {
          200: {
            description: "List of active sub-agents",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    agents: z.array(
                      z.object({
                        id: z.string(),
                        url: z.string(),
                        port: z.number(),
                        spawnedAt: z.string().datetime(),
                        uptime: z.number(),
                        metadata: z.record(z.string(), z.any()).optional(),
                      }),
                    ),
                    total: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const orchestrator = Orchestrator.getInstance()
        const stats = orchestrator.getStats()

        return c.json({
          agents: stats.agents,
          total: stats.activeAgents,
        })
      },
    )

    // Get sub-agent details
    .get(
      "/agents/:agentId",
      describeRoute({
        summary: "Get Sub-Agent",
        description: "Get details of a specific sub-agent.",
        operationId: "a2a.agent.get",
        responses: {
          200: {
            description: "Sub-agent details",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    url: z.string(),
                    port: z.number(),
                    spawnedAt: z.string().datetime(),
                    uptime: z.number(),
                    alive: z.boolean(),
                    metadata: z.record(z.string(), z.any()).optional(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          agentId: z.string().describe("Agent ID"),
        }),
      ),
      async (c) => {
        const { agentId } = c.req.valid("param")
        const orchestrator = Orchestrator.getInstance()
        const agent = orchestrator.getAgent(agentId)

        if (!agent) {
          return c.json({ error: "Agent not found" }, 404)
        }

        const alive = await orchestrator.isAgentAlive(agentId)

        return c.json({
          id: agent.id,
          url: agent.url,
          port: agent.port,
          spawnedAt: agent.spawnedAt.toISOString(),
          uptime: Date.now() - agent.spawnedAt.getTime(),
          alive,
          metadata: agent.metadata,
        })
      },
    )

    // Terminate a sub-agent
    .delete(
      "/agents/:agentId",
      describeRoute({
        summary: "Terminate Sub-Agent",
        description: "Terminate a specific sub-agent.",
        operationId: "a2a.agent.terminate",
        responses: {
          200: {
            description: "Sub-agent terminated successfully",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                  }),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator(
        "param",
        z.object({
          agentId: z.string().describe("Agent ID"),
        }),
      ),
      validator(
        "query",
        z.object({
          force: z.coerce.boolean().default(false).describe("Force kill the agent"),
        }),
      ),
      async (c) => {
        const { agentId } = c.req.valid("param")
        const { force } = c.req.valid("query")
        const orchestrator = Orchestrator.getInstance()

        const success = await orchestrator.terminateAgent(agentId, force)

        if (!success) {
          return c.json({ error: "Agent not found" }, 404)
        }

        return c.json({ success: true })
      },
    )

    // Get orchestrator stats
    .get(
      "/agents/stats",
      describeRoute({
        summary: "Orchestrator Stats",
        description: "Get statistics about the orchestrator and active sub-agents.",
        operationId: "a2a.agent.stats",
        responses: {
          200: {
            description: "Orchestrator statistics",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    activeAgents: z.number(),
                    agents: z.array(
                      z.object({
                        id: z.string(),
                        url: z.string(),
                        port: z.number(),
                        spawnedAt: z.string().datetime(),
                        uptime: z.number(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const orchestrator = Orchestrator.getInstance()
        return c.json(orchestrator.getStats())
      },
    ),
)

/**
 * Build the Agent Card for A2A discovery
 */
async function buildAgentCard(requestUrl: string): Promise<A2A.AgentCard> {
  const baseUrl = new URL(requestUrl)
  const agentUrl = `${baseUrl.protocol}//${baseUrl.host}/a2a`

  // Get available agents to build skills list
  const agents = await Agent.list()

  const skills: A2A.AgentSkill[] = agents
    .filter((agent) => !agent.hidden)
    .map((agent) => ({
      id: agent.name,
      name: agent.name,
      description: agent.description ?? `Agent mode: ${agent.name}`,
      examples: [],
      inputModes: ["text", "file"],
      outputModes: ["text", "file"],
    }))

  return {
    name: "OpenCode",
    description: "AI-powered development tool with code editing, file management, and multi-step task execution capabilities.",
    url: agentUrl,
    provider: {
      name: "OpenCode",
      url: "https://opencode.ai",
    },
    version: Installation.VERSION,
    documentationUrl: "https://docs.opencode.ai",
    capabilities: [
      {
        type: "tasks",
        description: "Supports task creation, status polling, and updates",
      },
      {
        type: "streaming",
        description: "Supports streaming task updates",
      },
      {
        type: "tools",
        description: "Supports tool execution including file editing, shell commands, and web search",
      },
      {
        type: "multi_agent",
        description: "Supports subagent delegation for complex tasks",
      },
    ],
    skills,
    authentication: {
      type: "none",
      description: "Authentication handled at the server level",
    },
    defaultInputModes: ["text", "file"],
    defaultOutputModes: ["text", "file"],
  }
}

/**
 * Process a task asynchronously
 * This is a placeholder implementation - in production, this would:
 * 1. Route the task to the appropriate agent/mode
 * 2. Execute the requested operation
 * 3. Update the task status and add messages/artifacts
 */
async function processTaskAsync(taskId: string): Promise<void> {
  const task = taskStore.get(taskId)
  if (!task) return

  // Update status to working
  let updatedTask = A2A.updateTaskStatus(task, "working")
  taskStore.set(taskId, updatedTask)

  try {
    // TODO: Implement actual task processing logic
    // This should:
    // 1. Parse the initial message to understand the request
    // 2. Route to the appropriate agent/mode
    // 3. Execute the task
    // 4. Update status and add results

    // For now, simulate processing
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Add a response message
    const responseMessage: A2A.Message = {
      id: `msg_${Date.now()}`,
      role: "agent",
      parts: [
        {
          type: "text",
          text: "Task received and processing started. This is a placeholder response.",
        },
      ],
      createdAt: new Date().toISOString(),
    }

    updatedTask = A2A.addMessageToTask(updatedTask, responseMessage)
    updatedTask = A2A.updateTaskStatus(updatedTask, "completed")
    taskStore.set(taskId, updatedTask)

    log.info("Task completed", { taskId })
  } catch (error) {
    log.error("Task processing error", { taskId, error })
    updatedTask = A2A.updateTaskStatus(updatedTask, "failed")
    taskStore.set(taskId, updatedTask)
  }
}
