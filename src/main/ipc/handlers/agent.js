// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Tool definitions for Ollama
const agentTools = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command and return the output. Use this for running any shell command like kubectl, git, npm, ls, cat, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to read'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The path to the file to write'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path to list'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tavily_search',
      description: 'Search the internet using Tavily API. Returns current information from web search results. Use this when you need up-to-date information, facts, news, or documentation from the internet.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
            default: 5
          }
        },
        required: ['query']
      }
    }
  }
];

// Execute a tool and return the result
async function executeAgentTool(toolName, args, cwd, configStore) {
  try {
    switch (toolName) {
      case 'bash': {
        try {
          const output = execSync(args.command, {
            cwd: cwd,
            encoding: 'utf-8',
            timeout: 60000,
            maxBuffer: 1024 * 1024 * 10
          });
          return output || '(command completed with no output)';
        } catch (e) {
          return `Error: ${e.message}\n${e.stderr || ''}`;
        }
      }
      case 'read_file': {
        const filePath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        if (!fs.existsSync(filePath)) {
          return `Error: File not found: ${filePath}`;
        }
        return fs.readFileSync(filePath, 'utf-8');
      }
      case 'write_file': {
        const filePath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, args.content, 'utf-8');
        return `File written: ${filePath}`;
      }
      case 'list_files': {
        const dirPath = path.isAbsolute(args.path) ? args.path : path.join(cwd, args.path);
        if (!fs.existsSync(dirPath)) {
          return `Error: Directory not found: ${dirPath}`;
        }
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items.map(item => `${item.isDirectory() ? '[dir] ' : ''}${item.name}`).join('\n');
      }
      case 'tavily_search': {
        const apiKey = (configStore && configStore.getTavilyApiKey()) || process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return 'Error: Tavily API key not set. Add it via the AI menu → Set Tavily API Key...';
        }

        try {
          const https = require('https');
          const maxResults = args.max_results || 5;

          const requestBody = JSON.stringify({
            api_key: apiKey,
            query: args.query,
            search_depth: 'basic',
            max_results: maxResults,
            include_answer: true
          });

          return await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'api.tavily.com',
              port: 443,
              path: '/search',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody)
              }
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  const result = JSON.parse(data);

                  if (result.error) {
                    resolve(`Error from Tavily: ${result.error}`);
                    return;
                  }

                  // Format results nicely
                  let output = '';

                  if (result.answer) {
                    output += `Answer: ${result.answer}\n\n`;
                  }

                  if (result.results && result.results.length > 0) {
                    output += 'Sources:\n';
                    result.results.forEach((item, idx) => {
                      output += `\n${idx + 1}. ${item.title}\n`;
                      output += `   URL: ${item.url}\n`;
                      output += `   ${item.content}\n`;
                    });
                  } else {
                    output += 'No results found.';
                  }

                  resolve(output);
                } catch (e) {
                  resolve(`Error parsing Tavily response: ${e.message}`);
                }
              });
            });

            req.on('error', (err) => {
              resolve(`Error calling Tavily API: ${err.message}`);
            });

            req.write(requestBody);
            req.end();
          });
        } catch (e) {
          return `Error: ${e.message}`;
        }
      }
      default:
        return `Error: Unknown tool: ${toolName}`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

/**
 * Register agent IPC handlers.
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ state: import('../../services/sessionState').SessionState, bus: import('../rendererBus').RendererBus, configStore: typeof import('../../services/configStore') }} deps
 */
