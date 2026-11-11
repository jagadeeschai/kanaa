---
name: kanaa-lyric-video
description: Make a professional Tamil or English lyric video in Kanaa from a song file and its LRC lyrics, with AI scene pictures, 3D camera glides, lyrics inside the scene, varied title effects, light overlays, film-style credits and the owner's logo. Use when asked to create, redo or restyle a lyric video, lyrical video or பாடல் வரி video.
---

# Make a lyric video in Kanaa

Kanaa must be running (`open -a Kanaa`; its API is `http://127.0.0.1:8010/api`). Use the `kanaa` MCP tools. The owner reviews every video in Kanaa first: **never export unless they ask**.

## 1. Know the song before making anything

- Find the song and its LRC (usually `~/Downloads`). The song and the LRC must be the same song: compare their names and check the LRC's last line falls inside the song's length. If they differ, ask.
- `read_lrc`, then read the LRC file itself: its bracketed directions (`[Chorus – male Lead, Warm and Flowing]`, `[soft Rhodes]`) tell you the **genre, mood and who sings**. A cover picture or an earlier video of the song (a `.mp4` of the same name) shows the intended look; look at a frame.
- Ask the owner what you cannot tell: the style (K-pop, folk, moonlit R&B...), and **who sings: male, female, a group**. The people in the pictures must match the singers.

## 2. Pictures that fit the song

- `add_song`, then `plan_lyric_scenes`: about one scene per 20-30 s of song (6 for 2.5 min, 8 for 4 min). The `brief` sets the look of the whole video: genre, colour palette, era and place, and the recurring people (same faces and clothes in every scene; the lead singer(s) as the focus).
- Rewrite each scene's prompt so it shows what **its own lines** say (read the Tamil), in the shared look. Wide frames with a near foreground (people, trees, pillars) and a far background, so the 3D glide and lyrics-inside-the-scene work. Keep the lower fifth calm for the lyrics.
- `make_scene_pictures` costs AI credit per picture: get the brief right first. `look_at_media` to check them; if a picture is wrong, plan again and remake.

## 3. Build it

`build_lyric_video` with `three_d`, `lyrics_in_scene` and `lights` on. Choose the `look` from the music: `energetic` (K-pop, dance, upbeat), `romantic` (ballads, R&B: lines rise from behind the people), `calm` (devotional, slow). Pick `accent` from the pictures (gold `#e8b04a` for warm scenes, silver-lavender `#cfc8ff` for night).

Credits, film style, only what is true; ask rather than guess names:
- `presents`: e.g. `KAVIN TAMIL ORIGINALS`; `song_by`: the lyricist; `music`: e.g. `Made with Suno` when the owner says so; `presented_by`: the channel; `footer`: e.g. `@kavintamiloriginals  ·  Lyric video with Kanaa`.
- `logo_media_id`: the owner's logo (a transparent PNG in Kanaa media; ask which one). It sits small at the bottom right, and large on the closing card.

When redoing a video, pass `project_id` so the same project is updated; never leave duplicates.

## 4. Check, then hand over

`look` at a few moments: the opening cards (0-8 s), a line that rises from behind people, a scene change, and the closing card. Tamil must never be letter-spaced (it splits the letters); labels must not overlap names. Then tell the owner the project's name and what to check, and leave the export to them.
