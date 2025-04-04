// Use correct import paths according to the documentation
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod"; // We'll use zod for schema validation
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

// Custom logging function that writes to stderr instead of stdout
const log = {
  info: (...args) => console.error("[INFO]", ...args),
  warn: (...args) => console.error("[WARN]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
  debug: (...args) => console.error("[DEBUG]", ...args),
};

// Log process environment
log.info("Starting up Twitter Style MCP server...");

// Configure constants and environment variables
const TWITTER_API_BASE = "https://api.twitterapi.io/twitter";
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

log.info(
  `Environment variables loaded. Twitter API: ${
    TWITTER_API_KEY ? "✓" : "✗"
  }, Supabase: ${SUPABASE_URL && SUPABASE_KEY ? "✓" : "✗"}`
);

// Check if API key is loaded
if (!TWITTER_API_KEY) {
  log.error("ERROR: Twitter API key not found in environment variables");

  // Create a simple mock server that explains the issue
  const server = new McpServer({
    name: "twitter-style",
    version: "1.0.0",
  });

  server.tool("setup_instructions", {}, async () => {
    return {
      content: [
        {
          type: "text",
          text: "Twitter API key not properly configured. Please set up either the .env file or edit server.js with your API key.",
        },
      ],
    };
  });

  log.info("Starting MCP server in limited mode...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.exit(1);
}

let supabase = null;
let useDatabase = true;

// Log environment variable status
log.info(`Twitter API Key: ${TWITTER_API_KEY ? "✓ Found" : "✗ Missing"}`);
log.info(`Supabase URL: ${SUPABASE_URL ? "✓ Found" : "✗ Missing"}`);
log.info(`Supabase API Key: ${SUPABASE_KEY ? "✓ Found" : "✗ Missing"}`);

// Check if Supabase credentials are available
if (
  !SUPABASE_URL ||
  !SUPABASE_KEY ||
  SUPABASE_URL === "your-project-id.supabase.co" ||
  SUPABASE_URL === "https://your-project-id.supabase.co" ||
  SUPABASE_KEY === "your-supabase-key-here"
) {
  log.warn(
    "WARNING: Supabase credentials not found or using placeholder values. Running without database persistence."
  );
  useDatabase = false;
} else {
  // Initialize Supabase client
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    log.info("Supabase client initialized successfully");
  } catch (error) {
    log.error("ERROR: Failed to initialize Supabase client:", error.message);
    useDatabase = false;
  }
}

// In-memory profile cache as a fallback
const memoryCache = new Map();

// Cache settings
const CACHE_EXPIRY_HOURS = 24; // Profile data considered fresh for 24 hours

// Create an MCP server
const server = new McpServer({
  name: "twitter-style",
  version: "1.0.0",
});

// ----- Helper Functions -----

/**
 * Make a request to the Twitter API
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Request parameters
 * @returns {Promise<Object>} - API response
 */
async function makeTwitterRequest(endpoint, params) {
  try {
    log.info(`Making request to ${endpoint} with params:`, params);
    const response = await axios.get(`${TWITTER_API_BASE}/${endpoint}`, {
      headers: {
        "X-API-Key": TWITTER_API_KEY,
        Accept: "application/json",
      },
      params,
    });
    log.info(`Response status: ${response.status}`);

    // Check the structure of the response data
    const keys = Object.keys(response.data);
    log.info(`Response data keys: ${keys.join(", ")}`);

    return response.data;
  } catch (error) {
    log.error("Twitter API request failed:", error);
    if (error.response) {
      log.error("Response status:", error.response.status);
      log.error("Response data:", JSON.stringify(error.response.data));
    }
    return {
      status: "error",
      message: `API request failed: ${error.message || "Unknown error"}`,
    };
  }
}

/**
 * Fetch tweets from a user
 * @param {string} username - Twitter handle
 * @param {number} count - Number of tweets to fetch (max 100)
 * @returns {Promise<Array>} - Array of tweets
 */
async function getUserTweets(username, count = 100) {
  // Remove @ symbol if it exists at the beginning of the username
  const cleanUsername = username.startsWith("@")
    ? username.substring(1)
    : username;

  log.info(`Fetching tweets for user: ${cleanUsername}`);

  // Make the initial API request to get tweets
  const response = await makeTwitterRequest("user/last_tweets", {
    userName: cleanUsername,
    cursor: "",
  });

  log.info(`API response status: ${response.status}`);

  // Debug the response structure
  log.info(`Response data structure: ${JSON.stringify(Object.keys(response))}`);

  // Check if the API returned success but with a 'data' property containing tweets
  // This handles the case where the API structure is different from what we expected
  if (response.status === "success" && response.data && response.data.tweets) {
    log.info(
      `Retrieved ${response.data.tweets.length} tweets from 'data' object`
    );
    return response.data.tweets.slice(0, count);
  }

  // Check direct tweets array
  if (
    response.status === "success" &&
    response.tweets &&
    response.tweets.length > 0
  ) {
    log.info(
      `Retrieved ${response.tweets.length} tweets directly from response`
    );
    return response.tweets.slice(0, count);
  }

  // If we reach here, no tweets were found with the expected structure
  // Let's log the actual structure to help debug
  log.info(
    `Unexpected API response structure: ${JSON.stringify(response).substring(
      0,
      500
    )}...`
  );

  return []; // Return empty array if no tweets found
}

/**
 * Normalize tweet data from the API response
 * @param {Object} tweet - Raw tweet object from API
 * @returns {Object} - Normalized tweet data
 */
function normalizeTweetData(tweet) {
  // Handle null or undefined tweets
  if (!tweet) {
    return {
      id: "",
      text: "",
      like_count: 0,
      retweet_count: 0,
      reply_count: 0,
      quote_count: 0,
    };
  }

  // First try with the structure from the example response
  if (tweet.likeCount !== undefined) {
    return {
      id: tweet.id || "",
      text: tweet.text || "",
      like_count: tweet.likeCount || 0,
      retweet_count: tweet.retweetCount || 0,
      reply_count: tweet.replyCount || 0,
      quote_count: tweet.quoteCount || 0,
      created_at: tweet.createdAt || "",
      is_reply: tweet.isReply || false,
      hashtags: extractHashtags(tweet),
      mentions: extractMentions(tweet),
      urls: extractUrls(tweet),
      language: tweet.lang || "",
    };
  }

  // Fallback to generic property access with multiple options
  return {
    id: tweet.id || tweet.tweet_id || "",
    text: tweet.text || tweet.tweet_text || tweet.content || "",
    like_count: tweet.likeCount || tweet.like_count || tweet.favorites || 0,
    retweet_count: tweet.retweetCount || tweet.retweet_count || 0,
    reply_count: tweet.replyCount || tweet.reply_count || 0,
    quote_count: tweet.quoteCount || tweet.quote_count || 0,
    created_at: tweet.createdAt || tweet.created_at || "",
    is_reply: tweet.isReply || tweet.is_reply || false,
    hashtags: extractHashtags(tweet),
    mentions: extractMentions(tweet),
    urls: extractUrls(tweet),
    language: tweet.lang || tweet.language || "",
  };
}

/**
 * Extract hashtags from tweet
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of hashtags
 */
function extractHashtags(tweet) {
  // Try multiple possible locations for hashtags
  if (tweet.entities?.hashtags?.length) {
    return tweet.entities.hashtags.map((h) => h.text || h);
  }

  // If we have text, try to extract hashtags with regex
  if (tweet.text) {
    const hashtagMatches = tweet.text.match(/#(\w+)/g) || [];
    return hashtagMatches.map((tag) => tag.substring(1));
  }

  return [];
}

/**
 * Extract mentions from tweet
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of mentions
 */
function extractMentions(tweet) {
  // Try multiple possible locations for mentions
  if (tweet.entities?.user_mentions?.length) {
    return tweet.entities.user_mentions.map(
      (m) => m.screen_name || m.username || m
    );
  }

  // If we have text, try to extract mentions with regex
  if (tweet.text) {
    const mentionMatches = tweet.text.match(/@(\w+)/g) || [];
    return mentionMatches.map((mention) => mention.substring(1));
  }

  return [];
}

/**
 * Extract URLs from tweet
 * @param {Object} tweet - Tweet object
 * @returns {Array} - Array of URLs
 */
function extractUrls(tweet) {
  // Try multiple possible locations for URLs
  if (tweet.entities?.urls?.length) {
    return tweet.entities.urls.map((u) => u.expanded_url || u.url || u);
  }

  return [];
}

/**
 * Analyze tweets to extract style, tone, and patterns
 * @param {Array} tweets - Array of tweet objects
 * @returns {Object} - Analysis results
 */
function analyzeTweets(tweets) {
  if (!tweets || tweets.length === 0) {
    return { error: "No tweets available for analysis" };
  }

  const normalizedTweets = tweets.map(normalizeTweetData);
  const tweetTexts = normalizedTweets
    .filter((tweet) => tweet.text)
    .map((tweet) => tweet.text);

  const totalLength = tweetTexts.reduce((sum, text) => sum + text.length, 0);
  const avgLength = tweetTexts.length > 0 ? totalLength / tweetTexts.length : 0;

  const hashtagFrequency = {};
  const mentionFrequency = {};

  const hashtagCount = normalizedTweets.reduce(
    (sum, tweet) => sum + (tweet.hashtags?.length || 0),
    0
  );

  const mentionCount = normalizedTweets.reduce(
    (sum, tweet) => sum + (tweet.mentions?.length || 0),
    0
  );

  const exclamationCount = tweetTexts.reduce(
    (sum, text) => sum + (text.match(/!/g) || []).length,
    0
  );

  const questionCount = tweetTexts.reduce(
    (sum, text) => sum + (text.match(/\?/g) || []).length,
    0
  );

  const allCapsWords = tweetTexts.reduce(
    (sum, text) => sum + (text.match(/\b[A-Z]{2,}\b/g) || []).length,
    0
  );

  const metrics = {
    tweet_count: normalizedTweets.length,
    avg_length: parseFloat(avgLength.toFixed(1)),
    hashtag_usage: parseFloat(
      (hashtagCount / normalizedTweets.length).toFixed(2)
    ),
    mention_usage: parseFloat(
      (mentionCount / normalizedTweets.length).toFixed(2)
    ),
    exclamation_frequency: parseFloat(
      (exclamationCount / normalizedTweets.length).toFixed(2)
    ),
    question_frequency: parseFloat(
      (questionCount / normalizedTweets.length).toFixed(2)
    ),
  };

  const style_assessment = {
    formality: avgLength > 120 ? "formal" : "casual",
    hashtag_frequency: metrics.hashtag_usage > 1 ? "high" : "low",
    engagement: metrics.mention_usage > 0.5 ? "high" : "low",
    tone:
      exclamationCount > questionCount
        ? exclamationCount > normalizedTweets.length * 0.3
          ? "emphatic"
          : "assertive"
        : questionCount > normalizedTweets.length * 0.3
        ? "inquisitive"
        : "neutral",
    capitalization:
      allCapsWords > normalizedTweets.length * 0.2 ? "emphatic" : "normal",
  };

  // Style Signature Analysis
  const writingStyle = analyzeWritingStyle(tweetTexts);
  const contentThemes = extractContentThemes(tweetTexts);
  const signatureTraits = detectSignatureTraits(
    metrics,
    writingStyle,
    contentThemes
  );
  const personalityType = inferPersonalityType(signatureTraits);

  const style_signature = {
    writing_style: writingStyle,
    content_focus: contentThemes,
    signature_traits: signatureTraits,
    personality_type: personalityType,
  };

  function extractRepresentativeTweets(normalizedTweets, count = 10) {
    const short = normalizedTweets.filter((t) => t.text.length < 40);
    const long = normalizedTweets.filter((t) => t.text.length > 120);
    const emoji = normalizedTweets.filter((t) =>
      /[\u{1F300}-\u{1F6FF}]/u.test(t.text)
    );
    const questions = normalizedTweets.filter(
      (t) => t.text.includes("?") || t.text.includes("!")
    );

    const set = new Set();
    const addFrom = (arr) => {
      for (const t of arr) {
        if (!set.has(t.text) && t.text.length > 0) set.add(t.text);
        if (set.size >= count) break;
      }
    };

    addFrom(short);
    addFrom(long);
    addFrom(emoji);
    addFrom(questions);
    addFrom(normalizedTweets); // fill the rest

    return Array.from(set).slice(0, count);
  }

  const exampleTweets = extractRepresentativeTweets(normalizedTweets);

  return {
    metrics,
    style_assessment,
    style_signature,
    example_tweets: exampleTweets,
    analyzed_at: new Date().toISOString(),
  };
}

/**
 * Check if a profile exists and is still fresh
 * @param {string} username - Twitter handle
 * @returns {Promise<Object|null>} - Stored profile or null
 */
async function getCachedProfile(username) {
  // First check memory cache
  if (memoryCache.has(username)) {
    const cachedData = memoryCache.get(username);
    const profileDate = new Date(cachedData.created_at);
    const now = new Date();
    const ageHours = (now - profileDate) / (1000 * 60 * 60);

    if (ageHours <= CACHE_EXPIRY_HOURS) {
      log.info(
        `Using in-memory cached profile for ${username} (${ageHours.toFixed(
          1
        )} hours old)`
      );
      return { status: "fresh", profile: cachedData };
    }

    log.info(
      `In-memory profile for ${username} is stale (${ageHours.toFixed(
        1
      )} hours old)`
    );
  }

  // If Supabase is available, check database
  if (useDatabase && supabase) {
    try {
      const { data, error } = await supabase
        .from("twitter_profiles")
        .select("*")
        .eq("handle", username)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      if (!data || data.length === 0) {
        return null;
      }

      const profile = data[0];

      // Check if the profile is still fresh
      const profileDate = new Date(profile.created_at);
      const now = new Date();
      const ageHours = (now - profileDate) / (1000 * 60 * 60);

      if (ageHours > CACHE_EXPIRY_HOURS) {
        log.info(
          `Profile for ${username} is ${ageHours.toFixed(
            1
          )} hours old (older than ${CACHE_EXPIRY_HOURS} hours threshold)`
        );
        return { status: "stale", profile };
      }

      log.info(
        `Using cached profile for ${username} (${ageHours.toFixed(
          1
        )} hours old)`
      );

      // Update the memory cache
      memoryCache.set(username, profile);

      return { status: "fresh", profile };
    } catch (error) {
      log.error("Error retrieving profile from database:", error);
      // Continue to check memory cache as fallback
    }
  }

  return null;
}

/**
 * Store a user profile in storage
 * @param {string} username - Twitter handle
 * @param {Object} profileData - Analysis data
 * @returns {Promise<Object>} - Storage result
 */
async function storeProfile(username, profileData) {
  const profileId = uuidv4();

  const profileRecord = {
    id: profileId,
    handle: username,
    profile_data: profileData,
    created_at: new Date().toISOString(),
  };

  // Always update memory cache
  memoryCache.set(username, profileRecord);

  // If Supabase is available, store in database
  if (useDatabase && supabase) {
    try {
      const { data, error } = await supabase
        .from("twitter_profiles")
        .insert(profileRecord);

      if (error) throw error;

      return { status: "success", profile_id: profileId, storage: "database" };
    } catch (error) {
      log.error("Failed to store profile in database:", error);
      return {
        status: "partial",
        message: `Stored in memory only: ${error.message || "Database error"}`,
        profile_id: profileId,
        storage: "memory",
      };
    }
  }

  return {
    status: "success",
    profile_id: profileId,
    storage: "memory",
    message: "Database not configured, using in-memory storage only",
  };
}

function analyzeWritingStyle(tweetTexts) {
  const allText = tweetTexts.join(" ");
  const sentences = allText.split(/[.!?]+/).filter(Boolean);
  const words = allText.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

  const emojis =
    allText.match(/([\u231A-\uFE0F]|[\uD83C-\uDBFF\uDC00-\uDFFF])/g) || [];
  const exclamations = allText.match(/!/g) || [];
  const questions = allText.match(/\?/g) || [];
  const ellipses = allText.match(/\.\.\./g) || [];
  const allCaps = allText.match(/\b[A-Z]{3,}\b/g) || [];

  const punctuationPatterns = {
    exclamation: exclamations.length,
    question: questions.length,
    ellipsis: ellipses.length,
    all_caps: allCaps.length,
  };

  return {
    avg_sentence_length: parseFloat(
      (words.length / sentences.length).toFixed(1)
    ),
    emoji_usage: parseFloat((emojis.length / tweetTexts.length).toFixed(2)),
    punctuation_patterns: punctuationPatterns,
    capitalization_style:
      allCaps.length > tweetTexts.length * 0.2 ? "emphatic" : "normal",
    word_richness: parseFloat((uniqueWords.size / words.length).toFixed(2)),
  };
}

function extractContentThemes(tweetTexts) {
  const allText = tweetTexts.join(" ").toLowerCase();
  const keywordMap = {
    ai: ["ai", "artificial intelligence", "gpt", "openai", "llm", "chatgpt"],
    crypto: ["bitcoin", "ethereum", "crypto", "web3", "nft", "blockchain"],
    politics: ["biden", "trump", "senate", "law", "policy", "government"],
    tech: ["tesla", "apple", "nasa", "startup", "tech", "software", "hardware"],
    space: ["spacex", "mars", "rocket", "nasa", "elon"],
    humor: ["😂", "🤣", "lol", "funny", "joke", "meme"],
    finance: ["stock", "market", "investment", "money", "nasdaq", "trading"],
    climate: ["climate", "green", "energy", "emissions", "carbon"],
    motivation: ["grind", "hustle", "mindset", "discipline", "success"],
    war: ["ukraine", "russia", "war", "nato", "army", "military"],
    freedom: ["freedom", "liberty", "rights", "speech", "censorship"],
    philosophy: ["truth", "reality", "meaning", "existential", "logic"],
    memes: ["meme", "shitpost", "cringe", "viral", "trend"],
  };

  const themes = Object.entries(keywordMap)
    .filter(([_, keywords]) => keywords.some((kw) => allText.includes(kw)))
    .map(([theme]) => theme);

  return themes;
}

function detectSignatureTraits(metrics, writingStyle, contentThemes) {
  const traits = [];

  if (metrics.avg_length < 50) traits.push("minimalist");
  if (metrics.exclamation_frequency > 0.2) traits.push("emphatic");
  if (writingStyle.emoji_usage > 0.1) traits.push("expressive");
  if (contentThemes.includes("humor") || contentThemes.includes("memes"))
    traits.push("humorous");
  if (metrics.mention_usage > 0.6) traits.push("connector");

  return traits;
}

function inferPersonalityType(traits) {
  if (traits.includes("minimalist") && traits.includes("emphatic"))
    return "the provocateur";
  if (traits.includes("connector") && traits.includes("expressive"))
    return "the influencer";
  if (traits.includes("humorous")) return "the memer";
  if (traits.includes("expressive") && traits.includes("minimalist") === false)
    return "the poet";

  return "the poster";
}

/**
 * Build style guidance for a single user
 * @param {string} username - Twitter handle
 * @param {Object} profileData - Analysis data
 * @returns {string} - Formatted style guidance
 */
function buildStyleGuidance(username, profileData) {
  const metrics = profileData.metrics || {};
  const style = profileData.style_assessment || {};
  const signature = profileData.style_signature || {};
  const examples = profileData.example_tweets || [];

  let guidance = `Tweet Style Profile: @${username}\n\n`;

  guidance += `WRITING PATTERNS:\n`;
  guidance += `- Average tweet length: ${metrics.avg_length} characters\n`;
  guidance += `- Sentence length: ${
    signature.writing_style?.avg_sentence_length || "?"
  } words\n`;
  guidance += `- Emoji usage: ${
    signature.writing_style?.emoji_usage || 0
  } per tweet\n`;
  guidance += `- Word variety (richness): ${
    signature.writing_style?.word_richness || 0
  }\n`;
  guidance += `- Capitalization: ${
    signature.writing_style?.capitalization_style || "normal"
  }\n`;
  guidance += `- Punctuation usage: ${Object.entries(
    signature.writing_style?.punctuation_patterns || {}
  )
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")}\n\n`;

  guidance += `STYLE & TONE:\n`;
  guidance += `- Tone: ${style.tone || "neutral"}\n`;
  guidance += `- Formality: ${style.formality || "casual"}\n\n`;

  if (signature.content_focus?.length > 0) {
    guidance += `CONTENT THEMES:\n`;
    signature.content_focus.forEach((theme) => {
      guidance += `- ${theme}\n`;
    });
    guidance += `\n`;
  }

  if (examples.length > 0) {
    guidance += `REPRESENTATIVE TWEETS:\n`;
    examples.slice(0, 10).forEach((tweet, i) => {
      guidance += `${i + 1}. "${tweet}"\n`;
    });
  }

  return guidance.trim();
}

/**
 * Build style guidance for mixing two users' styles
 * @param {string} username1 - First Twitter handle
 * @param {Object} profile1Data - First user's analysis data
 * @param {string} username2 - Second Twitter handle
 * @param {Object} profile2Data - Second user's analysis data
 * @returns {string} - Formatted mixed style guidance
 */
function buildMixedStyleGuidance(
  username1,
  profile1Data,
  username2,
  profile2Data
) {
  const style1 = profile1Data.style_assessment || {};
  const style2 = profile2Data.style_assessment || {};
  const metrics1 = profile1Data.metrics || {};
  const metrics2 = profile2Data.metrics || {};
  const sig1 = profile1Data.style_signature || {};
  const sig2 = profile2Data.style_signature || {};

  const avgLength = Math.round((metrics1.avg_length + metrics2.avg_length) / 2);
  const avgHashtags = Math.max(
    1,
    Math.round((metrics1.hashtag_usage + metrics2.hashtag_usage) / 2)
  );
  const avgMentions = Math.round(
    (metrics1.mention_usage + metrics2.mention_usage) / 2
  );

  const mixedTones = [style1.tone, style2.tone].filter(Boolean).join(" + ");
  const mixedFormality = [style1.formality, style2.formality]
    .filter(Boolean)
    .join(" / ");
  const mixedTraits = [
    ...new Set([
      ...(sig1.signature_traits || []),
      ...(sig2.signature_traits || []),
    ]),
  ];

  let guidance = `STYLE MIXING INSTRUCTIONS\n\n`;

  guidance += `🔀 Blended Tweet Style of @${username1} + @${username2}\n\n`;
  guidance += `- Target length: ~${avgLength} characters\n`;
  guidance += `- Formality: ${mixedFormality}\n`;
  guidance += `- Tone: ${mixedTones}\n`;
  guidance += `- Hashtags per tweet: ~${avgHashtags}\n`;
  guidance += `- Mentions per tweet: ~${avgMentions}\n`;
  guidance += `- Combined signature traits: ${
    mixedTraits.join(", ") || "None"
  }\n\n`;

  guidance += `—— STYLE SNAPSHOTS ——\n\n`;
  guidance += `@${username1}:\n${buildStyleGuidance(
    username1,
    profile1Data
  )}\n\n`;
  guidance += `@${username2}:\n${buildStyleGuidance(
    username2,
    profile2Data
  )}\n`;

  return guidance.trim();
}

/**
 * Get human-readable time ago string
 * @param {string} dateString - ISO date string
 * @returns {string} - Human readable time ago
 */
function getTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;

  // Convert to appropriate units
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  } else if (diffMins > 0) {
    return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  } else {
    return `${diffSecs} second${diffSecs !== 1 ? "s" : ""} ago`;
  }
}

