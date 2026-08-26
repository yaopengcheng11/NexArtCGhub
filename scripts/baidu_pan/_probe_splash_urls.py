"""Probe candidate splash URLs and pick the first 200 per version."""
import urllib.request

CANDIDATES = {
    "2.74": [
        "https://www.blender.org/wp-content/uploads/2014/03/splash_274.jpg",
        "https://www.blender.org/wp-content/uploads/2014/03/blender_274_splash.jpg",
        "https://download.blender.org/demo-files/archives/art-gallery/blender-splash-screens/blender-2-74/splash_2x.jpg",
    ],
    "3.4": [
        "https://www.blender.org/wp-content/uploads/2022/12/blender_34_splash.jpg",
        "https://www.blender.org/wp-content/uploads/2022/12/blender_34_charge_splash.jpg",
    ],
    "3.6": [
        "https://www.blender.org/wp-content/uploads/2023/06/blender_36_splash.jpg",
        "https://www.blender.org/wp-content/uploads/2023/06/blender_36_pet_projects_splash.jpg",
    ],
    "4.1": [
        "https://www.blender.org/wp-content/uploads/2024/03/blender_41_splash.jpg",
        "https://www.blender.org/wp-content/uploads/2024/03/blender_41_lynx_splash.jpg",
    ],
    "4.2": [
        "https://www.blender.org/wp-content/uploads/2024/07/blender_42_splash.jpg",
        "https://www.blender.org/wp-content/uploads/2024/07/blender_42_lts_splash.jpg",
    ],
    "5.1": [
        "https://www.blender.org/wp-content/uploads/2026/02/splash.webp",
        "https://www.blender.org/wp-content/uploads/2026/02/blender_51_splash.webp",
    ],
    "5.2": [
        "https://www.blender.org/wp-content/uploads/2026/09/blender_52_splash.jpg",
        "https://www.blender.org/wp-content/uploads/2026/09/blender_52_panthera_splash.jpg",
    ],
}

for ver, urls in CANDIDATES.items():
    print(f"== {ver} ==")
    for u in urls:
        try:
            req = urllib.request.Request(u, method="HEAD",
                                          headers={"User-Agent": "Mozilla/5.0"})
            r = urllib.request.urlopen(req, timeout=10)
            size = r.headers.get("Content-Length", "?")
            print(f"  OK  {r.status}  {size}  {u}")
        except Exception as e:
            print(f"  --  {e}  {u}")
