# GEMINI.md

## Project Overview

Codo is a multi-agent AI coding assistant designed for the terminal. It leverages the power of various LLMs (Anthropic, Gemini/Google, OpenAI, Groq, Ollama, etc.) to perform complex coding tasks through agent-to-agent (A2A) collaboration.

### Core Architecture

- **Orchestrator (`src/orchestrator/orchestrator.ts`)**: Manages the agent's state and coordinates the task execution. It uses an `EventEmitter` to communicate state updates to the UI.
- **Agent (`src/core/agent.ts`)**: The core logic for interacting with LLM providers. Agents use a system prompt and a set of tools to reason about and execute tasks.
- **Providers (`src/providers/`)**: Modular implementations for different LLM providers, ensuring a consistent interface (`LLMProvider`) for the `Agent`.
- **Tools (`src/tools/`)**: A set of executable functions that agents can call to interact with the file system and run shell commands.
- **UI (`src/ui/`)**: Built using [Ink](https://github.com/vadimdemedes/ink) (React for CLI), providing a responsive and interactive terminal experience.

### Main Technologies

- **TypeScript**: For type-safe development.
- **React + Ink**: For the terminal user interface.
- **Node.js**: The runtime environment.
- **Zod**: For schema validation (especially for tool inputs).

---

## Building and Running

### Development

To run the project in development mode:

```bash
npm run dev -- "your task description"
```

This uses `tsx` to run the source files directly.

### Production Build

To compile the project to JavaScript:

```bash
npm run build
```

This will generate the compiled files in the `dist/` directory.

### Running the Compiled Binary

After building, you can run the CLI using:

```bash
node dist/cli.js "your task description"
```

The project is configured to provide a `codo` binary command upon installation.

---

## Development Conventions

### Coding Style

- **ES Modules**: The project uses ESM (`"type": "module"` in `package.json`).
- **ESLint & Prettier**: Configured for consistent code formatting and linting.
- **React Patterns**: The UI is built using React components, following standard patterns but adapted for the terminal environment via Ink.

### State Management

- The `Orchestrator` uses an `EventEmitter` to broadcast state changes (`agent:state`, `agent:action`, etc.).
- UI components in `src/ui/` subscribe to these events to update the terminal display.

### Error Handling

- Agents are designed to handle tool execution errors and report them back to the LLM for potential self-correction.
- The `Orchestrator` catches and logs high-level execution errors.

### Testing

- **TODO**: Currently, no automated tests are implemented. Contributions should follow a pattern of adding unit tests for new core logic in a `tests/` directory or alongside the source files using a standard test runner like Vitest or Jest.

---

## Project Structure

- `src/cli.tsx`: The main entry point, handles CLI argument parsing.
- `src/ui.tsx`: The root React component for the terminal interface.
- `src/core/`: Contains core agent logic, system prompts, and configuration.
- `src/orchestrator/`: Handles the coordination of agents and tasks.
- `src/providers/`: Provider-specific implementations (Anthropic, Gemini, etc.).
- `src/tools/`: Definitions and execution logic for agent tools (read_file, write_file, run_command, etc.).
- `src/ui/`: UI components used by `App` in `ui.tsx`.
