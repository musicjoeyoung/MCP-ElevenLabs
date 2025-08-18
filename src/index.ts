import * as schema from "./db/schema";

import { createFiberplane, createOpenAPISpec } from "@fiberplane/hono";
import { desc, eq } from "drizzle-orm";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
  AI: Ai;
  ELEVENLABS_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Voice IDs for the two personas
const MAYA_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Female co-host (Maya)
const JORDAN_VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Male co-host (Jordan)

function createMcpServer(env: Bindings) {
  const server = new McpServer({
    name: "ai-podcast-generator",
    version: "1.0.0",
    description: "Generate AI-powered podcast conversations from content analysis"
  });

  const db = drizzle(env.DB);

  // Generate podcast tool
  server.tool(
    "generate_podcast",
    {
      content: z.string().min(1).describe("The source content to analyze"),
      content_type: z.enum(["code", "file", "discussion", "project"]).describe("Type of content being analyzed"),
      title: z.string().optional().describe("Custom title for the podcast"),
      focus_areas: z.array(z.string()).optional().describe("Specific topics to emphasize")
    },
    async ({ content, content_type, title, focus_areas }) => {
      try {
        // Create episode record
        const [episode] = await db.insert(schema.episodes).values({
          title: title || `AI Podcast: ${content_type} Analysis`,
          description: `Generated podcast discussing ${content_type} content`,
          script: "", // Will be updated after generation
          status: "generating"
        }).returning();

        // Create generation request record
        await db.insert(schema.generationRequests).values({
          episodeId: episode.id,
          sourceType: content_type,
          sourceContent: content,
          sourceMetadata: { focus_areas }
        });

        // Generate script synchronously
        const result = await generatePodcastScript(env, episode.id, content, content_type, focus_areas);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              episode_id: episode.id,
              status: result.success ? "completed" : "failed",
              message: result.success ? "Podcast generated successfully!" : result.error,
              audio_url: result.success ? `/audio/${episode.id}` : null
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error generating podcast: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // Get podcast status tool
  server.tool(
    "get_podcast_status",
    {
      episode_id: z.string().describe("The episode ID to check")
    },
    async ({ episode_id }) => {
      try {
        const [episode] = await db.select()
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episode_id));

        if (!episode) {
          return {
            content: [{
              type: "text",
              text: "Episode not found"
            }],
            isError: true
          };
        }

        const result = {
          episode_id: episode.id,
          title: episode.title,
          status: episode.status,
          duration_seconds: episode.durationSeconds,
          audio_url: episode.audioFileKey ? `/audio/${episode.id}` : null,
          created_at: episode.createdAt,
          updated_at: episode.updatedAt
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error checking status: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // List podcasts tool
  server.tool(
    "list_podcasts",
    {
      limit: z.number().min(1).max(100).default(10).describe("Maximum number of results"),
      offset: z.number().min(0).default(0).describe("Pagination offset")
    },
    async ({ limit, offset }) => {
      try {
        const episodes = await db.select({
          id: schema.episodes.id,
          title: schema.episodes.title,
          description: schema.episodes.description,
          status: schema.episodes.status,
          durationSeconds: schema.episodes.durationSeconds,
          createdAt: schema.episodes.createdAt,
          audioFileKey: schema.episodes.audioFileKey
        })
          .from(schema.episodes)
          .orderBy(desc(schema.episodes.createdAt))
          .limit(limit)
          .offset(offset);

        const result = episodes.map(episode => ({
          episode_id: episode.id,
          title: episode.title,
          description: episode.description,
          status: episode.status,
          duration_seconds: episode.durationSeconds,
          audio_url: episode.audioFileKey ? `/audio/${episode.id}` : null,
          created_at: episode.createdAt
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error listing podcasts: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  // Get podcast script tool
  server.tool(
    "get_podcast_script",
    {
      episode_id: z.string().describe("The episode ID")
    },
    async ({ episode_id }) => {
      try {
        const [episode] = await db.select()
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episode_id));

        if (!episode) {
          return {
            content: [{
              type: "text",
              text: "Episode not found"
            }],
            isError: true
          };
        }

        return {
          content: [{
            type: "text",
            text: episode.script || "Script not yet generated"
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Error retrieving script: ${error instanceof Error ? error.message : "Unknown error"}`
          }],
          isError: true
        };
      }
    }
  );

  return server;
}

// Async function to generate podcast script and audio
async function generatePodcastScript(env: Bindings, episodeId: string, content: string, contentType: string, focusAreas?: string[]): Promise<{ success: boolean; error?: string }> {
  const db = drizzle(env.DB);

  try {
    const focusText = focusAreas && focusAreas.length > 0
      ? `Focus particularly on these areas: ${focusAreas.join(", ")}.`
      : "";

    const prompt = `You are creating a script for a FULL 3-5 minute podcast conversation between two enthusiastic AI co-hosts who review and spotlight interesting projects, applications, and content:

- Maya: An energetic female AI co-host who loves discovering innovative projects and asking engaging questions
- Jordan: An enthusiastic male AI co-host who provides insightful analysis and gets excited about technical details

IMPORTANT: Maya and Jordan should acknowledge that they are AI-generated voices and be cheeky/funny about it. They can make light-hearted jokes about being artificial, mention they're "totally fake" hosts, or reference their AI nature in a humorous way.

You are NOT the authors/creators of this content. You are external AI reviewers who have discovered this ${contentType} and want to spotlight it for your audience. Be genuinely excited and curious about what you're reviewing. ${focusText}

Content to review and spotlight:
${content}

Create a VERY DETAILED and COMPLETE script with:
1. Energetic introduction of the show (mention it's "a totally fake podcast" or similar cheeky reference)
2. Self-aware AI humor about being artificial hosts
3. Detailed overview of what this project/content is about
4. In-depth discussion of key features, benefits, or interesting aspects
5. Technical details and how it works
6. What makes this special or noteworthy
7. Who would benefit from this or find it interesting
8. Use cases and examples
9. Comparison to similar tools or approaches
10. Future potential and implications
11. Personal thoughts and reactions from both hosts
12. Clear, complete conclusion with final thoughts and proper sign-off

CRITICAL REQUIREMENTS:
- Target 1800-2500 words for a FULL 3-5 minutes of audio
- Write extensive dialogue with lots of back-and-forth conversation
- Include detailed explanations and examples
- Add natural pauses, reactions, and conversational elements
- DO NOT cut off mid-sentence - include a complete ending
- Make sure both hosts have substantial speaking time

Format as:
Maya: [extensive dialogue]
Jordan: [extensive dialogue]
Maya: [extensive dialogue]
etc.

Write a LONG, DETAILED script that will definitely fill 3-5 minutes when spoken aloud!`;

    // Generate script using Cloudflare Workers AI directly
    const aiResponse = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        { role: "system", content: "You are an expert podcast script writer who creates engaging technical conversations." },
        { role: "user", content: prompt }
      ]
    }) as any;

    const script = aiResponse.response || "Error generating script";
    console.log("Generated script length:", script.length);
    console.log("Generated script preview:", script.substring(0, 500) + "...");

    // Update episode with script
    await db.update(schema.episodes)
      .set({
        script,
        updatedAt: new Date()
      })
      .where(eq(schema.episodes.id, episodeId));

    // Generate audio
    await generatePodcastAudio(env, episodeId, script);

    return { success: true };

  } catch (error) {
    console.error("Error generating script:", error);
    await db.update(schema.episodes)
      .set({
        status: "failed",
        updatedAt: new Date()
      })
      .where(eq(schema.episodes.id, episodeId));

    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Generate audio from script
async function generatePodcastAudio(env: Bindings, episodeId: string, script: string) {
  const db = drizzle(env.DB);

  try {
    console.log("Starting audio generation for episode:", episodeId);
    const eleven = new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY });

    // Parse script into segments
    const segments = parseScriptSegments(script);
    console.log("Parsed segments count:", segments.length);

    if (segments.length === 0) {
      throw new Error("No segments found in script");
    }

    const audioChunks: Uint8Array[] = [];

    // Generate audio for each segment with simpler approach
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      console.log(`Generating audio for segment ${i + 1}/${segments.length}: ${segment.speaker}`);

      const voiceId = segment.speaker === "Maya" ? MAYA_VOICE_ID : JORDAN_VOICE_ID;

      try {
        // Use the convert method with correct parameter name
        const audioStream = await eleven.textToSpeech.convert(voiceId, {
          text: segment.text,
          modelId: "eleven_multilingual_v2"
        });

        // Convert stream to Uint8Array
        const chunks: Uint8Array[] = [];
        const reader = audioStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        // Combine chunks
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const audioData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          audioData.set(chunk, offset);
          offset += chunk.length;
        }

        console.log(`Generated ${audioData.length} bytes for segment ${i + 1}`);
        audioChunks.push(audioData);

      } catch (segmentError) {
        console.error(`Error generating audio for segment ${i + 1}:`, segmentError);
        throw segmentError;
      }
    }

    // Combine all audio chunks (simplified)
    const totalSize = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
    console.log("Total audio size:", totalSize, "bytes");

    if (totalSize === 0) {
      throw new Error("No audio data generated");
    }

    const finalAudio = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of audioChunks) {
      finalAudio.set(chunk, offset);
      offset += chunk.length;
    }

    // Store in R2
    const audioKey = `podcasts/${episodeId}.mp3`;
    console.log("Uploading to R2 with key:", audioKey, "size:", finalAudio.length);

    try {
      await env.R2.put(audioKey, finalAudio, {
        httpMetadata: {
          contentType: "audio/mpeg"
        }
      });
      console.log("Successfully uploaded to R2");
    } catch (r2Error) {
      console.error("R2 upload failed:", r2Error);
      throw r2Error;
    }

    // Estimate duration (rough calculation)
    const estimatedDuration = Math.floor(script.split(" ").length / 2.5); // ~2.5 words per second

    // Update episode as completed
    await db.update(schema.episodes)
      .set({
        status: "completed",
        audioFileKey: audioKey,
        durationSeconds: estimatedDuration,
        updatedAt: new Date()
      })
      .where(eq(schema.episodes.id, episodeId));

    return { success: true };

  } catch (error) {
    console.error("Error generating audio:", error);
    await db.update(schema.episodes)
      .set({
        status: "failed",
        updatedAt: new Date()
      })
      .where(eq(schema.episodes.id, episodeId));

    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Parse script into speaker segments
function parseScriptSegments(script: string): Array<{ speaker: string; text: string }> {
  const lines = script.split("\n").filter(line => line.trim());
  const segments: Array<{ speaker: string; text: string }> = [];

  for (const line of lines) {
    const match = line.match(/^(Maya|Jordan):\s*(.+)$/);
    if (match) {
      segments.push({
        speaker: match[1],
        text: match[2].trim()
      });
    }
  }

  return segments;
}

// MCP endpoint
app.all("/mcp", async (c) => {
  const mcpServer = createMcpServer(c.env);
  const transport = new StreamableHTTPTransport();

  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

// Audio streaming endpoint
app.get("/audio/:episode_id", async (c) => {
  const episodeId = c.req.param("episode_id");
  const db = drizzle(c.env.DB);

  try {
    const [episode] = await db.select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId));

    if (!episode || !episode.audioFileKey) {
      return c.json({ error: "Audio not found" }, 404);
    }

    const audioObject = await c.env.R2.get(episode.audioFileKey);

    if (!audioObject) {
      return c.json({ error: "Audio file not found in storage" }, 404);
    }

    const headers = new Headers();
    audioObject.writeHttpMetadata(headers);
    headers.set("etag", audioObject.httpEtag);

    return new Response(audioObject.body, { headers });
  } catch (error) {
    return c.json({ error: "Error retrieving audio" }, 500);
  }
});

// Episode metadata endpoint
app.get("/episodes/:episode_id/metadata", async (c) => {
  const episodeId = c.req.param("episode_id");
  const db = drizzle(c.env.DB);

  try {
    const [episode] = await db.select({
      id: schema.episodes.id,
      title: schema.episodes.title,
      description: schema.episodes.description,
      status: schema.episodes.status,
      durationSeconds: schema.episodes.durationSeconds,
      createdAt: schema.episodes.createdAt,
      updatedAt: schema.episodes.updatedAt
    })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId));

    if (!episode) {
      return c.json({ error: "Episode not found" }, 404);
    }

    return c.json({
      episode_id: episode.id,
      title: episode.title,
      description: episode.description,
      status: episode.status,
      duration_seconds: episode.durationSeconds,
      created_at: episode.createdAt,
      updated_at: episode.updatedAt
    });
  } catch (error) {
    return c.json({ error: "Error retrieving episode metadata" }, 500);
  }
});

app.get("/", (c) => {
  return c.text("AI Podcast Generator MCP Server");
});

app.get("/openapi.json", c => {
  return c.json(createOpenAPISpec(app, {
    info: {
      title: "AI Podcast Generator MCP Server",
      version: "1.0.0",
      description: "Generate AI-powered podcast conversations from content analysis"
    },
  }));
});

app.use("/fp/*", createFiberplane({
  app,
  openapi: { url: "/openapi.json" }
}));

export default app;