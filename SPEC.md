# AI Podcast Generator MCP Server Specification

This document outlines the design and implementation plan for an AI Podcast Generator MCP server that analyzes projects, code, files, or discussions to create engaging 2-person podcast-style conversations.

The MCP server will generate scripts featuring two enthusiastic co-hosts (Maya and Jordan) who review and spotlight projects, applications, and content. They act as external reviewers who are excited to share discoveries with their audience. The system uses ElevenLabs to synthesize audio with distinct male and female voices, creating podcasts with a duration of 3-5 minutes. The system will be built using Cloudflare Workers with Hono as the API framework and ElevenLabs for text-to-speech generation.

## 1. Technology Stack

- **Edge Runtime:** Cloudflare Workers
- **API Framework:** Hono.js (TypeScript-based API framework)
- **MCP Framework:** @modelcontextprotocol/sdk and @hono/mcp
- **Database:** Cloudflare D1 (SQLite)
- **ORM:** Drizzle ORM
- **Blob Storage:** Cloudflare R2
- **Text-to-Speech:** ElevenLabs API
- **AI Integration:** OpenAI GPT-4.1 for script generation

## 2. Database Schema Design

The database will store podcast episodes, generation requests, and audio files metadata for tracking and retrieval.

### 2.1. Episodes Table

- id (TEXT, Primary Key, UUID)
- title (TEXT, NOT NULL)
- description (TEXT)
- script (TEXT, NOT NULL) - Full podcast script
- audio_file_key (TEXT) - R2 storage key for audio file
- duration_seconds (INTEGER) - Actual audio duration
- status (TEXT, NOT NULL) - 'generating', 'completed', 'failed'
- created_at (INTEGER, NOT NULL) - Unix timestamp
- updated_at (INTEGER, NOT NULL) - Unix timestamp

### 2.2. Generation_Requests Table

- id (TEXT, Primary Key, UUID)
- episode_id (TEXT, Foreign Key to Episodes)
- source_type (TEXT, NOT NULL) - 'code', 'file', 'discussion', 'project'
- source_content (TEXT, NOT NULL) - Input content for analysis
- source_metadata (TEXT) - JSON metadata about source
- created_at (INTEGER, NOT NULL) - Unix timestamp

## 3. MCP Server Tools

The MCP server will expose tools for generating and managing AI podcasts.

### 3.1. generate_podcast Tool

- **Description:** Analyzes provided content and generates a 2-person podcast conversation
- **Parameters:**
  - content (string, required): The source content to analyze (code, text, discussion)
  - content_type (string, required): Type of content ('code', 'file', 'discussion', 'project')
  - title (string, optional): Custom title for the podcast
  - focus_areas (array, optional): Specific topics to emphasize
- **Returns:** Episode ID and generation status

### 3.2. get_podcast_status Tool

- **Description:** Check the status of a podcast generation request
- **Parameters:**
  - episode_id (string, required): The episode ID to check
- **Returns:** Current status, progress, and audio URL if completed

### 3.3. list_podcasts Tool

- **Description:** List all generated podcasts with metadata
- **Parameters:**
  - limit (number, optional): Maximum number of results (default 10)
  - offset (number, optional): Pagination offset
- **Returns:** Array of podcast episodes with metadata

### 3.4. get_podcast_script Tool

- **Description:** Retrieve the full script for a generated podcast
- **Parameters:**
  - episode_id (string, required): The episode ID
- **Returns:** Full podcast script with speaker annotations

## 4. API Endpoints

### 4.1. MCP Endpoint

- **POST/GET/PUT/DELETE /mcp**
  - Description: Main MCP server endpoint handling JSON-RPC requests
  - Handles all MCP protocol communication

### 4.2. Audio Retrieval Endpoints

- **GET /audio/:episode_id**
  - Description: Stream or download generated podcast audio
  - Returns: Audio file from R2 storage with appropriate headers

- **GET /episodes/:episode_id/metadata**
  - Description: Get episode metadata including duration and status
  - Returns: Episode information without full script

## 5. Podcast Generation Workflow

### 5.1. Script Generation Process

1. Analyze input content using GPT-4.1
2. Generate structured conversation between Alex (host) and Sam (expert)
3. Ensure natural flow with introductions, main discussion, and conclusions
4. Target 10-minute maximum duration (approximately 1,500-2,000 words)
5. Include natural speech patterns, questions, and transitions

### 5.2. Audio Synthesis Process

1. Split script into speaker segments
2. Use ElevenLabs API with distinct voices for Alex and Sam
3. Generate audio segments sequentially
4. Concatenate segments into final podcast audio
5. Store in R2 with episode ID as key
6. Update database with audio metadata

### 5.3. Persona Definitions

- **Alex (Host):** Curious, engaging interviewer who asks insightful questions and guides the conversation
- **Sam (Expert):** Knowledgeable technical expert who explains concepts clearly and provides deep insights

## 6. Integrations

### 6.1. ElevenLabs Integration

- Use ElevenLabs client for text-to-speech synthesis
- Configure distinct voices for Alex and Sam personas
- Handle audio streaming and concatenation
- Manage API rate limits and error handling

### 6.2. OpenAI Integration

- Use GPT-4.1 for intelligent script generation
- Implement content analysis and conversation structuring
- Handle context length limitations for large inputs
- Generate natural, engaging dialogue

### 6.3. Cloudflare R2 Storage

- Store generated audio files with episode-based keys
- Implement proper access controls and expiration policies
- Handle large file uploads and streaming

## 7. Environment Variables

The following environment bindings should be configured:

- `ELEVENLABS_API_KEY`: ElevenLabs API authentication
- `OPENAI_API_KEY`: OpenAI API authentication
- `R2`: Cloudflare R2 bucket binding for audio storage
- `DB`: Cloudflare D1 database binding

## 8. Additional Notes

### 8.1. Content Analysis Strategy

The system should intelligently analyze different content types:
- **Code:** Focus on architecture, patterns, and technical decisions
- **Files:** Extract key concepts and discussion points
- **Discussions:** Identify main themes and interesting perspectives
- **Projects:** Analyze scope, challenges, and innovative aspects

### 8.2. Audio Quality Considerations

- Use high-quality ElevenLabs voices for professional output
- Implement proper audio formatting (MP3, appropriate bitrate)
- Add brief pauses between speakers for natural flow
- Consider background music or intro/outro elements

### 8.3. Performance Optimization

- Implement async processing for long-running audio generation
- Use database status tracking for progress monitoring
- Cache frequently accessed episodes
- Optimize R2 storage access patterns

## 9. Further Reading

Take inspiration from the project template here: https://github.com/fiberplane/create-honc-app/tree/main/templates/d1