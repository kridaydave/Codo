import { A2A } from "./types"
import { Log } from "../util/log"

const log = Log.create({ service: "a2a-client" })

export class A2AClient {
    constructor(private baseUrl: string) {
        // Remove trailing slash if present
        this.baseUrl = baseUrl.replace(/\/$/, "")
    }

    /**
     * Fetches the agent card from the remote agent
     */
    async getAgentCard(): Promise<A2A.AgentCard> {
        const res = await fetch(`${this.baseUrl}/a2a/agent-card`)
        if (!res.ok) throw new Error(`Failed to fetch agent card: ${res.statusText}`)
        return await res.json()
    }

    /**
     * Submits a new task to the remote agent
     */
    async createTask(request: A2A.TaskCreateRequest): Promise<A2A.Task> {
        const res = await fetch(`${this.baseUrl}/a2a/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        })
        if (!res.ok) throw new Error(`Failed to create task: ${res.statusText}`)
        return await res.json()
    }

    /**
     * Polls the status of a task
     */
    async getTask(taskId: string): Promise<A2A.Task> {
        const res = await fetch(`${this.baseUrl}/a2a/tasks/${taskId}`)
        if (!res.ok) throw new Error(`Failed to fetch task ${taskId}: ${res.statusText}`)
        return await res.json()
    }

    /**
     * Sends an update/message to a task
     */
    async updateTask(taskId: string, message: Omit<A2A.Message, "id" | "createdAt">): Promise<A2A.Task> {
        const res = await fetch(`${this.baseUrl}/a2a/tasks/${taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
        })
        if (!res.ok) throw new Error(`Failed to update task ${taskId}: ${res.statusText}`)
        return await res.json()
    }

    /**
     * Cancels a task
     */
    async cancelTask(taskId: string): Promise<A2A.Task> {
        const res = await fetch(`${this.baseUrl}/a2a/tasks/${taskId}`, {
            method: "DELETE",
        })
        if (!res.ok) throw new Error(`Failed to cancel task ${taskId}: ${res.statusText}`)
        return await res.json()
    }

    /**
     * Waits for a task to complete or fail
     */
    async waitForTask(taskId: string, onUpdate?: (task: A2A.Task) => void): Promise<A2A.Task> {
        let task = await this.getTask(taskId)

        while (task.status.state !== "completed" && task.status.state !== "failed" && task.status.state !== "canceled") {
            if (onUpdate) onUpdate(task)

            // Wait before polling again
            await new Promise(resolve => setTimeout(resolve, 1000))
            task = await this.getTask(taskId)
        }

        return task
    }
}
