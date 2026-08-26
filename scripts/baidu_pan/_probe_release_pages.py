"""Fetch each release page and pull the og:image / first big splash image."""
import re
import urllib.request

PAGES = {
    "2.74": "https://www.blender.org/download/releases/2-74/",
    "3.4":  "https://www.blender.org/download/releases/3-4/",
    "3.6":  "https://www.blender.org/download/releases/3-6/",
    "4.1":  "https://www.blender.org/download/releases/4-1/",
    "4.2":  "https://www.blender.org/download/releases/4-2/",
    "5.2":  "https://www.blender.org/download/releases/5-2/",
}

for ver, page in PAGES.items():
    print(f"== {ver}  {page}")
    try:
        req = urllib.request.Request(page, headers={"User-Agent": "Mozilla/5.0"})
        html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"   -- {e}")
        continue
    # og:image
    m = re.search(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if m:
        print(f"   og: {m.group(1)}")
    # og:image first
    m = re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']', html, re.I)
    if m and not m.group(1).endswith((".png", ".jpg", ".webp")):
        pass
    # First /wp-content/uploads image
    imgs = re.findall(r'https?://www\.blender\.org/wp-content/uploads/[^"\']+\.(?:jpg|png|webp)', html, re.I)
    seen = set()
    for u in imgs:
        if u not in seen:
            seen.add(u)
            print(f"   img: {u}")
            if len(seen) >= 5:
                break
