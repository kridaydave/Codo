import { Log } from "../util/log"
import { spawn, type Subprocess } from "bun"
import { Identifier } from "../id/id"
import { Global } from "../global"
import path from "path"
import { Shell } from "../shell/shell"

const log = Log.create({ service: "orchestrator" })

export interface OrchestratedAgent {
  id: string
  url: string
  process: Subprocess<"ignore", "pipe", "inherit">
  port: number
  spawnedAt: Date
  metadata?: Record<string, any>
}

export interface AgentSpawnOptions {
  /** Working directory for the sub-agent */
  directory?: string
  /** Additional environment variables */
  env?: Record<string, string>
  /** Agent type/specialization hint */
  agentType?: string
  /** Additional metadata to track */
  metadata?: Record<string, any>
}

/**
 * A2A Orchestrator - Manages sub-agent lifecycle
 * 
 * Responsibilities:
 * - Spawning new sub-agent processes on ephemeral ports
 * - Tracking active sub-agents and their A2A endpoints
 * - Terminating sub-agents when no longer needed
 * - Health monitoring of sub-agents
 */
export class Orchestrator {
  private static instance: Orchestrator
  private agents = new Map<string, OrchestratedAgent>()
  private healthCheckInterval?: Timer

  private constructor() {
    this.startHealthChecks()
  }

  static getInstance(): Orchestrator {
    if (!Orchestrator.instance) {
      Orchestrator.instance = new Orchestrator()
    }
    return Orchestrator.instance
  }

  /**
   * Spawns a new sub-agent instance using Bun.spawn
   * 
   * The sub-agent runs 'codo serve' on an ephemeral port (port 0)
   * and reports its actual port via stdout, which we capture.
   */
  async spawnAgent(options: AgentSpawnOptions = {}): Promise<OrchestratedAgent> {
    const id = Identifier.create("subagent", false)

    log.info("Spawning sub-agent", {
      id,
      directory: options.directory ?? process.cwd(),
      agentType: options.agentType
    })

    // Prepare environment
    const env: Record<string, string> = {
      ...process.env,
      ...options.env,
      OPENCODE_SERVER_PASSWORD: "", // Unsecured for local inter-process communication
      OPENCODE_A2A_MODE: "subagent", // Mark as sub-agent for potential special handling
      OPENCODE_AGENT_ID: id,
    }

    if (options.agentType) {
      env.OPENCODE_AGENT_TYPE = options.agentType
    }

    // Determine the entry point
    const entryPoint = this.resolveEntryPoint()
    const cwd = options.directory ?? process.cwd()

    // Start the sub-agent process
    const bun = process.execPath
    const proc = spawn([bun, "run", entryPoint, "serve", "--port", "0"], {
      cwd,
      env,
      stdout: "pipe",
      stderr: "inherit",
    })

    try {
      // Wait for the sub-agent to start and report its port
      const url = await this.waitForStartup(proc, id)
      const port = parseInt(new URL(url).port)

      const agent: OrchestratedAgent = {
        id,
        url,
        process: proc,
        port,
        spawnedAt: new Date(),
        metadata: options.metadata,
      }

      this.agents.set(id, agent)

      // Handle process exit/cleanup
      proc.exited.then((code) => {
        log.info("Sub-agent exited", { id, code })
        this.agents.delete(id)
      }).catch((error) => {
        log.error("Sub-agent error", { id, error })
        this.agents.delete(id)
      })

      log.info("Sub-agent spawned successfully", { id, url, port })
      return agent

    } catch (error) {
      // Clean up the process if startup failed
      proc.kill()
      throw error
    }
  }

  /**
   * Resolves the entry point for the sub-agent
   * Uses the current installation's entry point
   */
  private resolveEntryPoint(): string {
    // Check if we're in a development environment
    const devEntry = path.join(process.cwd(), "packages/opencode/src/index.ts")
    if (require("fs").existsSync(devEntry)) {
      return devEntry
    }

    // Otherwise use the installed CLI
    return Global.Path.self
  }

