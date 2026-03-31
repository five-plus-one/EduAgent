from app.db.session import SessionLocal
from app.models.generation import Courseware
from app.models.session import SessionContext

db = SessionLocal()
sessions = db.query(SessionContext).order_by(SessionContext.created_at.desc()).limit(5).all()
for s in sessions:
    cw = db.query(Courseware).filter(Courseware.session_id == s.id).first()
    if cw and cw.ppt_data:
        slides = cw.ppt_data.get('ppt_data', [])
        print(f'Session {s.id} ({s.course_name}): {len(slides)} slides')
        if slides:
            p1 = slides[0]
            print(f'  Page1 title : {p1.get("title", p1.get("content","")[:60])}')
    else:
        print(f'Session {s.id} ({s.course_name}): NO courseware')
db.close()
print("Import OK!")
