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
            
            import re

            def strip_markdown(text: str) -> str:
                """Strip common markdown syntax to plain text for PPTX."""
                if not text:
                    return ""
                # Remove bold/italic markers
                text = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', text)
                # Remove inline code
                text = re.sub(r'`(.+?)`', r'\1', text)
                # Remove leading list markers (-, *, + followed by space)
                text = re.sub(r'^[\-\*\+]\s+', '', text, flags=re.MULTILINE)
                # Remove leading numbered list markers
                text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
                # Remove heading markers
                text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
                # Remove blockquote markers
                text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
                # Clean up extra spaces
                text = text.strip()
                return text

            def add_text_rich(slide, text, l, t, w, h, size, bold_default, color, align=None, accent_color=None):
                """Add a textbox with markdown **bold** converted to real PPTX bold runs."""
                from pptx.util import Pt
                from pptx.oxml.ns import qn
                
                tb = slide.shapes.add_textbox(l, t, w, h)
                tf = tb.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                if align:
                    p.alignment = align

                # Parse **bold** spans using regex
                segments = re.split(r'(\*\*[^*]+\*\*)', str(text))
                for seg in segments:
                    if not seg:
                        continue
                    bold_match = re.match(r'\*\*([^*]+)\*\*', seg)
                    run = p.add_run()
                    if bold_match:
                        run.text = bold_match.group(1)
                        run.font.bold = True
                        run.font.size = Pt(size)
                        run.font.color.rgb = accent_color if accent_color else color
                    else:
                        # Still strip other markdown from plain segments
                        run.text = strip_markdown(seg)
                        run.font.bold = bold_default
                        run.font.size = Pt(size)
                        run.font.color.rgb = color
                
                # Fallback: if no runs were added, just add plain text
                if not p.runs:
                    run = p.add_run()
                    run.text = strip_markdown(str(text))
                    run.font.bold = bold_default
                    run.font.size = Pt(size)
                    run.font.color.rgb = color
                
                return tb

            # Legacy simple helper (for title text where bold/markdown not expected)
            def add_text(slide, text, l, t, w, h, size, bold, color, align=None):
                tb = slide.shapes.add_textbox(l, t, w, h)
                tf = tb.text_frame
                tf.word_wrap = True
                p = tf.paragraphs[0]
                p.text = strip_markdown(str(text))
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

                def get_content(elem) -> str:
                    raw = elem.get("content", [])
                    if isinstance(raw, list):
                        return "\n".join(str(c) for c in raw)
                    return str(raw) if raw else ""

                # Canvas-Design Geometric Accent Lines
                if layout_type in ("cover", "title_slide"):
                    # Giant top accent bar
                    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(0.3))
                    bar.fill.solid()
                    bar.fill.fore_color.rgb = acc_col
                    bar.line.fill.background()

                    add_text(slide, title_text, Inches(0.8), Inches(1.4), Inches(8.4), Inches(2.4), 52, True, pri_col)

                    for idx, elem in enumerate(page.get("elements", [])):
                        content = get_content(elem)
                        etype = elem.get("type", "text_block")
                        y_pos = Inches(4.2 + idx * 0.85)
                        if etype == "subtitle":
                            add_text(slide, content, Inches(0.8), y_pos, Inches(8.4), Inches(0.8), 24, False, sec_col)
                        else:
                            add_text_rich(slide, content, Inches(0.8), y_pos, Inches(8.4), Inches(0.8), 18, False, txt_col, accent_color=acc_col)

                elif layout_type == "two_column":
                    strip = slide.shapes.add_shape(1, Inches(0.5), Inches(0.5), Inches(0.08), Inches(6.5))
                    strip.fill.solid()
                    strip.fill.fore_color.rgb = acc_col
                    strip.line.fill.background()

                    add_text(slide, title_text, Inches(0.8), Inches(0.3), Inches(8.5), Inches(0.8), 32, True, txt_col)

                    elements = page.get("elements", [])
                    left_elems = [e for e in elements if e.get("position", "left") == "left"]
                    right_elems = [e for e in elements if "right" in str(e.get("position", ""))]
                    if not left_elems and not right_elems:
                        left_elems = elements[:max(1, len(elements)//2)]
                        right_elems = elements[max(1, len(elements)//2):]

                    for idx, e in enumerate(left_elems):
                        content = get_content(e)
                        add_text_rich(slide, content, Inches(0.8), Inches(1.5 + idx*1.5), Inches(4.2), Inches(1.4), 15, False, txt_col, accent_color=acc_col)

                    for idx, e in enumerate(right_elems):
                        content = get_content(e)
                        is_big = e.get("is_accent", False) or e.get("type") == "huge_number"
                        if is_big:
                            add_text_rich(slide, content, Inches(5.2), Inches(1.5 + idx*2), Inches(4.2), Inches(2), 48, True, acc_col, PP_ALIGN.CENTER, accent_color=acc_col)
                        else:
                            card = slide.shapes.add_shape(1, Inches(5.2), Inches(1.4 + idx*2), Inches(4.2), Inches(1.8))
                            card.fill.solid()
                            card.fill.fore_color.rgb = pri_col
                            card.line.fill.background()
                            add_text_rich(slide, content, Inches(5.4), Inches(1.55 + idx*2), Inches(3.8), Inches(1.4), 14, False, bg_col, accent_color=bg_col)

                elif layout_type == "stat_callout":
                    add_text(slide, title_text, Inches(0.5), Inches(0.4), Inches(9), Inches(1), 32, True, txt_col)
                    uline = slide.shapes.add_shape(1, Inches(0.5), Inches(1.3), Inches(2), Inches(0.06))
                    uline.fill.solid()
                    uline.fill.fore_color.rgb = acc_col
                    uline.line.fill.background()
                    for idx, e in enumerate(page.get("elements", [])):
                        content = get_content(e)
                        if e.get("is_accent") or e.get("type") in ["huge_number", "stat"]:
                            add_text(slide, content, Inches(0.5), Inches(1.8 + idx*2.0), Inches(9), Inches(2.2), 72, True, acc_col, PP_ALIGN.CENTER)
                        else:
                            add_text_rich(slide, content, Inches(1), Inches(2.0 + idx*1.5), Inches(8), Inches(1.4), 18, False, txt_col, PP_ALIGN.CENTER, accent_color=acc_col)

                else:  # minimal_list / timeline / fallback
                    topbar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(0.18))
                    topbar.fill.solid()
                    topbar.fill.fore_color.rgb = pri_col
                    topbar.line.fill.background()

                    add_text(slide, title_text, Inches(0.8), Inches(0.35), Inches(8.5), Inches(1), 30, True, pri_col)

                    for idx, e in enumerate(page.get("elements", [])):
                        content = get_content(e)
                        is_accent = e.get("is_accent", False) or e.get("type") == "huge_number"
                        y = Inches(1.6 + idx * 1.3)
                        if is_accent:
                            add_text_rich(slide, content, Inches(0.8), y, Inches(8.4), Inches(1.3), 36, True, acc_col, None, accent_color=acc_col)
                        else:
                            dot = slide.shapes.add_shape(9, Inches(0.65), y + Inches(0.15), Inches(0.12), Inches(0.12))
                            dot.fill.solid()
                            dot.fill.fore_color.rgb = acc_col
                            dot.line.fill.background()
                            add_text_rich(slide, content, Inches(0.9), y, Inches(8.6), Inches(1.2), 15, False, txt_col, None, accent_color=acc_col)

            task.stage = "saving_file"
            task.progress = 90
            db.commit()

            filename = f"export_{session_id}_{uuid.uuid4().hex[:6]}.pptx"
            file_path = os.path.join(EXPORT_DIR, filename)
            prs.save(file_path)

            task.status = "completed"
            task.progress = 100
            task.result_data = {
                "download_urls": {"ppt_url": f"/api/v1/export/download/{filename}"},
                "filename": filename
            }
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
