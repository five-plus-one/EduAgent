"""
One-time migration: add user_id column to document table
Run from Backend/ directory with: conda run -n eduagent python migrate_doc_user_id.py
"""
from app.db.session import engine
from sqlalchemy import text

with engine.connect() as conn:
    result = conn.execute(text("PRAGMA table_info(document)"))
    cols = [row[1] for row in result.fetchall()]
    print("Current columns:", cols)
    
    if 'user_id' not in cols:
        conn.execute(text("ALTER TABLE document ADD COLUMN user_id VARCHAR REFERENCES user(id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_user_id ON document(user_id)"))
        conn.commit()
        print("Migration: user_id column added to 'document' table.")
    else:
        print("Migration: user_id column already exists, skipping.")
