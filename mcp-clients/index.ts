// huggingface sdk - use dynamic import
import dotenv from "dotenv";
import readline from "readline/promises";

// mcp sdk
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

dotenv.config();

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
if (!HUGGINGFACE_API_KEY) {
  throw new Error("HUGGINGFACE_API_KEY is not set");
}

class MCPClient {
  private mcp: Client;
  private llm: any; // Will be set after dynamic import
  private transport: StdioClientTransport | null = null;
  private tools: any[] = [];
  private model: string;
  private messages: any[] = [];

  constructor(model: string = "mistralai/Mixtral-8x7B-Instruct-v0.1") {
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.model = model;
  }

  // Initialize Hugging Face client with dynamic import
  async initialize() {
    // Use dynamic import for ESM compatibility
    const { HfInference } = await import("@huggingface/inference");
    this.llm = new HfInference(HUGGINGFACE_API_KEY);
  }

  // Connect to the MCP
  async connectToServer(serverScriptPath: string) {
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

    this.transport = new StdioClientTransport({
      command,
      args: [serverScriptPath],
    });
    await this.mcp.connect(this.transport);

    // Register tools
    const toolsResult = await this.mcp.listTools();
    this.tools = toolsResult.tools.map((tool: any) => {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    });

    console.log(
      "Connected to server with tools:",
      this.tools.map(({ name }) => name)
    );
  }

  // Create a system prompt with tool descriptions
  private createSystemPrompt() {
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
  private formatChatHistory() {
    let formattedPrompt = "";
    
    // Add system message if there is no history yet
    if (this.messages.length === 0) {
      formattedPrompt += `<s>[INST] ${this.createSystemPrompt()} [/INST]</s>\n`;
    }
    
    // Add conversation history
    for (let i = 0; i < this.messages.length; i++) {
      const message = this.messages[i];
      if (message.role === "user") {
        formattedPrompt += `<s>[INST] ${message.content} [/INST]`;
      } else if (message.role === "assistant") {
        formattedPrompt += ` ${message.content}</s>\n`;
      }
    }
    
    return formattedPrompt;
  }

  // Extract tool calls from model response
  private extractToolCalls(text: string) {
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
      } catch (e) {
        console.error("Failed to parse tool call:", match[1]);
      }
    }
    
    return toolCalls;
  }

  // Process query
  async processQuery(query: string) {
    // Add user message to history
    this.messages.push({
      role: "user",
      content: query
    });
    
    // Format chat history for the model
    const prompt = this.formatChatHistory();
    
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
        finalText = finalText.replace(
          new RegExp(`<tool_call>\\s*\\{[\\s\\S]*?\\}\\s*</tool_call>`, "g"),
          `[Tool Result: ${JSON.stringify(toolResult)}]`
        );
        
        // Add tool result to chat history
        this.messages.push({
          role: "user",
          content: `Tool result for ${toolCall.name}: ${JSON.stringify(toolResult)}`
        });
        
        // Get follow-up response from model
        const followUpPrompt = this.formatChatHistory();
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
    this.messages.push({
      role: "assistant",
      content: finalText
    });
    
    return finalText;
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client with HuggingFace Started!");
      console.log(`Using model: ${this.model}`);
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.js <path_to_server_script> [huggingface_model]");
    return;
  }
  
  const model = process.argv[3] || "mistralai/Mixtral-8x7B-Instruct-v0.1";
  const mcpClient = new MCPClient(model);
  
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();