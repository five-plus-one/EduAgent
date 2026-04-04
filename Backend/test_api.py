import sqlite3
import json
import urllib.request

db = sqlite3.connect('edu_agent.db')
c = db.cursor()
c.execute('SELECT id FROM user ORDER BY id DESC LIMIT 1')
c.execute('SELECT token FROM user_tokens ORDER BY id DESC LIMIT 1') # wait, let's just use first user. actually, auth might not be in db.