// Add a diagnostic tool to check configuration
server.tool("check_server_config", {}, async () => {
  return {
    content: [
      {
        type: "text",
        text: `
Server Configuration Status:

- Twitter API: ${TWITTER_API_KEY ? "✓ Configured" : "✗ Missing"}
- Database: ${useDatabase ? "✓ Enabled" : "✗ Disabled"}
- Storage Mode: ${
          useDatabase ? "Database (Supabase)" : "Memory only (temporary)"
        }
- Cache TTL: ${CACHE_EXPIRY_HOURS} hours
- In-Memory Cache Size: ${memoryCache.size} profiles
          `,
      },
    ],
  };
});

// ----- Define MCP Tools -----

// Add the analyze_twitter_profile tool
server.tool(
  "analyze_twitter_profile",
  {
    username: z.string().describe("Twitter handle (without @)"),
    force_refresh: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, fetch new data even if profile exists in database"),
  },
  async ({ username, force_refresh = false }) => {
    // Check cache first unless force_refresh is true
    if (!force_refresh) {
      const cachedResult = await getCachedProfile(username);

      if (cachedResult && cachedResult.status === "fresh") {
        return {
          content: [
            {
              type: "text",
              text: `Using cached profile data for @${username} (analyzed ${getTimeAgo(
                cachedResult.profile.created_at
              )}):\n\n${JSON.stringify(
                cachedResult.profile.profile_data,
                null,
                2
              )}`,
            },
          ],
        };
      }

      // If we have a stale profile but API call fails, we can fall back to it
      const staleProfile = cachedResult?.profile;

      if (cachedResult && cachedResult.status === "stale") {
        log.info(`Found stale profile for ${username}, fetching fresh data...`);
      }
    }

    // Fetch tweets
    log.info(`Fetching tweets for ${username}...`);
    const tweets = await getUserTweets(username);

    if (!tweets || tweets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Unable to fetch tweets for this user. The user may not exist or have no public tweets.",
          },
        ],
        isError: true,
      };
    }

    // Analyze tweets
    log.info(`Analyzing ${tweets.length} tweets for ${username}...`);
    const analysis = analyzeTweets(tweets);

    // Store the profile
    const storageResult = await storeProfile(username, analysis);

    if (storageResult.status === "error") {
      log.warn(
        "Analysis completed but failed to store results:",
        storageResult.message
      );
    } else {
      log.info(
        `Stored new profile for ${username} (storage: ${storageResult.storage})`
      );
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(analysis, null, 2),
        },
      ],
    };
  }
);

