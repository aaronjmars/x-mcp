# Twitter Style MCP Server

An MCP server for Twitter/X style analysis and post generation, enabling AI models to analyze users' Twitter posting style and generate new content that matches their distinctive voice.

## Features

- **Style Analysis**: Analyze a Twitter user's posting patterns, tone, and unique style traits
- **Post Generation**: Create new tweets on any topic in the style of a specific user
- **Style Mixing**: Blend the styles of two different Twitter users
- **Cached Profiles**: Store analyzed profiles for fast retrieval (Supabase or in-memory)
- **Deep Style Metrics**: Detailed breakdown of writing patterns, punctuation use, emoji frequency, and more

## Tools

### `analyze_twitter_profile`

Analyze a Twitter user's posting style.

**Inputs:**
- `username` (string): Twitter handle (without @)
- `force_refresh` (optional boolean): If true, fetch new data even if profile exists in database

**Returns:** Complete style analysis including:
- Tweet metrics (length, hashtag usage, mentions)
- Style assessment (formality, tone, engagement level)
- Writing style patterns (sentence length, emoji usage, punctuation)
- Content themes and signature traits
- Representative tweet examples

### `generate_tweet`

Generate a tweet on a specific topic in the style of a Twitter user.

**Inputs:**
- `style_username` (string): Twitter handle to mimic (without @)
- `topic` (string): Topic to tweet about

**Returns:** A generated tweet with detailed style guidance used to create it

### `mix_twitter_styles`

Generate content by blending the styles of two different Twitter users.

**Inputs:**
- `username1` (string): First Twitter handle to mix (without @)
- `username2` (string): Second Twitter handle to mix (without @)
- `topic` (string): Topic to tweet about

**Returns:** A tweet in the blended style with detailed guidance on how the styles were combined

### `check_server_config`

Diagnostic tool to verify server configuration.

**Returns:** Configuration status including Twitter API connectivity and database settings

## Prompts

### `analyze-twitter-user`

Prompt for detailed analysis of a Twitter user's posting style.

**Arguments:**
- `username` (string): Twitter handle to analyze (without @)

### `generate-in-style`

Prompt to create a tweet in the style of a specific Twitter user.

**Arguments:**
- `username` (string): Twitter handle to mimic (without @)
- `topic` (string): Topic to tweet about

### `blend-twitter-styles`

Prompt to generate content mixing two Twitter users' styles.

**Arguments:**
- `username1` (string): First Twitter handle (without @)
- `username2` (string): Second Twitter handle (without @)
- `topic` (string): Topic to tweet about

## Style Analysis Metrics

The server analyzes numerous dimensions of a Twitter user's style:

- **Basic Metrics**
  - Average tweet length
  - Hashtag frequency
  - Mention frequency
  - Question/exclamation usage

- **Style Assessment**
  - Formality level (casual to formal)
  - Tone (neutral, emphatic, assertive, inquisitive)
  - Engagement patterns (high/low)
  - Capitalization style (normal/emphatic)

- **Writing Style**
  - Sentence structure and length
  - Emoji usage
  - Punctuation patterns
  - Word variety and richness

- **Content Analysis**
  - Common themes (politics, tech, humor, etc.)
  - Signature traits (minimalist, emphatic, expressive, humorous)
  - Personality type classification

## Setup

### Prerequisites
- Node.js 16+
- Twitter API credentials
- (Optional) Supabase account for database persistence

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TWITTER_API_KEY` | API key for twitterapi.io | Yes |
| `SUPABASE_URL` | Supabase project URL | No* |
| `SUPABASE_KEY` | Supabase API key | No* |

\* *Without Supabase credentials, the server will run in memory-only mode (profiles are lost on restart)*

### Installation

```bash
# Install dependencies
npm install

# Start the server
node server.js
```

### Usage with Claude Desktop

To use this with Claude Desktop, add the following to your `claude_desktop_config.json`:

#### NODE

```json
{
  "mcpServers": {
    "twitter-style": {
      "command": "node",
      "args": [
        ""
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

### Supabase Schema

If using Supabase for persistence, create a table with the following schema:

```sql
CREATE TABLE twitter_profiles (
  id UUID PRIMARY KEY,
  handle TEXT NOT NULL,
  profile_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX twitter_profiles_handle_idx ON twitter_profiles(handle);
```

## Example Usage

### Analyzing a Twitter User's Style

Use the `analyze_twitter_profile` tool to analyze a Twitter user's posting style:

```
Please analyze the Twitter posting style of @elonmusk using the twitter-style MCP server.
```

### Generating a Tweet in a User's Style

Use the `generate_tweet` tool to create content in a specific user's style:

```
Generate a tweet about climate change in the style of @AOC using the twitter-style MCP server.
```

### Blending Styles from Two Users

Use the `mix_twitter_styles` tool to blend two different Twitter styles:

```
Create a tweet about space exploration that blends the styles of @neiltyson and @elonmusk using the twitter-style MCP server.
```

## How It Works

1. **Data Collection**: The server fetches recent tweets from the Twitter API
2. **Style Analysis**: Tweets are processed to extract patterns, tone, and distinctive traits
3. **Profile Storage**: Analysis results are cached in Supabase or memory
4. **Style Guidance**: When generating content, detailed style guidance is provided
5. **Blending**: When mixing styles, the server creates a weighted combination of both profiles

## License

This MCP server is licensed under the MIT License.