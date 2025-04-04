import express from "express";
import cors from "cors";
import { createServer } from "http";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { setupXStyleServer } from "../server.js";

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Store active connections by session ID
const transports = {};

// Setup SSE endpoint for MCP connections
app.get("/sse", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

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

  // Clean up on connection close
  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  // Connect the server to the transport
  await server.connect(transport);
});

// Message handling endpoint
app.post("/api/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("No active session found");
  }
});

// Health check endpoint
app.get("/api/health", (_, res) => {
  res.status(200).send({
    status: "ok",
    version: "1.0.0",
    hasTwitterKey: Boolean(process.env.TWITTER_API_KEY),
    hasSupabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
  });
});

// Export for serverless use (Vercel)
export default app;

// Local development server
if (process.env.NODE_ENV !== "production") {
  const httpServer = createServer(app);
  const PORT = process.env.PORT || 3000;

  httpServer.listen(PORT, () => {
    console.log(`X Style MCP server running at http://localhost:${PORT}/`);
  });
}
