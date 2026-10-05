#!/usr/bin/env python3
"""The highlighted rows of a session in transcript order, newest last.

Prints one line a row: `b <uuid>` for a prompt the person typed, `a <uuid>`
for a reply's text written mid-work (a tool call follows it before the next
prompt) and `c <uuid>` for the text that closes the work, and `t <tool_use_id> <tool>` for a tool
call. Reads the session's
stored transcript."""
import glob
import json
import os
import sys

found = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sys.argv[1]}.jsonl"))
rows = []

for line in open(found[0], errors="ignore") if found else []:
    # Most lines are tool calls and their results; those are not parsed.
    if '"type":"user"' not in line and '"type":"assistant"' not in line:
        continue

    try:
        entry = json.loads(line)
    except ValueError:
        continue

    kind = entry.get("type")
    content = (entry.get("message") or {}).get("content")
    uuid = entry.get("uuid")

    if not uuid or entry.get("isSidechain") or entry.get("isMeta"):
        continue

    blocks = content if isinstance(content, list) else [{"type": "text", "text": content or ""}]
    has_text = any(b.get("type") == "text" and (b.get("text") or "").strip() for b in blocks if isinstance(b, dict))
    is_result = any(b.get("type") == "tool_result" for b in blocks if isinstance(b, dict))

    if kind == "assistant" and any(b.get("type") == "tool_use" for b in blocks if isinstance(b, dict)):
        # Every text since the last prompt was written before this call.
        for at in range(len(rows) - 1, -1, -1):
            if rows[at][0] == "b":
                break

            if rows[at][0] == "c":
                rows[at] = "a" + rows[at][1:]

    if kind == "assistant" and has_text:
        rows.append(f"c {uuid}")

    if kind == "assistant":
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                rows.append(f"t {block.get('id')} {block.get('name')}")

    elif kind == "user" and has_text and not is_result:
        first = next((b.get("text") or "" for b in blocks if isinstance(b, dict) and b.get("type") == "text"), "")

        # A slash command and its output are stored as prompts but are not drawn as one.
        if first.lstrip().startswith("<"):
            continue

        rows.append(f"b {uuid}")

print("\n".join(rows[-1500:]))
