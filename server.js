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
log.info("Starting up X Style MCP server...");

// Configure constants and environment variables
const TWITTER_API_BASE = "https://api.twitterapi.io/twitter";
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

log.info(
  `Environment variables loaded. X API: ${
    TWITTER_API_KEY ? "✓" : "✗"
  }, Supabase: ${SUPABASE_URL && SUPABASE_KEY ? "✓" : "✗"}`
);

// Check if API key is loaded
if (!TWITTER_API_KEY) {
  log.error("ERROR: X API key not found in environment variables");

  // Create a simple mock server that explains the issue
  const server = new McpServer({
    name: "x-style",
    version: "1.0.0",
  });

  server.tool("setup_instructions", {}, async () => {
    return {
      content: [
        {
          type: "text",
          text: "X API key not properly configured. Please set up either the .env file or edit server.js with your API key.",
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
log.info(`X API Key: ${TWITTER_API_KEY ? "✓ Found" : "✗ Missing"}`);
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
  name: "x-style",
  version: "1.0.0",
});

// ----- Helper Functions -----

/**
 * Make a request to the X API
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
    log.error("X API request failed:", error);
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
 * Fetch posts from a user with pagination
 * @param {string} username - X handle
 * @param {number} targetCount - Number of posts to fetch
 * @returns {Promise<Array>} - Array of posts
 */
async function getUserTweets(username, targetCount = 100) {
  // Remove @ symbol if it exists at the beginning of the username
  const cleanUsername = username.startsWith("@")
    ? username.substring(1)
    : username;

  log.info(`Fetching posts for user: ${cleanUsername}`);

  let allTweets = [];
  let cursor = "";
  let hasMore = true;
  let requestCount = 0;
  const MAX_REQUESTS = 5; // Limit to 5 requests to avoid excessive API usage

  // Loop until we have enough posts or reach the request limit
  while (hasMore && allTweets.length < targetCount && requestCount < MAX_REQUESTS) {
    // Make the API request with cursor for pagination
    const response = await makeTwitterRequest("user/last_tweets", {
      userName: cleanUsername,
      cursor: cursor,
    });

    requestCount++;
    log.info(`Pagination request #${requestCount}, cursor: ${cursor}`);

    if (response.status !== "success") {
      log.error(`API request failed: ${JSON.stringify(response)}`);
      break;
    }

    // Extract posts from the response
    let pageTweets = [];
    if (response.data && response.data.tweets) {
      pageTweets = response.data.tweets;
    } else if (response.tweets) {
      pageTweets = response.tweets;
    } else {
      log.error("No posts found in response");
      break;
    }

    // Filter out reposts
    const originalTweets = pageTweets.filter(tweet => {
      // Check various possible indicators of a repost
      return !(
        (tweet.text && tweet.text.startsWith("RT @")) || 
        tweet.isRetweet === true || 
        tweet.retweeted === true
      );
    });

    allTweets = [...allTweets, ...originalTweets];
    log.info(`Retrieved ${originalTweets.length} original posts, total: ${allTweets.length}`);

    // Check if there are more posts to fetch
    if (response.data && response.data.next_cursor) {
      cursor = response.data.next_cursor;
      hasMore = cursor !== "";
    } else if (response.next_cursor) {
      cursor = response.next_cursor;
      hasMore = cursor !== "";
    } else {
      hasMore = false;
    }

    // If we got no posts in this batch, stop paging
    if (pageTweets.length === 0) {
      hasMore = false;
    }
  }

  log.info(`Finished fetching ${allTweets.length} posts for ${cleanUsername}`);
  return allTweets.slice(0, targetCount);
}

/**
 * Normalize post data from the API response
 * @param {Object} tweet - Raw post object from API
 * @returns {Object} - Normalized post data
 */
function normalizeTweetData(tweet) {
  // Handle null or undefined posts
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
 * Extract hashtags from post
 * @param {Object} tweet - Post object
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
 * Extract mentions from post
 * @param {Object} tweet - Post object
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
 * Extract URLs from post
 * @param {Object} tweet - Post object
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
 * Store a user profile with raw posts in Supabase
 * @param {string} username - X handle
 * @param {Array} tweets - Raw post data
 * @returns {Promise<Object>} - Storage result
 */
async function storeUserTweets(username, tweets) {
  const profileId = uuidv4();

  // Process posts to ensure they're in a consistent format
  const simplifiedTweets = tweets.map(tweet => {
    // Normalize post data to ensure consistent structure
    const normalized = normalizeTweetData(tweet);
    // Return only the fields we need
    return {
      id: normalized.id,
      text: normalized.text,
      created_at: normalized.created_at
    };
  });

  // Create the profile data object with posts inside it
  const profileData = {
    tweets: simplifiedTweets,
    analyzed_at: new Date().toISOString()
  };

  // Create the record to store in the database
  const profileRecord = {
    id: profileId,
    handle: username,
    profile_data: profileData,  // Store posts inside profile_data
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

      if (error) {
        log.error("Supabase error:", error);
        throw error;
      }

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

/**
 * Check if a profile exists and is still fresh
 * @param {string} username - X handle
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

      // Validate profile data structure to avoid errors
      if (!profile.profile_data || !profile.profile_data.tweets) {
        log.warn(`Invalid profile structure for ${username}, missing tweets in profile_data`);
        return { status: "invalid", profile };
      }

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

// ----- Define MCP Tools -----

/**
 * Analyze X profile tool
 */
server.tool(
  "analyze_twitter_profile",
  {
    username: z.string().describe("X handle (without @)"),
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
        // Safely access and return cached data
        try {
          const tweets = cachedResult.profile.profile_data?.tweets || [];
          const tweetCount = tweets.length || 0;
          
          return {
            content: [
              {
                type: "text",
                text: `Using cached posts for @${username} (fetched ${getTimeAgo(
                  cachedResult.profile.created_at
                )}). ${tweetCount} posts available.`,
              },
            ],
          };
        } catch (error) {
          log.error(`Error processing cached profile for ${username}: ${error.message}`);
          // If there's an error processing the cache, we'll fetch fresh data instead
          log.info(`Falling back to fetching fresh data for ${username}`);
          // Continue to the code below to fetch fresh data
        }
      }
    }

    // Fetch posts
    log.info(`Fetching posts for ${username}...`);
    const tweets = await getUserTweets(username);

    if (!tweets || tweets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Unable to fetch posts for this user. The user may not exist or have no public posts.",
          },
        ],
        isError: true,
      };
    }

    // Store the posts
    const storageResult = await storeUserTweets(username, tweets);

    if (storageResult.status === "error") {
      log.warn(
        "Posts fetched but failed to store results:",
        storageResult.message
      );
    } else {
      log.info(
        `Stored ${tweets.length} posts for ${username} (storage: ${storageResult.storage})`
      );
    }

    // Return basic stats about the posts
    return {
      content: [
        {
          type: "text",
          text: `Successfully fetched and stored ${tweets.length} posts for @${username}. These will be used for post generation.`,
        },
      ],
    };
  }
);

/**
 * Generate post in the style of user(s)
 * Merged functionality of generate_tweet and mix_twitter_styles
 */
server.tool(
  "generate_tweet",
  {
    usernames: z.array(z.string()).describe("Array of X handles to mimic (without @)"),
    topic: z.string().describe("Topic to post about"),
  },
  async ({ usernames, topic }) => {
    // Handle single string case for backward compatibility
    if (typeof usernames === 'string') {
      usernames = [usernames];
    }
    
    // Ensure usernames is an array
    if (!Array.isArray(usernames)) {
      usernames = [usernames];
    }
    
    if (!usernames || usernames.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Please provide at least one X username to analyze.",
          },
        ],
        isError: true,
      };
    }

    // Results array to collect all posts
    const userTweets = [];

    // Process each username
    for (const username of usernames) {
      log.info(`Getting profile for ${username}...`);
      const cachedResult = await getCachedProfile(username);

      let tweets = [];
      // If we don't have the profile or it's stale, fetch new posts
      if (!cachedResult || cachedResult.status === "stale" || cachedResult.status === "invalid") {
        log.info(`No fresh posts found for ${username}, fetching...`);
        const fetchedTweets = await getUserTweets(username, 100);

        if (!fetchedTweets || fetchedTweets.length === 0) {
          log.warn(`Could not fetch posts for @${username}. Skipping this user.`);
          continue; // Skip this user but continue with others
        }

        await storeUserTweets(username, fetchedTweets);
        tweets = fetchedTweets.map(tweet => normalizeTweetData(tweet));
      } else {
        // Use cached profile - now safely accessing the posts inside profile_data
        log.info(`Using cached profile for ${username}`);
        if (cachedResult.profile.profile_data && cachedResult.profile.profile_data.tweets) {
          tweets = cachedResult.profile.profile_data.tweets;
        } else if (cachedResult.profile.tweets) {
          tweets = cachedResult.profile.tweets;
        } else {
          log.warn(`Cached profile for ${username} has invalid structure, fetching new data`);
          const fetchedTweets = await getUserTweets(username, 100);
          
          if (!fetchedTweets || fetchedTweets.length === 0) {
            log.warn(`Could not fetch posts for @${username}. Skipping this user.`);
            continue;
          }
          
          await storeUserTweets(username, fetchedTweets);
          tweets = fetchedTweets.map(tweet => normalizeTweetData(tweet));
        }
      }
      
      // Debug log
      log.info(`Retrieved ${tweets.length} posts for ${username}`);
      
      // Filter out reposts and get examples per user (up to 15 for better style capture)
      const examples = tweets
        .map(t => {
          // Handle different possible post formats
          if (typeof t === 'string') return t;
          if (typeof t === 'object' && t !== null) {
            return t.text || (t.full_text || t.tweet_text || '');
          }
          return '';
        })
        .filter(text => text && typeof text === 'string' && !text.startsWith("RT @"))
        .slice(0, 15);
      
      if (examples.length > 0) {
        userTweets.push({
          username: username,
          examples: examples
        });
      }
    }

    // If we couldn't get posts for any users, return an error
    if (userTweets.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Could not retrieve posts for any of the specified users.",
          },
        ],
        isError: true,
      };
    }

    // Build the prompt for post generation
    let prompt;
    
    // Single user case
    if (userTweets.length === 1) {
      const username = userTweets[0].username;
      const tweetExamples = userTweets[0].examples.join("\n\n");
      
      prompt = `You are tasked with creating a post in the distinct style of @${username}. Study their writing patterns, tone, vocabulary, emoji usage, and formatting from these sample posts, then create an authentic post about ${topic} that perfectly captures their voice.\n\nSample posts:\n\n${tweetExamples}\n\nYour generated post about ${topic} (ONLY return the post text with no explanations):`;
    }
    // Multiple users case - style blending
    else {
      prompt = `You are tasked with creating a post that perfectly blends the distinct styles of `;
      
      // Add usernames to the prompt
      if (userTweets.length === 2) {
        prompt += `@${userTweets[0].username} and @${userTweets[1].username}`;
      } else {
        const lastUser = userTweets[userTweets.length - 1].username;
        const otherUsers = userTweets.slice(0, -1).map(ut => `@${ut.username}`).join(", ");
        prompt += `${otherUsers}, and @${lastUser}`;
      }
      
      prompt += `. Study their writing patterns, tone, vocabulary, emoji usage, and formatting from the sample posts below.\n\n`;
      prompt += `Create an authentic post about ${topic} that blends elements from each of their unique voices.\n\n`;

      // Add examples from each user
      for (const userTweet of userTweets) {
        prompt += `Posts by @${userTweet.username}:\n${userTweet.examples.join("\n\n")}\n\n`;
      }
      
      prompt += `Your blended-style post about ${topic} (ONLY return the post text with no explanations):`;
    }

    return {
      content: [
        {
          type: "text",
          text: prompt,
        },
      ],
    };
  }
);

