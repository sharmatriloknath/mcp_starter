"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Express server with HuggingFace MCP client
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// mcp sdk
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
dotenv_1.default.config();
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
if (!HUGGINGFACE_API_KEY) {
    throw new Error("HUGGINGFACE_API_KEY is not set");
}
class MCPClient {
    mcp;
    llm; // Will be set after dynamic import
    transport = null;
    tools = [];
    model;
    messages = {}; // Store message history by session ID
    constructor(model = "mistralai/Mixtral-8x7B-Instruct-v0.1") {
        this.mcp = new index_js_1.Client({ name: "mcp-client-cli", version: "1.0.0" });
        this.model = model;
    }
    // Initialize Hugging Face client with dynamic import
    async initialize() {
        // Use dynamic import for ESM compatibility
        const hfModule = await import("@huggingface/inference");
        this.llm = new hfModule.HfInference(HUGGINGFACE_API_KEY);
    }
    // Connect to the MCP
    async connectToServer(serverScriptPath) {
        // Initialize Hugging Face client
        await this.initialize();
        const isJs = serverScriptPath.endsWith(".js");
        const isPy = serverScriptPath.endsWith(".py");
        if (!isJs && !isPy) {
            throw new Error("Server script must be a .js or .py file");
        }
        const command = isPy
            ? process.platform === "win32"
                ? "python"
                : "python3"
            : process.execPath;
        this.transport = new stdio_js_1.StdioClientTransport({
            command,
            args: [serverScriptPath],
        });
        await this.mcp.connect(this.transport);
        // Register tools
        const toolsResult = await this.mcp.listTools();
        this.tools = toolsResult.tools.map((tool) => {
            return {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            };
        });
        console.log("Connected to server with tools:", this.tools.map(({ name }) => name));
        return this.tools;
    }
    // Get tools
    getTools() {
        return this.tools;
    }
    // Create a system prompt with tool descriptions
    createSystemPrompt() {
        let systemPrompt = "You are a helpful assistant. ";
        if (this.tools.length > 0) {
            systemPrompt += "You have access to the following tools:\n\n";
            for (const tool of this.tools) {
                systemPrompt += `Tool: ${tool.name}\n`;
                systemPrompt += `Description: ${tool.description}\n`;
                systemPrompt += `Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}\n\n`;
            }
            systemPrompt += "When you need to use a tool, format your response like this:\n";
            systemPrompt += "<tool_call>\n";
            systemPrompt += "{\n";
            systemPrompt += '  "name": "tool_name",\n';
            systemPrompt += '  "arguments": {"arg1": "value1", "arg2": "value2"}\n';
            systemPrompt += "}\n";
            systemPrompt += "</tool_call>\n\n";
            systemPrompt += "After using a tool, I'll provide you with the result and you can continue the conversation.";
        }
        return systemPrompt;
    }
    // Format chat history for HuggingFace model
    formatChatHistory(sessionId) {
        // Initialize session if it doesn't exist
        if (!this.messages[sessionId]) {
            this.messages[sessionId] = [];
        }
        let formattedPrompt = "";
        // Add system message if there is no history yet
        if (this.messages[sessionId].length === 0) {
            formattedPrompt += `<s>[INST] ${this.createSystemPrompt()} [/INST]</s>\n`;
        }
        // Add conversation history
        for (let i = 0; i < this.messages[sessionId].length; i++) {
            const message = this.messages[sessionId][i];
            if (message.role === "user") {
                formattedPrompt += `<s>[INST] ${message.content} [/INST]`;
            }
            else if (message.role === "assistant") {
                formattedPrompt += ` ${message.content}</s>\n`;
            }
        }
        return formattedPrompt;
    }
    // Extract tool calls from model response
    extractToolCalls(text) {
        const toolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
        const toolCalls = [];
        let match;
        while ((match = toolCallRegex.exec(text)) !== null) {
            try {
                const toolCallJson = JSON.parse(match[1]);
                toolCalls.push({
                    name: toolCallJson.name,
                    arguments: toolCallJson.arguments
                });
            }
            catch (e) {
                console.error("Failed to parse tool call:", match[1]);
            }
        }
        return toolCalls;
    }
    // Process query
    async processQuery(query, sessionId = "default") {
        // Initialize session if it doesn't exist
        if (!this.messages[sessionId]) {
            this.messages[sessionId] = [];
        }
        // Add user message to history
        this.messages[sessionId].push({
            role: "user",
            content: query
        });
        // Format chat history for the model
        const prompt = this.formatChatHistory(sessionId);
        // Call the model
        const response = await this.llm.textGeneration({
            model: this.model,
            inputs: prompt,
            parameters: {
                max_new_tokens: 1000,
                temperature: 0.7,
                return_full_text: false
            }
        });
        const modelResponse = response.generated_text;
        // Extract tool calls
        const toolCalls = this.extractToolCalls(modelResponse);
        let finalText = modelResponse;
        if (toolCalls.length > 0) {
            // Handle tool calls
            for (const toolCall of toolCalls) {
                const toolResult = await this.mcp.callTool({
                    name: toolCall.name,
                    arguments: toolCall.arguments
                });
                // Replace tool call with result in the response
                finalText = finalText.replace(new RegExp(`<tool_call>\\s*\\{[\\s\\S]*?\\}\\s*</tool_call>`, "g"), `[Tool Result: ${JSON.stringify(toolResult)}]`);
                // Add tool result to chat history
                this.messages[sessionId].push({
                    role: "user",
                    content: `Tool result for ${toolCall.name}: ${JSON.stringify(toolResult)}`
                });
                // Get follow-up response from model
                const followUpPrompt = this.formatChatHistory(sessionId);
                const followUpResponse = await this.llm.textGeneration({
                    model: this.model,
                    inputs: followUpPrompt,
                    parameters: {
                        max_new_tokens: 1000,
                        temperature: 0.7,
                        return_full_text: false
                    }
                });
                finalText += "\n\nFollow-up response: " + followUpResponse.generated_text;
            }
        }
        // Add assistant response to history
        this.messages[sessionId].push({
            role: "assistant",
            content: finalText
        });
        return finalText;
    }
    async cleanup() {
        await this.mcp.close();
    }
}
// Express server setup
async function setupServer(serverScriptPath, model, port = 3000) {
    const app = (0, express_1.default)();
    // Configure middleware
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    // Initialize MCP client
    const mcpClient = new MCPClient(model);
    await mcpClient.connectToServer(serverScriptPath);
    // Health endpoint - returns available tools
    app.get('/health', (req, res) => {
        const tools = mcpClient.getTools();
        res.json({
            status: 'healthy',
            model: model,
            tools: tools
        });
    });
    // Chat endpoint
    app.post('/chat', (req, res, next) => {
        (async () => {
            try {
                const { query, sessionId = 'default' } = req.body;
                if (!query) {
                    return res.status(400).json({ error: 'Query is required' });
                }
                const response = await mcpClient.processQuery(query, sessionId);
                res.json({
                    sessionId,
                    response
                });
            }
            catch (error) {
                console.error('Error processing chat request:', error);
                res.status(500).json({
                    error: 'Failed to process query',
                    details: error.message
                });
                next(error);
            }
        })();
    });
    // Start server
    const server = app.listen(port, () => {
        console.log(`MCP Express Server running on port ${port}`);
        console.log(`Health endpoint: http://localhost:${port}/health`);
        console.log(`Chat endpoint: http://localhost:${port}/chat (POST)`);
    });
    // Cleanup on exit
    process.on('SIGINT', async () => {
        console.log('Shutting down server...');
        await mcpClient.cleanup();
        process.exit(0);
    });
    return app;
}
// Main function
async function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node server.js <path_to_server_script> [huggingface_model] [port]");
        return;
    }
    const serverScriptPath = process.argv[2];
    const model = process.argv[3] || "mistralai/Mixtral-8x7B-Instruct-v0.1";
    const port = parseInt(process.argv[4]) || 3000;
    try {
        await setupServer(serverScriptPath, model, port);
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
main();
