---
name: kanaa-lyric-video
description: Make a professional Tamil or English lyric video in Kanaa through its MCP tools, from a song file and its LRC lyrics, with AI scene pictures that fit the song's style and singers, lyrics that move from behind the people into clear space, light overlays, the owner's animated brand intro, film-style credits and a logo. Use when asked to create, redo or restyle a lyric video, lyrical video or பாடல் வரி video.
---

# Make a lyric video in Kanaa

Everything here was learned making real videos for the owner (கவின்தமிழ் Originals). Follow it closely: each rule exists because breaking it went wrong once.

## 0. Before anything

- **Kanaa must be running**: `open -a Kanaa`, then check `http://127.0.0.1:8010/api/render-jobs` answers. The `kanaa` MCP server talks to it (registered in the project's `.mcp.json`; run with `cd backend && .venv/bin/python -m kanaa_mcp`).
- **Never export unless the owner asks.** They review in Kanaa first. `export` is a separate tool; do not call it.
- **One editor project per song.** When redoing, always pass `project_id` to update it. Never create a second copy; if duplicates exist, ask before deleting any.
- **The owner's files are read-only.** `add_song` copies the song into Kanaa; never move, rename or edit their files.
- **AI pictures cost the owner's AI credit**, one per picture. Get the brief right before making them.
- **Kanaa runs heavy work in two lanes, one job at a time each** (exports and looks in one; finding people, 3D, preview copies, effects and AI pictures in the other). People-finding and pictures queue behind earlier preparation and can take many minutes. Wait and tell the owner what is happening; never cancel jobs you did not start.

## 1. Know the song

1. **Find the song and its LRC** (usually `~/Downloads`; names like `வா வா வெண்ணிலவே.wav` and `வா வா வெண்ணிலவே by kavintamiloriginals.lrc`).
2. **Check they are the same song.** The names must match, and the LRC's last line must fall inside the song's length (`add_song` returns `seconds`). Different songs with similar names exist (வா வா சூரியனே and வா வா வெண்ணிலவே). If anything differs, ask.
3. `read_lrc` gives the timed lines. Then **read the LRC file itself**: its bracketed directions (`[Chorus – male Lead, Warm and Flowing]`, `[Gentle R&B groove]`, `[soft Rhodes]`) tell you the genre, mood, tempo and who sings. `read_lrc` leaves those out of the lyrics.
4. **Look at the song's own cover**: a `.mp4` of the same name in Downloads usually shows the cover art (`ffmpeg -ss 20 -i song.mp4 -frames:v 1 cover.jpg`, then look). It shows the intended look, and often the lyricist (e.g. "பட்டுக்கோட்டை கல்யாணசுந்தரம்").
5. **Ask the owner what you cannot tell**, before making pictures: the visual style they want (K-pop music video, folk, moonlit R&B, devotional...) and **who sings: a male lead, a female lead, a duet, a male group**. The people in the pictures must match the singers. A male group song needs a group of men, not a solo woman.

## 2. Pictures that fit the song

1. `add_song(path)` → `asset_id`, `seconds`.
2. `plan_lyric_scenes(name, cues, count, brief, canvas)`: about one scene per 20-30 s of song (6 for 2.5 min, 8 for 4 min, at most 8). It makes a lyric project and returns `lyric_project_id`, `plan_id` and each scene's `id`, `start`, `end`, `lyrics` and `prompt`.
   - The `brief` (English, under 1500 characters) is the look of the whole video: genre and music-video style, colour palette, era and place, and **the recurring cast** (same faces, hair and clothes in every scene; the singer or singers as the focus; say male/female/group).
   - Without a text model in Kanaa's AI settings, the scene prompts come back generic. **Always rewrite each scene's prompt**: keep the planner's prompt (it carries the continuity rules) and add the shared look plus a "Scene:" line that shows what **that scene's own lines** say (read the Tamil and translate the meaning into a picture).
   - Ask for wide frames with a near foreground (people, trees, pillars) and a far background, and a calm lower fifth for the lyrics.
3. `make_scene_pictures(lyric_project_id, plan_id, scenes)` makes them (a few minutes) and returns each scene's `media_id`, `start` and `end`.
4. **Look at every picture** (`look_at_media`). Check the cast matches the singers, the style matches the song, and faces stay consistent. To change pictures that are already made, plan again (a new `plan_id`) and make that plan's pictures; a plan's pictures cannot be made twice.

Examples that worked:
- வா வா சூரியனே (upbeat, philosophical, male group vocals): K-pop boy-group music video, five young Tamil men in black and gold, sunrise orange against teal and violet, one scene per idea of the lyrics (rooftop sunrise, a neon street with a cracked statue of justice, a rushing grey crowd, a storm field, people sharing food on temple steps, a mountain-top finale).
- வா வா வெண்ணிலவே (romantic R&B ballad, male lead): a moonlit night in deep blue and silver, the male singer in a cream kurta and his beloved in a lavender saree, as on the song's cover (a jetty under a full moon).

## 3. Build it

`build_lyric_video` builds the whole video as an editor project and does not export. Pass:

- `name`, `song_asset_id`, `song_seconds`, `cues` (from `read_lrc`), `scenes` (`[{"media_id", "start"}]` in order, the first from 0).
- `look`: lyric entrances and light overlays. `energetic` for K-pop, dance, upbeat; `romantic` for ballads and R&B; `calm` for devotional or slow songs.
- `lyric_motion`:
  - **`into_clear` (default; use it)**: each line starts behind the person nearest the clear space and glides into that space within 1.6 s, then nothing covers it; long lines split onto two. People are found with Apple Vision in each picture. This is what the owner asked for.
  - `plain`: lines just fade in and out over the pictures. Use when the owner asks for simple.
  - `in_scene`: people cover the lyrics the whole time. **The owner rejected this as unreadable**; do not use it unless asked.
- `three_d`: a 3D camera glide on each picture. Off by default, and not with `into_clear`. The owner asked for simple; ask before using it.
- `lights`: light overlays over the opening seconds of each scene. On.
- `lyric_font` (`elegant` reads well for Tamil), `lyric_colour` (`#ffffff`, or a soft lavender `#f4f1ff` for night scenes), `lyric_size` (44-52), `canvas` (`landscape` for YouTube).
- Credits, film style. **Only what is true; ask rather than guess names** (singers' and composers' names are often unknown; leave them out):
  - `presents`: `KAVIN TAMIL ORIGINALS` (used only without the brand intro).
  - `song_by`: the lyricist, from the cover or the owner (e.g. `பட்டுக்கோட்டை கல்யாணசுந்தரம்`).
  - `music`: e.g. `Made with Suno`, when the owner says the music was made with Suno.
  - `presented_by`: `கவின்தமிழ் Originals`.
  - `footer`: `@kavintamiloriginals  ·  Lyric video with Kanaa`.
  - `accent`: the colour of the small role labels: gold `#e8b04a` for warm, sunny pictures; silver-lavender `#cfc8ff` for night.
- `logo_media_id`: the owner's logo, a transparent PNG in Kanaa's media. Ask which. The all-gold கவின்தமிழ் Originals logo was chosen before ("Hollow gold leaf musical note logo.png"). It sits small in the bottom-right corner during the song and large on the closing card.
- `brand_intro` (default on, needs the logo): the video opens with the animated brand intro made from the logo. A plain golden leaf falls among music notes, strikes them, the note appears in it, the logo forms, and **வழங்கும்** and **PRESENTS** fade in beneath. `make_brand_intro(project_id, logo_media_id)` adds the same intro to any project.
- `project_id`: the editor project to update when redoing a song. Leave it out only the first time.

As built (before 3b), the video opens with the brand intro (5.5 s), then "A SONG BY" with the lyricist, then the title with the footer line, then the song at 10.5 s. It ends with a separate closing card: the logo, then LYRICS, MUSIC and PRESENTED BY in small spaced gold capitals above their names. Pictures are enlarged to fill the frame (AI pictures are 3:2), so there are no black bars. For the house style, build with `lyric_motion: plain` (3b gives the lines their own glide) and then follow 3b.

## 3b. Finish in the owner's house style

The owner hand-finished the project named **"AI scene 6 still.mp4"** (the song எனைத் தொட்டிழுத்தாள்!, a பாவேந்தர் பாரதிதாசன் poem; its id is 46, but the owner never sees ids) in the editor. **Treat it as the base for every lyric video**: build with `build_lyric_video`, then make these changes with `update_item`, `set_keyframes`, `set_animation`, `add_title`, `set_transition` and `remove_item`. Find it with `list_projects` by that name and read it with `get_project` when in doubt; copy its values, don't guess.

**Opening (no separate credit cards)**
- The brand intro (5.5 s, a 0.5 s fade in) opens the video; the song starts right after it, at 5.5 s.
- Remove the built "A SONG BY" and title cards (`opening-1`, `closing-credit` and their backgrounds); the owner replaced them with titles over the first scene:
  - The poet/lyricist: a soft title at the centre-left, from 5.5 s for about 16 s, colour `#d2e6da`, size 44, Avenir Next with Arima for Tamil, drifting slowly downwards.
  - The song title: design `overlap`, Futura with Baloo Thambi 2 for Tamil, red `#ef4444`, size 34, at the bottom right (x 0.62, y 0.90), for about 10 s before the first lyric.
- A lower-third that stays for the whole song after the title: the song title with the poet as its subtitle, design `gradient`, outline style, left-aligned, size 20, Gill Sans with Arima, subtitle `#e5e5e5`, band `#2b2121`, enter `reveal` 0.6 s, exit `fade` 0.4 s. Put it on its own text layer.

**Lyrics: two layers, answering each other**
- Odd lines on one text layer, even lines on a second, so a line can arrive as the last one leaves.
- Every line: Arima (Tamil and Latin), size 44, warm white `#fff7e8`, shadow, centred, **split onto two lines** at a natural break (`\n`).
- Enter `particle-form` 0.5 s, exit `particle-form` 0.4 s.
- Motion (keyframes on x and y, 0 to 0.53 s, linear): each line starts at the centre of the frame and glides out to its side. Odd lines go up-right (to about x 0.72, y 0.32); even lines go left (to about x 0.29, y 0.58). Resting scale 0.68.
- Set these as the layer's style (layer settings) rather than on each line, so later fixes reach every line. Instrumental gaps simply have no line.

**Pictures (the Main layer)**
- Filled to the frame (scale 1.1852 for 3:2 pictures), one per scene, long holds (11-38 s).
- A different touch per scene, never the same twice in a row: a dreamy glow (intensity 0.45, softness 0.5, warmth 0.2); a beat pulse (strength 0.6, size 0.04, 120 bpm); a blur exit or blur enter (0.5 s); a cross-blur or flash transition (0.6 s); an echo smear (4 trails, decay 0.6) on the last scene.
- A very short cut (about 0.25 s) at a musical accent is fine.
- The last scene ends with a 3 s fade out; the song fades out over its last 2.4 s.

**Light overlays (the Effects layer, blend `screen`)**
- Two 5 s light clips at the start of each scene, opacity 0.85.
- One light slowed right down (speed 0.35) under the title moment; at most one kaleidoscope mirror (6 segments).

**Logo**: small at the bottom right (x 0.93, y 0.91, scale 0.12, opacity 0.9), from the end of the intro to the end.

## 4. Check, then hand over

1. `get_project(project_id)` and confirm **the song is the right one**. Compare the audio item's asset with this song's `asset_id`; a mismatch happened once, when one song's audio was put into another's project. Also confirm the first lyric line and the title are this song's.
2. `look` at these moments (each up to 10 s):
   - 0-11 s: the brand intro, the song credit and the title.
   - One lyric line that starts behind a person: it must end fully readable in clear space.
   - A scene change.
   - The closing card.
3. What to look for:
   - **Tamil is never letter-spaced**: spacing splits Tamil letters into pieces with dotted circles.
   - Labels never overlap names.
   - No line ends hidden behind a person.
   - No black bars at the sides.
   - The logo sits in the corner.
4. Tell the owner the project's name (as Kanaa shows it; never just its id number), what you checked, and anything you could not check. Leave the export to them.

## Words to use with the owner

Plain English, short. Say "Kanaa is finding the people in each picture" rather than job names. Quote Tamil lyrics as they are. Never claim something works without having looked at it.
