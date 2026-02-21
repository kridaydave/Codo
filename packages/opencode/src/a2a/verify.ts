import { Orchestrator } from "./orchestrator"
import { A2AClient } from "./client"

async function verify() {
    console.log("🚀 Starting A2A Verification...")

    const orchestrator = Orchestrator.getInstance()

    try {
        console.log("📦 Spawning sub-agent...")
        const agent = await orchestrator.spawnAgent({
            agentType: "tester",
            metadata: { purpose: "verification" }
        })

        console.log(`✅ Sub-agent spawned at: ${agent.url} (ID: ${agent.id})`)

        const client = new A2AClient(agent.url)

        console.log("🔍 Fetching Agent Card...")
        const card = await client.getAgentCard()
        console.log(`✅ Agent Card received: ${card.name} v${card.version}`)
        console.log(`Capabilities: ${card.capabilities.map(c => c.type).join(", ")}`)

        console.log("📡 Checking health...")
        const alive = await orchestrator.isAgentAlive(agent.id)
        console.log(`✅ Agent alive: ${alive}`)

        const stats = orchestrator.getStats()
        console.log(`📊 Orchestrator Stats: ${stats.activeAgents} active agent(s)`)

    } catch (error) {
        console.error("❌ Verification failed:", error)
    } finally {
        console.log("🛑 Terminating all agents...")
        await orchestrator.terminateAll(true)
        console.log("🏁 Verification complete.")
        process.exit(0)
    }
}

verify()
