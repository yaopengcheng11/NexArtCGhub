"""Reset imageUrl for all current Blender resources to the static
/splashes/* paths we downloaded earlier (and which are still on disk
under web/public/splashes/).

Mapping is by title → version.  Singularity (formerly id 41) is now id
69 because the DB was reset by the server's migrations between
sessions; the title-based lookup is robust to that.
"""
import sqlite3
from pathlib import Path

DB = r'G:\AITOOLS\cg-resource-hub\api\data\database.sqlite'
SPLASH_DIR = Path(r'G:\AITOOLS\cg-resource-hub\web\public\splashes')

# Map title (case-insensitive) -> version.  Anything not listed here
# is left alone (the DB still has its /api/blend-assets/<id>/thumbnail
# fallback which is what the API serves).
TITLE_TO_VERSION = {
    "fishy cat": "2.74",
    "racing car": "2.77",
    "procedural": "2.78",
    "agent 327": "2.79",
    "spring": "2.80",
    "the junk shop": "2.81",
    "tram station": "2.82",
    "partytug 6am": "2.83",
    "splash fox": "2.90",
    "red autumn forest": "2.91",
    "sinosauropteryx prima": "2.92",
    "still life": "2.93",
    "sprite fright": "3.0",
    "secret deer": "3.1",
    "ship wakes": "3.2",
    "scanlands": "3.3",
    "racing car (2.77)": "2.77",
    "charge": "3.4",
    "cozy kitchen": "3.5",
    "pet projects": "3.6",
    "gaku": "4.0",
    "lynxsdesign": "4.1",
    "gold": "4.2",
    "dogwalk": "4.5",
    "singularity": "5.1",
    "panthera spelaea": "5.2",
}


def splash_for(version: str) -> str | None:
    for ext in (".jpg", ".png", ".webp"):
        p = SPLASH_DIR / f"blender-{version}{ext}"
        if p.is_file():
            return f"/splashes/{p.name}"
    return None


def main() -> int:
    con = sqlite3.connect(DB)
    rows = con.execute("SELECT id,title,imageUrl FROM resources WHERE category='Blender' ORDER BY id").fetchall()
    updated = 0
    for rid, title, cur in rows:
        ver = TITLE_TO_VERSION.get(title.strip().lower())
        if not ver:
            print(f"  id={rid:>2}  no-version  {title!r}  (keeping {cur!r})")
            continue
        rel = splash_for(ver)
        if not rel:
            print(f"  id={rid:>2}  ver={ver}  no-file  {title!r}")
            continue
        if cur == rel:
            print(f"  id={rid:>2}  ver={ver}  already {rel}")
            continue
        con.execute("UPDATE resources SET imageUrl=?, updatedAt=datetime('now') WHERE id=?",
                    (rel, rid))
        print(f"  id={rid:>2}  ver={ver}  {cur!r}  ->  {rel}")
        updated += 1
    con.commit()
    con.close()
    print(f"\n{updated} rows updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
