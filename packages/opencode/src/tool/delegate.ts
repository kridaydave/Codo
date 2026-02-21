import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./delegate.txt"
import { Orchestrator } from "../a2a/orchestrator"
import { A2AClient } from "../a2a/client"

export const DelegateTool = Tool.define("delegate", {
    description: DESCRIPTION,
    parameters: z.object({
        task: z.string().describe("Detailed description of the task to delegate"),
        agent_type: z.string().optional().describe("Optional type or specialization of the agent (e.g., 'frontend', 'security')"),
    }),
    async execute(params, ctx) {
        const orchestrator = Orchestrator.getInstance()

        // Spawn a new sub-agent
        const agent = await orchestrator.spawnAgent({
            env: {
                AGENT_TYPE: params.agent_type ?? "general",
            },
            directory: (globalThis as any).process.cwd(), // Inherit current directory
        })

        const client = new A2AClient(agent.url)

        // Submit the task
        const taskRequest = {
            message: {
                role: "user" as const,
                parts: [{ type: "text" as const, text: params.task }],
                createdAt: new Date().toISOString(),
            },
        }

        const a2aTask = await client.createTask(taskRequest)

        // Log the delegation
        ctx.metadata({
            title: `Delegating to ${agent.id}`,
            metadata: { agentId: agent.id, taskId: a2aTask.id }
        })

        // Wait for completion
        const result = await client.waitForTask(a2aTask.id)

        const metadata: Record<string, any> = {
            agentId: agent.id,
            taskId: a2aTask.id,
            state: result.status.state,
        }

        if (result.status.state === "completed") {
            const lastMessage = result.messages?.[result.messages.length - 1]
            const responseText = lastMessage?.parts
                .filter(p => p.type === "text")
                .map(p => (p as any).text)
                .join("\n") ?? "Task completed without text response."

            return {
                title: `Task Completed (Agent ${agent.id})`,
                metadata,
                output: responseText,
            }
        } else {
            return {
                title: `Task Failed (Agent ${agent.id})`,
                metadata,
                output: `Sub-agent (ID: ${agent.id}) failed or was canceled. State: ${result.status.state}`,
            }
        }
    }
})
