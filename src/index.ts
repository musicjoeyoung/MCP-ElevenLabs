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

    const prompt = `You are creating a script for a 60-second audio summary called "What Is It?" featuring two AI hosts:

- Maya: An energetic female AI host
- Jordan: An enthusiastic male AI host

FORMAT: This is NOT a podcast - it's a quick, captivating 60-second audio summary that achieves what an elevator pitch or author's summary would accomplish. ${focusText}

STRUCTURE:
1. Quick intro (5-10 seconds): "Welcome to What Is It? I'm Maya (${MAYA_VOICE_ID}), and I'm Jordan (${JORDAN_VOICE_ID}), we're not real but this ${contentType} is! We'll summarize it in 60 seconds."
2. Main summary (45-50 seconds): Fast-paced, engaging explanation of what it is, key features, and why it matters
3. Quick wrap-up (5 seconds): "That's What Is It? - your 60-second summary!"

Content to summarize:
${content}

REQUIREMENTS:
- Target exactly 150-200 words total (for 60 seconds of speech)
- Be concise, energetic, and informative
- Focus on WHAT it is (code, file, discussion, project, essay, etc.), KEY features, and WHY it matters
- Quick mention they're AI but the project is real
- No long introductions or detailed technical discussions
- Make it sound like an elevator pitch in audio form

Format as:
Maya: [brief dialogue]
Jordan: [brief dialogue]
Maya: [brief dialogue]
etc.

Create a tight, engaging 60-second summary!`;

    // Generate script using Cloudflare Workers AI directly
    const aiResponse = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: "You are an expert at creating concise, engaging 60-second audio summaries. Always write COMPLETE scripts that don't cut off mid-sentence." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500 // Reduced for 60-second format
    }) as any;

    const script = aiResponse.response || "Error generating script";
    console.log("Generated script length:", script.length);
    console.log("Generated script preview:", script.substring(0, 500) + "...");
    console.log("Generated script end:", "..." + script.substring(Math.max(0, script.length - 200)));

    if (script.length < 1000) {
      console.warn("Script is shorter than expected:", script.length, "characters");
    }

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

    // For 60-second summaries, we'll generate each segment separately and combine
    const audioBuffers: ArrayBuffer[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      console.log(`Generating audio for segment ${i + 1}/${segments.length}: ${segment.speaker} - "${segment.text.substring(0, 50)}..."`);

      const voiceId = segment.speaker === "Maya" ? MAYA_VOICE_ID : JORDAN_VOICE_ID;

      try {
        // Use the correct ElevenLabs API method
        const audioStream = await eleven.textToSpeech.convert(voiceId, {
          text: segment.text,
          modelId: "eleven_multilingual_v2"
        });

        // Convert stream to buffer
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

        // Combine chunks into single buffer
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const audioBuffer = new ArrayBuffer(totalLength);
        const audioArray = new Uint8Array(audioBuffer);
        let offset = 0;
        for (const chunk of chunks) {
          audioArray.set(chunk, offset);
          offset += chunk.length;
        }

        console.log(`Generated ${audioBuffer.byteLength} bytes for segment ${i + 1}`);
        audioBuffers.push(audioBuffer);

      } catch (segmentError) {
        console.error(`Error generating audio for segment ${i + 1}:`, segmentError);
        throw segmentError;
      }
    }

    // Combine all audio buffers
    const totalSize = audioBuffers.reduce((acc, buffer) => acc + buffer.byteLength, 0);
    console.log("Total audio size:", totalSize, "bytes");

    if (totalSize === 0) {
      throw new Error("No audio data generated");
    }

    // Create final combined audio
    const finalAudio = new Uint8Array(totalSize);
    let offset = 0;
    for (const buffer of audioBuffers) {
      const chunk = new Uint8Array(buffer);
      finalAudio.set(chunk, offset);
      offset += chunk.byteLength;
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

// Parse script into speaker segments (simplified for 60-second format)
function parseScriptSegments(script: string): Array<{ speaker: string; text: string }> {
  const lines = script.split("\n").filter(line => line.trim());
  const segments: Array<{ speaker: string; text: string }> = [];

  for (const line of lines) {
    const match = line.match(/^(Maya|Jordan):\s*(.+)$/);
    if (match) {
      const speaker = match[1];
      const text = match[2].trim();

      // For 60-second format, keep segments simple - no need to split
      if (text.length > 0) {
        segments.push({ speaker, text });
      }
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