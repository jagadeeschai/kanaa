// The lyric video's timeline, built exactly as the lyric screen builds it (lyricEditorTimeline), for Kanaa's MCP server.
// Reads the handoff as JSON on stdin and writes the timeline as JSON on stdout. Run with node from the frontend folder.
import { lyricEditorTimeline } from '../src/editor/lyric-handoff.ts';

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify(lyricEditorTimeline(JSON.parse(input))));
