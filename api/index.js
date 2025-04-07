import { createServer } from "http";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { setupXStyleServer } from "../server.js";

// Load environment variables
dotenv.config();

// Store active connections by session ID
const transports = {};

export default async function handler(req, res) {
  console.log(`Request received: ${req.method} ${req.url}`);
  console.log("Query params:", req.query);

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle OPTIONS request for CORS preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Route handling
  const { url } = req;

  // Health check endpoint
  if (req.method === "GET" && url.startsWith("/api/health")) {
    res.status(200).json({
      status: "ok",
      version: "1.0.0",
      hasTwitterKey: Boolean(process.env.TWITTER_API_KEY),
      hasSupabase: Boolean(
        process.env.SUPABASE_URL && process.env.SUPABASE_KEY
      ),
    });
    return;
  }

  // SSE endpoint
  if (req.method === "GET" && url === "/sse") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", "timeout=120");

    // Create a new MCP server instance
    const server = new McpServer({
      name: "x-style",
      version: "1.0.0",
    });

    // Set up all tools and prompts
    setupXStyleServer(server);

    // Create transport for this connection
    const transport = new SSEServerTransport("/api/messages", res);
    transports[transport.sessionId] = transport;

    // Send a ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      res.write("event: ping\ndata: ping\n\n");
    }, 30000);

    // Clean up on connection close
    res.on("close", () => {
      clearInterval(pingInterval);
      delete transports[transport.sessionId];
    });

    // Connect the server to the transport
    await server.connect(transport);
    return;
  }

  // Message handling endpoint
  if (req.method === "POST" && url.startsWith("/api/messages")) {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];

    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: "No active session found" });
    }
    return;
  }

  // If no matching route
  console.log("No matching route found");
  res.status(404).json({ error: "Route not found" });
}
