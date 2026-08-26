"""Download the 14 official Blender splash images from blender.org and
re-point the corresponding DB resources to them.

Each map entry: (resource_id, version, url).  Files saved as
web/public/splashes/blender-<version>.jpg.  DB column imageUrl is
set to /splashes/blender-<version>.jpg.
"""
from __future__ import annotations

import sqlite3
import sys
import urllib.request
from pathlib import Path

SPLASHES = [
    # (resource_id, version-string, url)
    (33, "2.77", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-77/screen-shot-2016-09-23-at-14-22-47-1987d6bb742746f1acce4393f6ef7222-m.jpg"),
    (20, "2.78", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-78/screen-shot-2016-09-23-at-12-42-48-541786109baf428e898280c4c9e940b3-m.jpg"),
    (21, "2.79", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-79/screenshot-02-08-17-114728-a96608b8b86e42fdb7f31320353c92a7-m.jpg"),
    (22, "2.80", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-80/splash_screen_2-8-packed-69962501935a4474ad0ccdd4a67b6240-m.jpg"),
    (23, "2.81", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-81/splash_2x-d1fc9c369f0a41ed97318aec19ab66b3-m.png"),
    (24, "2.82", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-82/splash_2x-d45b4b38964d489083f08660a3b46cda-m.png"),
    (25, "2.83", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-83-lts/blender-2-83-f617e0c81e604a078a3ab70093dc37f2-m.jpg"),
    (26, "2.90", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-90/splash_boost-11079d8fb0454175b840e1a4c6355d4c-m.png"),
    (17, "2.91", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-91/splash-b3bdc8e3ba5843368cd5c148098c471e-m.png"),
    (27, "2.92", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-92/splash-c94ffb3c51b045aa8605209be2f2da95-m.png"),
    (28, "2.93", "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-93-lts/splash-0cc19fae09184a30869f2efa7b37ccc6-m.png"),
    (29, "3.0",  "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-3-0/splash_2x-d4993dd5743940fe823bd89fcba0c651-m.png"),
    (30, "3.1",  "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-3-1/splash-3f7c718b93db406d8a128a824a3361f6-m.png"),
    (31, "3.2",  "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-3-2/blender_32_splash_s-d0c4b1421e254401b496f0a76837f6d1-m.jpg"),
    # Newer releases — direct images on blender.org wp-content/uploads
    (32, "3.3",  "https://www.blender.org/wp-content/uploads/2022/08/splash_blender_33_lts.jpg"),
    (35, "3.5",  "https://www.blender.org/wp-content/uploads/2023/03/blender_35_splash_nicole_morena.jpg"),
    (37, "4.0",  "https://www.blender.org/wp-content/uploads/2023/10/blender_40_splash.jpg"),
    (40, "4.5",  "https://www.blender.org/wp-content/uploads/2025/06/blender_splash_45.webp"),
    # Latest ones — pulled from each release page og:image / hero image
    (19, "2.74", "https://www.blender.org/wp-content/uploads/2013/04/splash274_cat_manu_jarvinen.jpg"),
    (34, "3.4",  "https://www.blender.org/wp-content/uploads/2022/11/splash_wide.jpg"),
    (36, "3.6",  "https://www.blender.org/wp-content/uploads/2023/05/blender_36_lts_splash.jpg"),
    (39, "4.2",  "https://www.blender.org/wp-content/uploads/2024/07/splash.webp"),
    (38, "4.1",  "https://www.blender.org/wp-content/uploads/2024/03/blender_4_1_splash.jpg"),
    (41, "5.1",  "https://www.blender.org/wp-content/uploads/2026/02/splash.webp"),
    (42, "5.2",  "https://www.blender.org/wp-content/uploads/2026/06/splash5_2.webp"),
]

WEB_PUBLIC = Path(r"G:\AITOOLS\cg-resource-hub\web\public\splashes")
DB = Path(r"G:\AITOOLS\cg-resource-hub\api\data\database.sqlite")


def ext_of(url: str) -> str:
    if url.endswith(".jpg"):  return ".jpg"
    if url.endswith(".webp"): return ".webp"
    return ".png"


def main() -> int:
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB))
    ok = 0
    for rid, ver, url in SPLASHES:
        ext = ext_of(url)
        out = WEB_PUBLIC / f"blender-{ver}{ext}"
        try:
            print(f"[id={rid:>2}] {ver}  downloading {url[-60:]}", end=" ... ", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r, open(out, "wb") as f:
                while chunk := r.read(1 << 16):
                    f.write(chunk)
            size_kb = out.stat().st_size // 1024
            rel_url = f"/splashes/{out.name}"
            con.execute(
                "UPDATE resources SET imageUrl = ?, updatedAt = datetime('now') WHERE id = ?",
                (rel_url, rid),
            )
            print(f"OK ({size_kb} KB) -> {rel_url}")
            ok += 1
        except Exception as e:
            print(f"FAIL: {e}")
    con.commit()
    con.close()
    print(f"\n{ok}/{len(SPLASHES)} updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
