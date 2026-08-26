"""
DB ops against the cg-resource-hub resources table.

The DB lives at `<project>/api/data/database.sqlite` (relative to the
project root, see api/server/db.ts for the canonical path).  We open
it in read-write mode and use plain sqlite3 — no ORM, no migrations
(those are owned by api/server/db.ts).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Final, Optional

# Project-relative; resolved from the parent of `scripts/baidu_pan/`.
PROJECT_ROOT: Final[Path] = Path(__file__).resolve().parents[3]
DB_PATH: Final[Path] = PROJECT_ROOT / "api" / "data" / "database.sqlite"


def connect() -> sqlite3.Connection:
    if not DB_PATH.is_file():
        raise FileNotFoundError(
            f"resources DB not found at {DB_PATH}. "
            f"Has the API server been started at least once (it runs migrations)?"
        )
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


# --- reads ------------------------------------------------------------

def get_resource(resource_id: int) -> Optional[dict[str, Any]]:
    with connect() as con:
        row = con.execute(
            "SELECT id, title, description, category, tags, imageUrl, fileUrl, "
            "panCode, downloadCount, createdAt, updatedAt, tagGroups "
            "FROM resources WHERE id = ?",
            (resource_id,),
        ).fetchone()
        return dict(row) if row else None


def find_by_title_software(title: str, software: str) -> Optional[dict[str, Any]]:
    """Find a resource by title + the software it belongs to.

    Matching strategy: title is compared exactly (case-insensitive).
    For software we use the resource's `category` field as a hint and
    also peek at `tagGroups.software[]`.  The first match wins.
    """
    needle_title = title.strip().lower()
    with connect() as con:
        rows = con.execute(
            "SELECT id, title, category, tagGroups, fileUrl, panCode "
            "FROM resources"
        ).fetchall()
    target_sw = software.strip().lower()
    for r in rows:
        if (r["title"] or "").strip().lower() != needle_title:
            continue
        if (r["category"] or "").strip().lower() == target_sw:
            return dict(r)
        # Try tagGroups.software[]
        tg = r["tagGroups"] or ""
        if target_sw in tg.lower():
            return dict(r)
    return None


def list_all() -> list[dict[str, Any]]:
    with connect() as con:
        rows = con.execute(
            "SELECT id, title, category, fileUrl, panCode, tagGroups "
            "FROM resources ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]


# --- writes -----------------------------------------------------------

def insert_resource(
    *,
    title: str,
    file_url: str,
    pan_code: Optional[str],
    category: str,
    description: str = "",
    tags: str = "[]",
    image_url: str = "",
    tag_groups: Optional[dict] = None,
) -> int:
    """INSERT a new resource row.  Returns the new id."""
    tg_json = None
    if tag_groups is not None:
        import json
        tg_json = json.dumps(tag_groups, ensure_ascii=False)
    with connect() as con:
        cur = con.execute(
            "INSERT INTO resources "
            "(title, description, category, tags, imageUrl, fileUrl, panCode, tagGroups) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (title, description, category, tags, image_url, file_url,
             pan_code, tg_json),
        )
        con.commit()
        return int(cur.lastrowid)


def update_file_url(
    resource_id: int, *, file_url: str, pan_code: Optional[str]
) -> None:
    with connect() as con:
        con.execute(
            "UPDATE resources SET fileUrl = ?, panCode = ?, updatedAt = datetime('now') "
            "WHERE id = ?",
            (file_url, pan_code, resource_id),
        )
        con.commit()


def update_title(resource_id: int, new_title: str) -> None:
    with connect() as con:
        con.execute(
            "UPDATE resources SET title = ?, updatedAt = datetime('now') WHERE id = ?",
            (new_title, resource_id),
        )
        con.commit()


def update_category_and_tags(
    resource_id: int,
    *,
    category: str,
    tag_groups: Optional[dict] = None,
) -> None:
    with connect() as con:
        if tag_groups is not None:
            import json
            con.execute(
                "UPDATE resources SET category = ?, tagGroups = ?, "
                "updatedAt = datetime('now') WHERE id = ?",
                (category, json.dumps(tag_groups, ensure_ascii=False), resource_id),
            )
        else:
            con.execute(
                "UPDATE resources SET category = ?, updatedAt = datetime('now') WHERE id = ?",
                (category, resource_id),
            )
        con.commit()


def delete_resource(resource_id: int) -> None:
    with connect() as con:
        con.execute("DELETE FROM resources WHERE id = ?", (resource_id,))
        con.commit()


# --- collection share links -------------------------------------------

def upsert_collection_share(
    resource_id: int,
    collection_name: str,
    *,
    file_url: str,
    pan_code: Optional[str],
    baidu_path: str,
    size_bytes: Optional[int] = None,
) -> int:
    """INSERT or UPDATE the share link for one (resource, collection) pair.

    Returns the row id.
    """
    with connect() as con:
        con.execute("""
            INSERT INTO collectionShareLinks
              (resourceId, collectionName, fileUrl, panCode, baiduPath, sizeBytes, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(resourceId, collectionName) DO UPDATE SET
              fileUrl = excluded.fileUrl,
              panCode = excluded.panCode,
              baiduPath = excluded.baiduPath,
              sizeBytes = excluded.sizeBytes,
              updatedAt = datetime('now')
        """, (resource_id, collection_name, file_url, pan_code, baidu_path, size_bytes))
        row = con.execute(
            "SELECT id FROM collectionShareLinks WHERE resourceId = ? AND collectionName = ?",
            (resource_id, collection_name),
        ).fetchone()
        con.commit()
        return int(row["id"])


def list_collection_shares(resource_id: int) -> list[dict[str, Any]]:
    with connect() as con:
        rows = con.execute(
            "SELECT id, collectionName, fileUrl, panCode, baiduPath, sizeBytes, "
            "createdAt, updatedAt FROM collectionShareLinks "
            "WHERE resourceId = ? ORDER BY collectionName",
            (resource_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_collection_share(resource_id: int, collection_name: str) -> Optional[dict[str, Any]]:
    with connect() as con:
        row = con.execute(
            "SELECT id, collectionName, fileUrl, panCode, baiduPath, sizeBytes "
            "FROM collectionShareLinks WHERE resourceId = ? AND collectionName = ?",
            (resource_id, collection_name),
        ).fetchone()
        return dict(row) if row else None


def delete_collection_share(resource_id: int, collection_name: str) -> None:
    with connect() as con:
        con.execute(
            "DELETE FROM collectionShareLinks WHERE resourceId = ? AND collectionName = ?",
            (resource_id, collection_name),
        )
        con.commit()
