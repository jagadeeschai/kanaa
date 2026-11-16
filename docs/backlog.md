# Backlog

Agreed work not started yet, newest first.

## Video layer limit (agreed 16 November 2026, for 17 November)

The limit is 8 video layers (`MAX_LAYERS` in `backend/app/services/timeline_schema.py`, `MAX_VIDEO_LAYERS` in
`frontend/src/timeline/model.ts`). A lyric project reaches it on its own: Pop-out, Picture lights, Effects, Brand and
Person layers are all made by features (project கற்கண்டு had 8, leaving no room for a second pop-out with words behind).

1. Measure export time on a project with 16 mostly empty video layers (each layer is laid over the whole film, so
   empty stretches still cost). If acceptable, raise the limit to 16 in both places, with a test.
2. Features share layers instead of adding new ones, as Pop-out now does (`applyPopout`): Person (place in scene,
   words behind people), Effects and Picture lights reuse a free layer of their kind at that time, on the right side of
   the titles.
3. Only if 1 shows a real slowdown: the export skips a layer's empty stretches.
