# Kanaa (கனா)

Everything about how Kanaa is built, how to test it and the owner's standing rules is in AGENTS.md, loaded here:

@AGENTS.md

## Working in a cloud session

Claude Code cloud sessions work on the GitHub copy, `https://github.com/jagadeeschai/kanaa`, on a Linux machine. The owner's Mac, where Kanaa runs, is not there. Before you start:

**Set up the tests once per session:**

```bash
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend ci
./test.sh
```

If the session can't install something (FFmpeg, a Python package), say which tests could not run. Never call a test passed if it was skipped.

**Mac-only parts.** You can change their code, but you cannot run or check them here. Say so in the pull request:
- The Apple Vision helpers in `backend/native/*.swift`: person cut-outs, Put behind people or objects, per-person masks, focus blur and focus pull.
- The Mac app: `desktop/main.cjs` and the installed `/Applications/Kanaa.app`, plus restarting it.
- The owner's media, the Music library and `backend/.data`. None of it is in git, and none of it may be added. Their music is bought.
- Slate, the owner's project tracker, runs at `localhost:8005` on the Mac and can't be reached from the cloud.

**Git in the cloud:**
- Work on a branch and open a pull request into `main`. Don't merge it, and don't push to `main`, unless the owner says so.
- Never commit secrets: no API keys, tokens or `.mcp.json`. The GitHub repository is public.
- Before writing a summary, list exactly what you tested and what you could not (anything needing the Mac, real footage, or Kanaa running). The owner checks it on the Mac after merging.

**GitLab stays in step from the Mac.** The Mac's `origin` is GitLab and `github` is GitHub. After a pull request is merged, the Mac session pulls `github/main` and pushes it to GitLab when the owner says "push".
