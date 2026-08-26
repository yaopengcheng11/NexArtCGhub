"""
Path derivation for baidu-pan resource storage.

Convention (2026-08-24, see docs/BAIDU_PAN.md):

    /apps/bdpan/CGResourcesHub/
    ├── <SoftwareFolder>/              ← e.g. Blender, UnrealEngine, Maya
    │   └── <TitleSlug>_full.zip      ← PascalCase slug, no spaces

Two pure functions + one composer:

    sanitize_software("Unreal Engine") -> "UnrealEngine"
    slugify_title("Red Autumn Forest") -> "RedAutumnForest"
    baidu_path(software, title)        -> "/apps/bdpan/CGResourcesHub/UnrealEngine/RedAutumnForest_full.zip"

Sanitization rules
==================
* Strip leading/trailing whitespace.
* Split on any non-alphanumeric run; keep letters and digits.
* Capitalize each word (PascalCase). Preserve internal digits verbatim.
* If the result is empty, fall back to "Other".
* If the result is a reserved-only string (e.g. just ".."), reject.

These two functions are the single source of truth for filesystem
naming. The DB stores display names; this module projects them to
filesystem-safe names.
"""
from __future__ import annotations

import re
from typing import Final

ROOT: Final[str] = "/apps/bdpan/CGResourcesHub"
FALLBACK_SOFTWARE: Final[str] = "Other"
FILE_SUFFIX: Final[str] = "_full.zip"

# Software names that don't roundtrip cleanly through the auto-sanitize
# rule (e.g. "3ds Max" must become "3dsMax" not "3DsMax").  Add entries
# here when a new software shows up whose canonical display name does
# not match its filesystem folder name.  Keys are display names
# (case-insensitive match on input); values are the canonical folder
# names.
SOFTWARE_FOLDER_OVERRIDES: Final[dict[str, str]] = {
    "ue":                "UnrealEngine",
    "unreal":            "UnrealEngine",
    "unreal engine":     "UnrealEngine",
    "ue5":               "UnrealEngine",
    "ue4":               "UnrealEngine",
    "3dsmax":            "3dsMax",
    "3ds max":           "3dsMax",
    "3ds":               "3dsMax",
    "max":               "3dsMax",
    "c4d":               "Cinema4D",
    "cinema 4d":         "Cinema4D",
    "cinema4d":          "Cinema4D",
    "substance":         "SubstancePainter",
    "substance painter": "SubstancePainter",
    "zbrush":            "ZBrush",
    "z brush":           "ZBrush",
    "blender":           "Blender",
    "blend":             "Blender",
    "houdini":           "Houdini",
    "maya":              "Maya",
    "nuke":              "Nuke",
}

# --- software -> folder ------------------------------------------------

def sanitize_software(name: str | None) -> str:
    """Project a display name to a filesystem-safe folder name.

    >>> sanitize_software("Unreal Engine")
    'UnrealEngine'
    >>> sanitize_software("3ds Max")
    '3dsMax'
    >>> sanitize_software("")
    'Other'
    """
    if not name:
        return FALLBACK_SOFTWARE
    key = name.strip().lower()
    if key in SOFTWARE_FOLDER_OVERRIDES:
        return SOFTWARE_FOLDER_OVERRIDES[key]
    # Generic PascalCase: split on non-alphanum, capitalize each chunk.
    parts = re.split(r"[^A-Za-z0-9]+", name.strip())
    out = "".join(_cap(p) for p in parts if p)
    return out or FALLBACK_SOFTWARE


# --- title -> filename slug --------------------------------------------

def slugify_title(title: str | None) -> str:
    """Project a resource title to a filename-safe PascalCase slug.

    >>> slugify_title("Red Autumn Forest")
    'RedAutumnForest'
    >>> slugify_title("Houdini Procedural City Generator")
    'HoudiniProceduralCityGenerator'
    >>> slugify_title("UE5 — Realistic Environment Pack")
    'UE5RealisticEnvironmentPack'
    >>> slugify_title("abc 123 def")
    'Abc123Def'
    """
    if not title or not title.strip():
        raise ValueError("title is required and must be non-empty")
    # Split on any non-alphanumeric run; keep letters and digits.
    parts = re.split(r"[^A-Za-z0-9]+", title.strip())
    out = "".join(_cap(p) for p in parts if p)
    if not out:
        raise ValueError(f"title {title!r} produces empty slug")
    return out


# --- composer ----------------------------------------------------------

def baidu_path(software: str | None, title: str, *, suffix: str = FILE_SUFFIX) -> str:
    """Full baidu-pan path for a resource.

    >>> baidu_path("Blender", "Red Autumn Forest")
    '/apps/bdpan/CGResourcesHub/Blender/RedAutumnForest_full.zip'
    """
    folder = sanitize_software(software)
    slug = slugify_title(title)
    return f"{ROOT}/{folder}/{slug}{suffix}"


def baidu_folder(software: str | None) -> str:
    """Folder path for a software (e.g. '/apps/bdpan/CGResourcesHub/Blender')."""
    return f"{ROOT}/{sanitize_software(software)}"


def baidu_resource_folder(software: str | None, title: str) -> str:
    """Per-resource subfolder (used for per-collection share links).

    Convention (2026-08-24, Option A): one subfolder per resource,
    full zip at the top, per-collection zips inside.

    >>> baidu_resource_folder("Blender", "Red Autumn Forest")
    '/apps/bdpan/CGResourcesHub/Blender/RedAutumnForest'
    """
    folder = sanitize_software(software)
    slug = slugify_title(title)
    return f"{ROOT}/{folder}/{slug}"


def baidu_collection_path(
    software: str | None, title: str, collection_name: str, *, ext: str = ".zip"
) -> str:
    """Per-collection share path. Stored FLAT alongside the main zip
    (baidu's app-data sandbox disallows nested subfolders — verified
    2026-08-24, "路径超出授权目录范围").

    Convention: <Title>_coll_<CollectionName>.zip, sibling of the
    main <Title>_full.zip.

    >>> baidu_collection_path("Blender", "Red Autumn Forest", "Terrains")
    '/apps/bdpan/CGResourcesHub/Blender/RedAutumnForest_coll_Terrains.zip'
    >>> baidu_collection_path("Blender", "Red Autumn Forest", "Trees & Bushes")
    '/apps/bdpan/CGResourcesHub/Blender/RedAutumnForest_coll_TreesBushes.zip'
    """
    folder = sanitize_software(software)
    title_slug = slugify_title(title)
    coll_slug = slugify_title(collection_name)
    return f"{ROOT}/{folder}/{title_slug}_coll_{coll_slug}{ext}"


# --- helpers -----------------------------------------------------------

def _cap(part: str) -> str:
    """Capitalize the first ASCII letter, leave the rest as-is.

    >>> _cap("hello")
    'Hello'
    >>> _cap("123abc")
    '123Abc'
    >>> _cap("UE5")
    'UE5'
    """
    if not part:
        return part
    # If first char is a letter, uppercase it. Otherwise find first letter.
    if part[0].isalpha():
        return part[0].upper() + part[1:]
    for i, ch in enumerate(part):
        if ch.isalpha():
            return part[:i] + ch.upper() + part[i + 1:]
    return part