function registerHandlers(ipcMain, { state, bus, configStore }) {
  // Agent execution using Ollama HTTP API with tool calling
  ipcMain.handle('agent-execute', async (event, prompt, cwd) => {
    const ollamaModel = configStore.getOllamaModel();
    if (!ollamaModel) {
      bus.send('claude-error', 'No AI model selected. Select one from the AI menu.\n');
      bus.send('claude-done', 1);
      return 1;
    }

    state.agentAborted = false;
    const workingDir = cwd || process.env.HOME;

    // Check for /clear command to reset conversation
    if (prompt.trim().toLowerCase() === 'clear' || prompt.trim().toLowerCase() === '/clear') {
      state.agentConversationHistory = [];
      bus.send('claude-output', 'Conversation history cleared.\n');
      bus.send('claude-done', 0);
      return 0;
    }

    // Build messages array - include conversation history for context
    const today = new Date().toISOString().split('T')[0];
    const systemMessage = {
      role: 'system',
      content: `You are a helpful assistant with access to tools. Use tools to help the user accomplish tasks. The current working directory is: ${workingDir}. Today's date is ${today}.

When you need to run commands, read files, write files, or list directories, use the appropriate tool.
When the user asks you to search the internet, look up current information, find recent news, or uses words like "zoek", "search", "latest", "recent", or "news", ALWAYS use the tavily_search tool — do not answer from memory.
After using tools, provide a summary of what you did. You have access to conversation history, so you can answer follow-up questions about previous results.`
    };

    // Start with system message, then history, then new prompt
    const messages = [systemMessage, ...state.agentConversationHistory, { role: 'user', content: prompt }];

    // Add user message to history
    state.agentConversationHistory.push({ role: 'user', content: prompt });

    try {
      let iterations = 0;
      const maxIterations = 20; // Prevent infinite loops

      while (iterations < maxIterations && !state.agentAborted) {
        iterations++;

        // Call Ollama API with tools
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            messages: messages,
            tools: agentTools,
            stream: false
          })
        });

        if (!response.ok) {
          const errorBody = await response.text();
          if (response.status === 400) {
            throw new Error(`Model "${ollamaModel}" may not support tool calling. Try llama3.2, llama3.1, mistral, or qwen2.5.\n\nDetails: ${errorBody}`);
          }
          throw new Error(`Ollama API error: ${response.status} - ${errorBody}`);
        }

        const result = await response.json();
        const assistantMessage = result.message;

        if (!assistantMessage) {
          throw new Error('No response from model');
        }

        // Add assistant message to history
        messages.push(assistantMessage);

        // Check if the model wants to call tools (native format)
        let toolCalls = assistantMessage.tool_calls || [];

        // Also check for JSON tool calls in text content (some models output this way)
        if (toolCalls.length === 0 && assistantMessage.content) {
          const jsonMatch = assistantMessage.content.match(/\{[\s\S]*"name"[\s\S]*"parameters"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              // Map the JSON format to our tool format
              const toolName = parsed.name === 'Execute a shell command and return the output' ? 'bash' :
                              parsed.name === 'Read the contents of a file' ? 'read_file' :
                              parsed.name === 'Write content to a file' ? 'write_file' :
                              parsed.name === 'List files and directories in a path' ? 'list_files' :
                              parsed.name; // fallback to original name

              // Handle different parameter formats
              let toolArgs = parsed.parameters || parsed.arguments || {};
              if (toolArgs.command && Array.isArray(toolArgs.command)) {
                toolArgs = { command: toolArgs.command.join(' ') };
              }

              toolCalls = [{
                function: {
                  name: toolName,
                  arguments: toolArgs
                }
              }];
            } catch (e) {
              // Not valid JSON, treat as regular output
            }
          }
        }

        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            if (state.agentAborted) break;

            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;

            // Show tool call in terminal
            bus.send('claude-output', `\n▶ ${toolName}: ${JSON.stringify(toolArgs)}\n`);

            // Execute the tool
            const toolResult = await executeAgentTool(toolName, toolArgs, workingDir, configStore);

            // Show result (truncated if too long)
            const displayResult = toolResult.length > 2000
              ? toolResult.substring(0, 2000) + '\n... (truncated)'
              : toolResult;
            bus.send('claude-output', `${displayResult}\n`);

            // Add tool result to messages (for current loop)
            messages.push({
              role: 'tool',
              content: toolResult
            });

            // Save tool call and result to conversation history
            state.agentConversationHistory.push({
              role: 'assistant',
              content: `[Used ${toolName}: ${JSON.stringify(toolArgs)}]\n\nResult:\n${toolResult.substring(0, 1000)}${toolResult.length > 1000 ? '...' : ''}`
            });
          }
        } else {
          // No tool calls - model is done, show final response
          if (assistantMessage.content) {
            bus.send('claude-output', assistantMessage.content);
            // Save final response to conversation history
            state.agentConversationHistory.push({
              role: 'assistant',
              content: assistantMessage.content
            });
          }
          break;
        }
      }

      if (iterations >= maxIterations) {
        bus.send('claude-output', '\n(Reached maximum iterations)\n');
      }

      // Limit conversation history to last 20 messages to prevent context overflow
      if (state.agentConversationHistory.length > 20) {
        state.agentConversationHistory = state.agentConversationHistory.slice(-20);
      }

      bus.send('claude-done', 0);
      return 0;
    } catch (e) {
      bus.send('claude-error', `Agent error: ${e.message}\n`);
      bus.send('claude-done', 1);
      return 1;
    }
  });
}

module.exports = { registerHandlers };
