import os
import uuid
try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
except ImportError:
    pass
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.generation import GenerationTask, Courseware

EXPORT_DIR = os.path.join(os.getcwd(), "uploads", "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)

def run_export_task(task_id: str, session_id: str):
    db: Session = SessionLocal()
    task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
    if not task:
        db.close()
        return

    try:
        task.stage = "reading_courseware"
        task.progress = 10
        db.commit()

        courseware = db.query(Courseware).filter(Courseware.session_id == session_id).first()
        if not courseware or not courseware.ppt_data:
            raise ValueError("No courseware found to export")

        task.stage = "rendering_ppt"
        task.progress = 50
        db.commit()

        try:
            prs = Presentation()
            blank_slide_layout = prs.slide_layouts[6]

            for page in courseware.ppt_data:
                slide = prs.slides.add_slide(blank_slide_layout)
                
                # Add Title
                txBox = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(9), Inches(1))
                tf = txBox.text_frame
                tf.text = page.get("title", "Untitled")
                if tf.paragraphs:
                    p = tf.paragraphs[0]
                    p.font.size = Pt(36)
                    p.font.bold = True
                
                for elem in page.get("elements", []):
                    if elem.get("type") == "text_block":
                        content = "\n".join(elem.get("content", []))
                        pos = elem.get("position", "center")
                        left, top, width, height = Inches(1), Inches(2), Inches(8), Inches(4)
                        
                        if pos == "left":
                            width = Inches(4)
                        elif pos == "right" or "right" in pos:
                            left = Inches(5)
                            width = Inches(4)
                        
                        body_box = slide.shapes.add_textbox(left, top, width, height)
                        body_tf = body_box.text_frame
                        body_tf.word_wrap = True
                        body_tf.text = content

            task.stage = "saving_file"
            task.progress = 90
            db.commit()

            filename = f"export_{session_id}_{uuid.uuid4().hex[:6]}.pptx"
            file_path = os.path.join(EXPORT_DIR, filename)
            prs.save(file_path)

            task.status = "completed"
            task.progress = 100
            task.result_data = {"download_urls": {"ppt_url": f"/api/v1/export/download/{filename}"}}
        except Exception as file_exp:
            task.status = "failed"
            task.result_data = {"error": "Error composing PPT. Missing python-pptx requirement?", "details": str(file_exp)}
        db.commit()
    except Exception as e:
        task.status = "failed"
        task.result_data = {"error": str(e)}
        db.commit()
    finally:
        db.close()