// Add the generate_tweet tool
server.tool(
  "generate_tweet",
  {
    style_username: z.string().describe("Twitter handle to mimic (without @)"),
    topic: z.string().describe("Topic to tweet about"),
  },
  async ({ style_username, topic }) => {
    // Fetch the profile data
    log.info(`Getting profile for ${style_username}...`);
    const cachedResult = await getCachedProfile(style_username);

    // If we don't have the profile or it's stale, analyze it
    if (!cachedResult || cachedResult.status === "stale") {
      log.info(`No fresh profile found for ${style_username}, analyzing...`);
      const tweets = await getUserTweets(style_username);

      if (!tweets || tweets.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch tweets for @${style_username}. The user may not exist or have no public tweets.`,
            },
          ],
          isError: true,
        };
      }

      const analysis = analyzeTweets(tweets);
      await storeProfile(style_username, analysis);

      // Construct style guidance
      const styleGuidance = buildStyleGuidance(style_username, analysis);

      return {
        content: [
          {
            type: "text",
            text: `Based on @${style_username}'s style, here's my tweet about ${topic}:\n\n[The LLM will generate a tweet here based on the style analysis]\n\n${styleGuidance}`,
          },
        ],
      };
    } else {
      // Use cached profile
      const profileData = cachedResult.profile.profile_data;
      const styleGuidance = buildStyleGuidance(style_username, profileData);

      return {
        content: [
          {
            type: "text",
            text: `Based on @${style_username}'s style, here's my tweet about ${topic}:\n\n[The LLM will generate a tweet here based on the style analysis]\n\n${styleGuidance}`,
          },
        ],
      };
    }
  }
);

// Add the mix_twitter_styles tool
server.tool(
  "mix_twitter_styles",
  {
    username1: z.string().describe("First Twitter handle to mix (without @)"),
    username2: z.string().describe("Second Twitter handle to mix (without @)"),
    topic: z.string().describe("Topic to tweet about"),
  },
  async ({ username1, username2, topic }) => {
    // Fetch both profiles
    const cachedResult1 = await getCachedProfile(username1);
    const cachedResult2 = await getCachedProfile(username2);

    // Get or create first profile
    let profile1Data;
    if (!cachedResult1 || cachedResult1.status === "stale") {
      log.info(`No fresh profile found for ${username1}, analyzing...`);
      const tweets1 = await getUserTweets(username1);

      if (!tweets1 || tweets1.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch tweets for @${username1}. The user may not exist or have no public tweets.`,
            },
          ],
          isError: true,
        };
      }

      profile1Data = analyzeTweets(tweets1);
      await storeProfile(username1, profile1Data);
    } else {
      profile1Data = cachedResult1.profile.profile_data;
    }

    // Get or create second profile
    let profile2Data;
    if (!cachedResult2 || cachedResult2.status === "stale") {
      log.info(`No fresh profile found for ${username2}, analyzing...`);
      const tweets2 = await getUserTweets(username2);

      if (!tweets2 || tweets2.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Could not fetch tweets for @${username2}. The user may not exist or have no public tweets.`,
            },
          ],
          isError: true,
        };
      }

      profile2Data = analyzeTweets(tweets2);
      await storeProfile(username2, profile2Data);
    } else {
      profile2Data = cachedResult2.profile.profile_data;
    }

    // Create guidance on mixing the two styles
    const mixedStyleGuidance = buildMixedStyleGuidance(
      username1,
      profile1Data,
      username2,
      profile2Data
    );

    return {
      content: [
        {
          type: "text",
          text: `Based on a mix of @${username1} and @${username2}'s styles, here's my tweet about ${topic}:\n\n[The LLM will generate a tweet here based on the mixed style analysis]\n\n${mixedStyleGuidance}`,
        },
      ],
    };
  }
);

// ----- Define MCP Prompts -----

// Add the analyze-twitter-user prompt
server.prompt(
  "analyze-twitter-user",
  {
    username: z.string().describe("Twitter handle (without @)"),
  },
  ({ username }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Analyze the Twitter profile and posting style of @${username}. Please run the analyze_twitter_profile tool to gather data about their tweets, and then provide insights about their writing style, topics they focus on, and what makes their tweets unique.`,
        },
      },
    ],
  })
);

// Add the generate-in-style prompt
server.prompt(
  "generate-in-style",
  {
    username: z.string().describe("Twitter handle to mimic (without @)"),
    topic: z.string().describe("Topic to tweet about"),
  },
  ({ username, topic }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Write a tweet about ${topic} in the style of @${username}. Use the generate_tweet tool to get style guidance based on their past tweets, then craft a tweet that feels authentic to their voice.`,
        },
      },
    ],
  })
);

// Add the blend-twitter-styles prompt
server.prompt(
  "blend-twitter-styles",
  {
    username1: z.string().describe("First Twitter handle (without @)"),
    username2: z.string().describe("Second Twitter handle (without @)"),
    topic: z.string().describe("Topic to tweet about"),
  },
  ({ username1, username2, topic }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Create a tweet about ${topic} that blends the writing styles of @${username1} and @${username2}. Use the mix_twitter_styles tool to get style guidance on both accounts, then write a tweet that captures elements from both.`,
        },
      },
    ],
  })
);

// Start the server
log.info("Starting Twitter Style MCP server...");
const transport = new StdioServerTransport();
await server.connect(transport);