// ----- Define MCP Prompts -----

// Add the analyze-x-user prompt
server.prompt(
  "analyze-x-user",
  {
    username: z.string().describe("X handle (without @)"),
  },
  ({ username }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Analyze the X profile and posting style of @${username}. Please run the analyze_twitter_profile tool to gather data about their posts, and then provide insights about their writing style, topics they focus on, and what makes their posts unique.`,
        },
      },
    ],
  })
);

// Add the generate-in-style prompt
server.prompt(
  "generate-in-style",
  {
    username: z.string().describe("X handle to mimic (without @)"),
    topic: z.string().describe("Topic to post about"),
  },
  ({ username, topic }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Write a post about ${topic} in the style of @${username}. Use the generate_tweet tool to get style guidance based on their past posts, then craft a post that feels authentic to their voice.`,
        },
      },
    ],
  })
);

// Add the blend-x-styles prompt
server.prompt(
  "blend-x-styles",
  {
    usernames: z.array(z.string()).describe("Array of X handles to mix (without @)"),
    topic: z.string().describe("Topic to post about"),
  },
  ({ usernames, topic }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Create a post about ${topic} that blends the writing styles of the specified X users. Use the generate_tweet tool with multiple usernames to get style guidance, then write a post that captures elements from all the styles.`,
        },
      },
    ],
  })
);

// Start the server
log.info("Starting X Style MCP server...");
const transport = new StdioServerTransport();
await server.connect(transport);