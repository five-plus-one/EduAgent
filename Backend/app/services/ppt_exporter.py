import os
import uuid
import collections
import collections.abc

import logging
logger = logging.getLogger(__name__)

# Monkeypatch for Python 3.10+ compatibility with python-pptx
if not hasattr(collections, 'Container'):
    collections.Container = collections.abc.Container
    collections.Mapping = collections.abc.Mapping
    collections.MutableMapping = collections.abc.MutableMapping
    collections.Iterable = collections.abc.Iterable
    collections.MutableSet = collections.abc.MutableSet
    collections.Callable = collections.abc.Callable
    collections.Sequence = collections.abc.Sequence

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
            blank_layout = prs.slide_layouts[6]
            from pptx.util import Inches, Pt
            from pptx.dml.color import RGBColor
            from pptx.enum.text import PP_ALIGN

            def hex2rgb(hex_code):
                try:
                    h = str(hex_code).lstrip('#').strip()
                    if len(h) != 6: return RGBColor(0,0,0)
                    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
                except: return RGBColor(0,0,0)

            raw_data = courseware.ppt_data
            theme = raw_data.get("theme", {}) if isinstance(raw_data, dict) else {}
            slides_array = raw_data.get("ppt_data", []) if isinstance(raw_data, dict) else raw_data
            if not isinstance(slides_array, list): slides_array = []

            # Master Theme Colors
            bg_col = hex2rgb(theme.get("bg_color", "FFFFFF"))
            pri_col = hex2rgb(theme.get("primary", "2B2D42"))
            sec_col = hex2rgb(theme.get("secondary", "8D99AE"))
            acc_col = hex2rgb(theme.get("accent", "EF233C"))
            txt_col = hex2rgb(theme.get("text_color", "000000"))
            
            # Helper to add configured textbox
            def add_text(slide, text, l, t, w, h, size, bold, color, align=None):
                tb = slide.shapes.add_textbox(l, t, w, h)
                tf = tb.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.text = str(text)
                p.font.size = Pt(size)
                p.font.bold = bold
                p.font.color.rgb = color
                if align: p.alignment = align
                return tb

            for page in slides_array:
                slide = prs.slides.add_slide(blank_layout)
                layout_type = page.get("layout_type", "minimal_list")
                
                # Canvas-Design: Draw Solid Background
                background = slide.background
                fill = background.fill
                fill.solid()
                fill.fore_color.rgb = bg_col

                title_text = page.get("title", "")
                
                # Canvas-Design Geometric Accent Lines
                if layout_type == "title_slide":
                    # Giant top accent bar
                    shape = slide.shapes.add_shape(1, Inches(0), Inches(1), Inches(4), Inches(0.2)) # msoShapeRectangle
                    shape.fill.solid()
                    shape.fill.fore_color.rgb = acc_col
                    shape.line.fill.background()
                    
                    add_text(slide, title_text, Inches(1), Inches(2), Inches(8), Inches(1.5), 54, True, txt_col)
                    
                    for idx, elem in enumerate(page.get("elements", [])):
                        content = r'\n'.join(elem.get("content", [])) if isinstance(elem.get("content"), list) else str(elem.get("content", ""))
                        add_text(slide, content, Inches(1), Inches(4 + 1.2*idx), Inches(8), Inches(1), 20, False, sec_col)

                elif layout_type == "two_column":
                    # Left vertical strip
                    shape = slide.shapes.add_shape(1, Inches(0.5), Inches(0.5), Inches(0.1), Inches(6.5))
                    shape.fill.solid()
                    shape.fill.fore_color.rgb = pri_col
                    shape.line.fill.background()
                    
                    add_text(slide, title_text, Inches(0.8), Inches(0.5), Inches(8.5), Inches(0.8), 36, True, txt_col)
                    
                    elements = page.get("elements", [])
                    # Split into left and right
                    left_elems = [e for e in elements if e.get("position", "left") == "left"]
                    right_elems = [e for e in elements if "right" in e.get("position", "left")]
                    if not right_elems and not left_elems:
                        left_elems = elements[:max(1, len(elements)//2)]
                        right_elems = elements[max(1, len(elements)//2):]

                    for idx, e in enumerate(left_elems):
                        content = r'\n'.join(e.get("content", [])) if isinstance(e.get("content"), list) else str(e.get("content", ""))
                        add_text(slide, content, Inches(0.8), Inches(1.8 + idx*1.5), Inches(4), Inches(4), 16, False, txt_col)
                    
                    for idx, e in enumerate(right_elems):
                        content = r'\n'.join(e.get("content", [])) if isinstance(e.get("content"), list) else str(e.get("content", ""))
                        # Draw aesthetic container background for right columns (Accent colored card)
                        card = slide.shapes.add_shape(1, Inches(5.2), Inches(1.6 + idx*2), Inches(4.2), Inches(1.8))
                        card.fill.solid()
                        card.fill.fore_color.rgb = pri_col # Theme primary color fill
                        card.line.fill.background()
                        add_text(slide, content, Inches(5.4), Inches(1.8 + idx*2), Inches(3.8), Inches(1.4), 14, False, bg_col)

                elif layout_type == "stat_callout":
                    add_text(slide, title_text, Inches(0.5), Inches(0.5), Inches(9), Inches(1), 32, True, txt_col)
                    for idx, e in enumerate(page.get("elements", [])):
                        content = r'\n'.join(e.get("content", [])) if isinstance(e.get("content"), list) else str(e.get("content", ""))
                        if e.get("is_accent") or e.get("type") in ["huge_number", "stat"]:
                            # Huge text centered
                            add_text(slide, content, Inches(0.5), Inches(2 + idx*1.5), Inches(9), Inches(2), 64, True, acc_col, PP_ALIGN.CENTER)
                        else:
                            add_text(slide, content, Inches(1), Inches(2 + idx*1.5), Inches(8), Inches(1.5), 18, False, sec_col, PP_ALIGN.CENTER)

                else: # minimal_list or fallback
                    # Quiet elegant title with no line
                    add_text(slide, title_text, Inches(1), Inches(0.8), Inches(8), Inches(1), 28, True, pri_col)
                    for idx, e in enumerate(page.get("elements", [])):
                        content = r'\n'.join(e.get("content", [])) if isinstance(e.get("content"), list) else str(e.get("content", ""))
                        add_text(slide, "— " + content, Inches(1), Inches(2.2 + idx*1.2), Inches(8), Inches(1), 16, False, txt_col)

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
            import traceback
            task.status = "failed"
            task.result_data = {"error": "Error composing PPT. Missing python-pptx requirement?", "details": str(file_exp), "trace": traceback.format_exc()}
        db.commit()
    except Exception as e:
        logger.error(f"Export Task Failed for session {session_id}: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        task.status = "failed"
        task.result_data = {"error": str(e)}
        db.commit()
    finally:
        db.close()