  /**
   * Waits for the sub-agent to start and reports its URL
   */
  private async waitForPort(proc: Subprocess<any, any, any>, agentId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = proc.stdout.getReader()
      let output = ""
      let resolved = false

      const cleanup = () => {
        if (!resolved) {
          resolved = true
          reader.releaseLock()
        }
      }

      const read = async () => {
        try {
          const { done, value } = await reader.read()
          if (done) {
            cleanup()
            reject(new Error(`Sub-agent ${agentId} exited before starting server`))
            return
          }

          output += new TextDecoder().decode(value)

          // Match the server output format: "opencode server listening on http://host:port"
          const match = output.match(/listening on (http:\/\/[^:]+:\d+)/)
          if (match) {
            cleanup()
            resolve(match[1])
            return
          }

          read()
        } catch (error) {
          cleanup()
          reject(error)
        }
      }

      read()

      // Timeout after 15 seconds
      setTimeout(() => {
        cleanup()
        reject(new Error(`Timeout waiting for sub-agent ${agentId} to start`))
      }, 15000)
    })
  }

  /**
   * Alias for waitForPort - waits for sub-agent to start and report URL
   */
  private async waitForStartup(proc: Subprocess<any, any, any>, agentId: string): Promise<string> {
    return this.waitForPort(proc, agentId)
  }

  /**
   * Returns a list of all active sub-agents
   */
  listActiveAgents(): OrchestratedAgent[] {
    return Array.from(this.agents.values())
  }

  /**
   * Gets a specific sub-agent by ID
   */
  getAgent(id: string): OrchestratedAgent | undefined {
    return this.agents.get(id)
  }

  /**
   * Terminates a specific sub-agent
   */
  async terminateAgent(id: string, force = false): Promise<boolean> {
    const agent = this.agents.get(id)
    if (!agent) return false

    log.info("Terminating sub-agent", { id, force })

    if (force) {
      agent.process.kill(9) // SIGKILL
    } else {
      agent.process.kill() // SIGTERM
    }

    // Wait for process to exit (with timeout)
    const timeout = 5000
    const exited = await Promise.race([
      agent.process.exited.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout)),
    ])

    if (!exited && !force) {
      log.warn("Sub-agent did not exit gracefully, forcing kill", { id })
      agent.process.kill(9)
      await agent.process.exited
    }

    this.agents.delete(id)
    return true
  }

  /**
   * Terminates all sub-agents
   */
  async terminateAll(force = false): Promise<void> {
    log.info("Terminating all sub-agents", { count: this.agents.size, force })
    const terminations = Array.from(this.agents.keys()).map((id) =>
      this.terminateAgent(id, force)
    )
    await Promise.all(terminations)
  }

  /**
   * Checks if a sub-agent is still alive
   */
  async isAgentAlive(id: string): Promise<boolean> {
    const agent = this.agents.get(id)
    if (!agent) return false

    try {
      // Try to fetch the agent card as a health check
      const response = await fetch(`${agent.url}/a2a/agent-card`, {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Starts periodic health checks for all sub-agents
   */
  private startHealthChecks(): void {
    // Run health check every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      for (const [id, agent] of this.agents) {
        const alive = await this.isAgentAlive(id)
        if (!alive) {
          log.warn("Sub-agent failed health check, removing from registry", { id })
          this.agents.delete(id)
        }
      }
    }, 30000)

    // Clean up on process exit
    process.on("exit", () => {
      this.stopHealthChecks()
    })

    process.on("SIGINT", async () => {
      await this.terminateAll(true)
      this.stopHealthChecks()
      process.exit(0)
    })

    process.on("SIGTERM", async () => {
      await this.terminateAll()
      this.stopHealthChecks()
    })
  }

  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  /**
   * Gets the count of active sub-agents
   */
  getActiveCount(): number {
    return this.agents.size
  }

  /**
   * Gets statistics about the orchestrator
   */
  getStats(): {
    activeAgents: number
    agents: Array<{
      id: string
      url: string
      port: number
      spawnedAt: Date
      uptime: number
    }>
  } {
    const now = Date.now()
    return {
      activeAgents: this.agents.size,
      agents: Array.from(this.agents.values()).map((agent) => ({
        id: agent.id,
        url: agent.url,
        port: agent.port,
        spawnedAt: agent.spawnedAt,
        uptime: now - agent.spawnedAt.getTime(),
      })),
    }
  }
}
