from app.db.session import SessionLocal
from app.models.generation import Courseware, GenerationTask
from app.models.session import SessionContext
import json

db = SessionLocal()
print("Checking DB...")
sessions = db.query(SessionContext).count()
print(f"Sessions: {sessions}")
cw_count = db.query(Courseware).count()
print(f"Courseware: {cw_count}")

tasks = db.query(GenerationTask).filter(GenerationTask.status != 'completed').all()
for t in tasks:
    print(f"Task {t.id} ({t.task_type}): {t.status} - {t.result_data}")

db.close()
