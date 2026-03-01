export function isTaskPrompt(input: string): boolean {
    const taskKeywords = ['build', 'add', 'refactor', 'fix', 'write', 'create', 'make', 'update', 'test', 'implement', 'do'];
    const lowerInput = input.toLowerCase();
    // Check if it starts with a task keyword
    if (taskKeywords.some(kw => lowerInput.startsWith(kw) || lowerInput.includes(` ${kw} `))) {
        return true;
    }
    return false;
}

export function generateChatResponse(input: string): string {
    const lowerInput = input.trim().toLowerCase();
    if (lowerInput === 'hi' || lowerInput === 'hello' || lowerInput === 'hey') {
        return "Hey! I'm Codo — a multi-agent coding assistant. Give me a coding task and I'll spin up parallel agents to tackle it.\n\nTry: codo \"build auth module\" \"write tests\" \"refactor DB\"";
    }
    if (lowerInput.includes('what models')) {
        return "Anthropic (Claude), Google (Gemini), Moonshot (Kimi), and Ollama for fully local/free usage. Set your provider in .codo/config.json.";
    }
    if (lowerInput.includes('help')) {
        return "I am Codo. Type a coding task like 'create a login component' to start task mode. Keyboard shortcuts during tasks: q=quit, d=diff, m=merge, Tab=switch agent.";
    }
    return "Do you want me to start working on this as a task? (Please start your prompt with 'build', 'create', 'fix', etc. to trigger task mode)";
}
