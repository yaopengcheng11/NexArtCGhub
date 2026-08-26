import sqlite3, os
con = sqlite3.connect(r'G:\AITOOLS\cg-resource-hub\api\data\database.sqlite')
rows = con.execute(
    "SELECT id,title,imageUrl,category FROM resources WHERE category='Blender' ORDER BY id"
).fetchall()
have, miss = 0, 0
for rid, title, iu, cat in rows:
    p = f'G:/AITOOLS/cg-resource-hub/data/blend_assets/{rid}/thumbnail.png'
    ok = os.path.exists(p)
    print(f'{rid:>3}  {title:<26}  thumb={"Y" if ok else "N"}  iu={iu or ""}')
    if ok: have += 1
    else: miss += 1
print(f'\nhave={have}  miss={miss}')
