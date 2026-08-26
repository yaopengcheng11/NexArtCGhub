"""One-shot migration: infer scene spec fields from existing manifest data
(used for resources whose manifest was generated BEFORE the parser
was extended to extract render / timing fields).

For each blend-asset resource in DB, look at:
  * summary.actions[].frames = [start, end]
  * summary.actions[].durationSeconds

Camera actions (frame_start..frame_end over a real number of seconds)
let us recover the scene's frame range and FPS.  We use the
longest-duration camera action as the canonical "scene render".

Computed fields written back to tagGroups:
  * frameStart, frameEnd   (from the longest action's frames)
  * fps                    (computed from that action)
  * aspectRatio            (left null; needs parser)
  * renderEngine           (left null; needs parser)
  * lightSetup             (left null; needs parser)

Re-running blend_asset_parser.py on a real Blender install will fill
in the rest.
"""
import json, sqlite3, os
from typing import Any

con = sqlite3.connect(r"G:\AITOOLS\cg-resource-hub\api\data\database.sqlite")
con.row_factory = sqlite3.Row
cur = con.cursor()
rows = cur.execute("""
    SELECT id, title, tagGroups FROM resources
    WHERE tagGroups LIKE '%blend-asset-v1%'
""").fetchall()

for row in rows:
    rid = row["id"]
    tg = json.loads(row["tagGroups"]) if row["tagGroups"] else {}
    summary = tg.get("summary", {})
    actions = summary.get("actions", [])

    # Find the longest-duration camera action (we treat it as the
    # "render frame range" of the scene, since camera actions drive
    # any animation in the scene).
    best = None
    for a in actions:
        frames = a.get("frames", [0, 0])
        dur = a.get("durationSeconds") or 0
        if dur <= 0 or len(frames) != 2:
            continue
        span = frames[1] - frames[0] + 1
        if span <= 0:
            continue
        fps_est = round(span / dur)
        # Prefer the longest-spanning action (most likely the "real"
        # render length, not a tiny 2-frame bone wiggle).
        if best is None or span > best["span"]:
            best = {"span": span, "fps": fps_est, "frames": frames}

    if best is None:
        print(f"id={rid:>3}  no usable actions — skipping")
        continue

    tg["frameStart"] = int(best["frames"][0])
    tg["frameEnd"] = int(best["frames"][1])
    tg["fps"] = int(best["fps"])
    print(
        f"id={rid:>3}  {row['title']:<40}  "
        f"frame {tg['frameStart']}..{tg['frameEnd']}  "
        f"~{tg['fps']} fps  (inferred from actions[])"
    )

    cur.execute(
        "UPDATE resources SET tagGroups = ?, updatedAt = datetime('now') WHERE id = ?",
        (json.dumps(tg, ensure_ascii=False), rid),
    )

con.commit()
con.close()
print("\ndone. Restart API server to pick up changes.")
