# X Style MCP Server

An MCP server for analyzing X (Twitter) user styles and generating posts in their distinctive voice.

## Features

- Analyze X user posting styles
- Generate posts in a specific user's style
- Blend styles from multiple users
- Caching for faster responses

## Deployment

### Deploy on Vercel

1. Fork this repository
2. Create a new Vercel project and connect it to your fork
3. Add the following environment variables in Vercel:
   - `TWITTER_API_KEY` - Your Twitter/X API key from twitterapi.io
   - `SUPABASE_URL` (optional) - For database persistence
   - `SUPABASE_KEY` (optional) - For database persistence
4. Deploy!

### Using with Claude Desktop

Add the following to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "x-style": {
      "url": "https://your-vercel-app-name.vercel.app"
    }
  }
}