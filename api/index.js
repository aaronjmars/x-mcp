// api/index.js
import { createServer } from "http";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { setupXStyleServer } from "../server.js";

// Load environment variables
dotenv.config();

// Store active connections by session ID (make this global to persist between function calls)
global.transports = global.transports || {};

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

  // Route handling based on path and method
  if (req.method === "GET" && req.url === "/sse") {
    // SSE endpoint
    handleSSE(req, res);
    return;
  } else if (req.method === "POST" && req.url.startsWith("/api/messages")) {
    // Message handling endpoint
    await handleMessages(req, res);
    return;
  } else if (req.method === "GET" && req.url.startsWith("/api/health")) {
    // Health check endpoint
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

  // If no matching route
  res.status(404).json({ error: "Route not found" });
}

// Handler for SSE connections
function handleSSE(req, res) {
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
  global.transports[transport.sessionId] = transport;

  console.log(
    `New SSE connection established, session ID: ${transport.sessionId}`
  );

  // Send a ping every 30 seconds to keep connection alive
  const pingInterval = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(pingInterval);
      return;
    }
    res.write("event: ping\ndata: ping\n\n");
  }, 30000);

  // Clean up on connection close
  res.on("close", () => {
    console.log(`SSE connection closed, session ID: ${transport.sessionId}`);
    clearInterval(pingInterval);
    delete global.transports[transport.sessionId];
  });

  // Connect the server to the transport
  server.connect(transport).catch((err) => {
    console.error("Error connecting server to transport:", err);
  });
}

// Handler for API messages
async function handleMessages(req, res) {
  const sessionId = req.query.sessionId;
  console.log(`Processing message for session ID: ${sessionId}`);

  if (!sessionId) {
    console.error("No session ID provided");
    res.status(400).json({ error: "No session ID provided" });
    return;
  }

  const transport = global.transports[sessionId];

  if (!transport) {
    console.error(`No active transport found for session ID: ${sessionId}`);
    console.log("Available session IDs:", Object.keys(global.transports));
    res.status(400).json({ error: "No active session found" });
    return;
  }

  // Debug the request body
  let body = {};
  try {
    // Get the request body
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const data = Buffer.concat(buffers).toString();
    body = JSON.parse(data);
    console.log("Request body:", body);
  } catch (error) {
    console.error("Error parsing request body:", error);
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  try {
    // Handle the message
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Error handling message:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}
