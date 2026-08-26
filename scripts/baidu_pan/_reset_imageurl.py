import sqlite3
con = sqlite3.connect(r'G:\AITOOLS\cg-resource-hub\api\data\database.sqlite')
cur = con.execute("UPDATE resources SET imageUrl='' WHERE category='Blender'")
con.commit()
print('reset imageUrl for', cur.rowcount, 'rows')
