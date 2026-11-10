# Kanaa (கனா)

Kanaa means "dream" in Tamil. It's a video editor and lyric video creator that runs on your own Mac.

## Mac app

Run `desktop/build.sh` once. It installs `Kanaa.app` in Applications.
The app runs this folder's code and keeps projects in `backend/.data`, so keep the
folder where it is. Run `desktop/build.sh` again after pulling new code.

## Start from a terminal

Install Python 3.12+, Node 22+, FFmpeg and ffprobe. Then run:

```sh
./start.sh
```

Open **http://localhost:5190**. The API runs on **127.0.0.1:8010**. Both bind to the
local computer. First launch installs dependencies if needed. Ctrl+C stops them.

## Workflow

1. Choose Video Editor or Lyric Video from Studio.
2. Name a project and drop in your media. Import copies stay in Kanaa's own store.
3. Edit and preview. Each project autosaves independently, even with the same source.
4. Export to MP4. Progress and cancellation are available in Exports.
5. Open the result and download it. Projects can be renamed, duplicated, or deleted.

Video projects use a multi-clip timeline with video, photos, overlays, titles,
captions and separate audio tracks. You can trim and split clips, reframe and
animate them, apply themes and transitions, edit speech by its words, prepare
people and background effects, and export up to 4K. Open the in-app Guide from
the editor's **?** button for the current controls and shortcuts.

Lyric projects support image slideshows or a video background, song uploads,
automatic local lyric synchronization, manual/LRC/SRT timings, image and lyric
animations, crossfades, beat timing, text styles, and output formats. Review
singing-based automatic timings before export. Image/video browser color previews
remain approximate; review exported colors for critical work.

## Data and independence

- `backend/.data/motion.db`: media records, project recipes, render-job history.
- `backend/.data/media`: imported originals (never modified by editing).
- `backend/.data/video_audio`: uploaded songs.
- `backend/.data/exports`: rendered MP4s.
- `backend/.models`: local Whisper model cache. First sync downloads the model if absent.
- `backend/app/assets/fonts`: bundled Noto fonts for Tamil and other Indic scripts.

Deleting a project removes its recipe, not its media or exports. Files are not
silently migrated from Photos. Import any source media you want to use here.

Environment overrides: `WIDEANGLE_MOTION_DATA_DIR`, `WIDEANGLE_MOTION_MODEL_CACHE`,
`WIDEANGLE_MOTION_LYRIC_MODEL` (default `small`).

## Animating with an AI agent (MCP)

Kanaa has an MCP server, so an AI agent (Claude Code, Claude Desktop or any MCP client) can make a simple video from
your media (look at the clips, pick their best moments, put them in order with transitions, add titles and music from
your library, export), or find a clip or title in a project, look at frames of it, and animate it: titles, keyframes,
enter and exit animations, Place in scene. It works on
the running Kanaa through its own API; every change is checked against Kanaa's timeline rules first, and `undo` takes
the agent's last change back. An editor with the project open picks changes up within a few seconds (Undo there works
too). The agent's own AI use is paid by whoever runs the agent; Kanaa itself makes no AI calls for this.

To connect Claude Code, add this to the `.mcp.json` of the folder you run it in (the file is ignored by git):

```json
{
  "mcpServers": {
    "kanaa": {
      "command": "/path/to/wideangle-motion/backend/.venv/bin/python",
      "args": ["-m", "kanaa_mcp"],
      "env": { "PYTHONPATH": "/path/to/wideangle-motion/backend", "KANAA_API_URL": "http://127.0.0.1:8010/api" }
    }
  }
}
```

Then ask, for example: *"In Kanaa project 26, put the title BENGALURU on the wall on the right at 3 seconds, pop the letters
in, and check how it looks."* Or: *"Make a 3-minute video of my Bengaluru clips: best moments, a few gentle transitions, an
opening title and calm music."* Tools: list_media, look_at_media, best_moments, create_project, add_clips,
set_transition, remove_item, list_music, add_music, list_projects, get_project, find_items, get_item, look, update_item,
set_keyframes, set_animation, add_title, place_in_scene, history, undo, export. Undo history is kept in
`~/Library/Application Support/Kanaa/agent-history` (KANAA_MCP_HISTORY).

## Development and checks

```sh
npm --prefix frontend run build
PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

Tests additionally require `httpx` (`backend/.venv/bin/python -m pip install httpx`).
Browser checks used disposable imported media, not a personal library.

## Images inspired by lyrics

Choose **Lyric Video → Start with AI images**, or open an existing lyric project.
Paste lyrics and open **Create images from lyrics**:

1. Choose a shared style, creative direction, and 1–8 scenes.
2. Build scene prompts. Lyric sections are grouped locally; the image model
   interprets their meaning and imagery, including lyrics in their original language.
3. Review and edit each visual prompt; prompt edits autosave with the scene plan.
   Or choose **Let AI direct the scenes**: with a Text model set in AI settings, the AI reads the lyrics (in any language), splits the song by meaning and writes the scenes for you.
4. Configure a provider in **AI settings** (the top-bar settings button, or the
   editor's AI connection panel), then choose Generate images.
5. Select the finished images and choose Use generated images. When lyric timings
   are available and unchanged, scene changes follow their saved start times.

The provider uses [OpenAI's Images generation API](https://developers.openai.com/api/reference/resources/images/methods/generate).
The default model is `gpt-image-2.5-flare`; model and compatible API URL are editable.
`OPENAI_API_KEY` can be supplied to the server, or a key can be saved in Kanaa's
local `.data/ai-settings.json` (owner-only permissions). Keys are never returned by
settings reads or stored in project recipes. Environment keys take precedence.

Generation sends included lyrics/prompts to the chosen provider and uses its API
credits. This is the optional online part of Kanaa. Each scene is submitted once;
retrying failures does not regenerate successful images. Cancellation stops remaining
scenes and closes an in-flight local request; a request already accepted by the
provider may still be charged. Generated images remain in Media and in the saved
scene plan, even when the editor is closed. Interrupted jobs require an explicit retry.

Provider-contract and browser tests use a local fake provider. No paid live-provider
check was performed without a configured API key; generated artistic quality still
needs review against the real provider.
