# MCP Starter Project

## What is MCP?

The Model Context Protocol (MCP) is a standard for building AI applications that can interact with external tools and APIs. It consists of two main components:

1. **MCP Server**: A Python service that defines and exposes tools/functions that can be called by AI models
2. **MCP Client**: A TypeScript/JavaScript client that connects to the MCP server and manages interactions between AI models and tools

## Project Structure

```
mcp_starter/
├── mcp-server/           # Python MCP server implementation
│   ├── main.py          # Server with documentation search tool
│   └── pyproject.toml   # Python dependencies
└── mcp-clients/         # TypeScript MCP client implementation
    ├── index.ts         # Express server with HuggingFace integration
    └── package.json     # Node.js dependencies
```

## Getting Started

### Prerequisites

- Python 3.11 or higher
- Node.js 18 or higher
- [Hugging Face API key](https://huggingface.co/settings/tokens)
- [Serper API key](https://serper.dev/) for Google Search functionality

### Setting Up the Server

1. Create a Python virtual environment and activate it:
```bash
cd mcp-server
python -m venv .venv
# On Windows
.venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -e .
```

3. Create a `.env` file in the `mcp-server` directory:
```plaintext
SERPER_API_KEY=your_serper_api_key_here
```

### Setting Up the Client

1. Install Node.js dependencies:
```bash
cd mcp-clients
npm install
```

2. Create a `.env` file in the `mcp-clients` directory:
```plaintext
HUGGINGFACE_API_KEY=your_huggingface_api_key_here
```

3. Build the TypeScript code:
```bash
npm run build
```

## Running the Application

1. Start the MCP server:
```bash
cd mcp-server
python main.py
```

2. In a new terminal, start the client server:
```bash
cd mcp-clients
node build/index.js ../mcp-server/main.py
```

## Using the API

The client exposes two endpoints:

- **Health Check**: `GET http://localhost:3000/health`
- **Chat**: `POST http://localhost:3000/chat`

Example chat request:
```json
{
  "query": "Search the langchain docs for RAG",
  "sessionId": "user123"
}
```

## Features

- **Documentation Search Tool**: Search documentation for popular AI libraries:
  - LangChain
  - LlamaIndex
  - OpenAI

- **Conversation Management**: Maintains chat history per session
- **Tool Integration**: Seamlessly integrates AI model responses with tool calls
- **Error Handling**: Robust error handling for API calls and tool execution

## How It Works

1. The MCP server defines tools that can be called by AI models
2. The client connects to the MCP server and retrieves available tools
3. When a user sends a query:
   - The client formats the conversation history
   - Sends it to the Hugging Face model
   - Extracts and executes tool calls from the model's response
   - Returns the final response including tool results

## Environment Variables

### Server
- `SERPER_API_KEY`: API key for Google Search functionality

### Client
- `HUGGINGFACE_API_KEY`: API key for accessing Hugging Face models

## License

MIT License