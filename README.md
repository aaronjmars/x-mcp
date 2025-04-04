# X MCP Server

An MCP server for analyzing X (Twitter) user styles and generating posts in their distinctive voice.

## 🚀 Features

- **Style Analysis**: Analyze any X user's posting style and patterns
- **Single-User Generation**: Create posts that mimic a specific user's voice
- **Style Blending**: Generate posts that combine styles from multiple users
- **Caching**: Automatically stores analyzed profiles for faster generation
- **Pagination Support**: Retrieves up to 100 tweets with API pagination

## 📋 Requirements

- Node.js (v16 or higher)
- Twitter API key from twitterapi.io
- (Optional) Supabase account for persistent storage

## 🔧 Installation & Setup

1. Clone this repository

```bash
git clone https://github.com/yourusername/x-mcp.git
cd x-mcp
```

2. Install dependencies

```bash
npm install
```

3. Create a .env file with your API keys

```
TWITTER_API_KEY=your_twitter_api_key_here
SUPABASE_URL=your_supabase_url_here  # Optional
SUPABASE_KEY=your_supabase_key_here  # Optional
```

4. Run the server

```bash
node server.js
```

## 🔌 Using with Claude Desktop

Add this to your Claude Desktop configuration file (located at ~/Library/Application Support/Claude/claude_desktop_config.json):

```json
{
  "mcpServers": {
    "x-mcp": {
      "command": "node",
      "args": [
        "../x-mcp/server.js"
      ],
      "env": {
        "TWITTER_API_KEY": "",
        "SUPABASE_URL": "",
        "SUPABASE_KEY": ""
      }
    }
  }
}
```

Make sure to replace `D:/DOWNLOAD/x-mcp/server.js` with the absolute path to your server.js file.

## 🛠️ Tools

### analyze_twitter_profile

Analyzes an X user's tweets and caches them for future use.

Parameters:
- username: X handle (without @)
- force_refresh (optional): If true, fetches new data even if cached

### generate_tweet

Generates a post in the style of one or more X users.

Parameters:
- usernames: One or more X handles to mimic (without @)
- topic: The topic to post about

## 📝 Prompts

### analyze-x-user

Analyzes a user's X profile and posting style.

Example:
```
Analyze the X profile and posting style of @elonmusk
```

### generate-in-style

Generates a post about a topic in a specific user's style.

Example:
```
Write a post about AI ethics in the style of @sama
```

### blend-x-styles

Creates a post that blends multiple users' writing styles.

Example:
```
Create a post about cryptocurrency that blends the writing styles of @naval and @balajis
```

## 🧠 How It Works

- The server fetches tweets from the X API, filtering out retweets
- Tweets are normalized into a consistent format
- Stylistic elements (mentions, hashtags, URLs) are extracted
- Posts are stored in memory or Supabase for future use
- When generating, the AI is given examples of the user's posts
- The AI studies the patterns and creates a new post that matches the style

## ⚠️ Limitations

- The X API has rate limits, so frequent use may be restricted
- Without Supabase, cached data is lost when the server restarts
- Some users may not have enough public tweets for accurate style analysis

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
