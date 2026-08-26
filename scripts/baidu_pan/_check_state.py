import sqlite3
con = sqlite3.connect(r'G:\AITOOLS\cg-resource-hub\api\data\database.sqlite')
for r in con.execute("SELECT id,title,imageUrl,fileUrl,panCode FROM resources WHERE category='Blender' ORDER BY id"):
    print(r)
