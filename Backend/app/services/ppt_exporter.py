import os
import re
import uuid
import collections
import collections.abc
import logging

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Premium Theme Dictionary (mirrors frontend PREMIUM_THEMES)
# ──────────────────────────────────────────────
PREMIUM_THEMES = {
    # Light Themes
    "modern_minimalist":  {"bg_color": "#F8FAFC", "primary": "#0F172A", "secondary": "#64748B", "accent": "#3B82F6", "text_color": "#1E293B"},
    "sunset_boulevard":   {"bg_color": "#FFF7F0", "primary": "#EA580C", "secondary": "#FB923C", "accent": "#FACC15", "text_color": "#431407"},
    "golden_hour":        {"bg_color": "#FEF3C7", "primary": "#B45309", "secondary": "#D97706", "accent": "#F59E0B", "text_color": "#451A03"},
    "forest_canopy":      {"bg_color": "#F0FDF4", "primary": "#15803D", "secondary": "#166534", "accent": "#22C55E", "text_color": "#14532D"},
    "desert_rose":        {"bg_color": "#FFF1F2", "primary": "#BE123C", "secondary": "#E11D48", "accent": "#F43F5E", "text_color": "#4C0519"},
    "arctic_frost":       {"bg_color": "#F0F9FF", "primary": "#0369A1", "secondary": "#0284C7", "accent": "#38BDF8", "text_color": "#082F49"},
    # Dark Themes
    "ocean_depths":       {"bg_color": "#0B192C", "primary": "#38BDF8", "secondary": "#94A3B8", "accent": "#10B981", "text_color": "#F8FAFC"},
    "cyber_neon":         {"bg_color": "#09090B", "primary": "#A855F7", "secondary": "#EC4899", "accent": "#06B6D4", "text_color": "#F1F5F9"},
    "midnight_galaxy":    {"bg_color": "#020617", "primary": "#6366F1", "secondary": "#4F46E5", "accent": "#818CF8", "text_color": "#F8FAFC"},
    "botanical_garden":   {"bg_color": "#064E3B", "primary": "#A7F3D0", "secondary": "#34D399", "accent": "#10B981", "text_color": "#F0FDF4"},
}

LIGHT_THEME_KEYS = ["modern_minimalist", "sunset_boulevard", "golden_hour",
                     "forest_canopy", "desert_rose", "arctic_frost"]
DARK_THEME_KEYS  = ["ocean_depths", "cyber_neon", "midnight_galaxy", "botanical_garden"]


def simple_hash(s: str) -> int:
    """Deterministic hash of a string, matches frontend implementation."""
    h = 0
    for ch in s:
        h += ord(ch)
    return h


def hex_luma(hex_code: str) -> float:
    """
    Returns sRGB luminance (0.0 dark … 1.0 bright).
    Handles named colors and falls back gracefully.
    """
    named = {"white": "#FFFFFF", "black": "#000000", "red": "#FF0000",
             "blue": "#0000FF", "green": "#008000", "yellow": "#FFFF00"}
    code = str(hex_code).strip().lower()
    code = named.get(code, code)
    code = code.lstrip("#")
    if len(code) == 3:
        code = "".join(c * 2 for c in code)
    if len(code) != 6:
        return 1.0   # unknown → assume light
    try:
        r, g, b = int(code[0:2], 16), int(code[2:4], 16), int(code[4:6], 16)
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    except Exception:
        return 1.0


def pick_premium_theme(session_id: str, raw_theme: dict) -> dict:
    """
    Deterministically pick a premium theme.
    Uses the LLM's bg_color luminance to decide dark/light,
    then uses session_id hash to select which specific theme.
    """
    bg_raw = raw_theme.get("bg_color", "#FFFFFF")
    is_light = hex_luma(bg_raw) > 0.4
    keys = LIGHT_THEME_KEYS if is_light else DARK_THEME_KEYS
    idx = simple_hash(session_id or "default") % len(keys)
    return PREMIUM_THEMES[keys[idx]]

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
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    from pptx.oxml.ns import qn
    from lxml import etree
except ImportError:
    pass

from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.generation import GenerationTask, Courseware

EXPORT_DIR = os.path.join(os.getcwd(), "uploads", "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)

# ──────────────────────────────────────────────
# 16:9 slide constants (in Inches)
# ──────────────────────────────────────────────
SLIDE_W = 13.333   # inches
SLIDE_H = 7.5      # inches

# Safe content area (leaving margins)
MARGIN_LEFT   = 0.55
MARGIN_TOP    = 0.5
MARGIN_RIGHT  = 0.55
CONTENT_W     = SLIDE_W - MARGIN_LEFT - MARGIN_RIGHT   # ≈ 12.23"
TITLE_H       = 0.85
TITLE_T       = 0.3
CONTENT_T     = TITLE_T + TITLE_H + 0.2               # ≈ 1.35"
CONTENT_H     = SLIDE_H - CONTENT_T - 0.35            # ≈ 5.8"


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def hex2rgb(hex_code: str) -> "RGBColor":
    """Convert hex color string to RGBColor, handling named colors robustly."""
    named = {"white": "#FFFFFF", "black": "#000000", "red": "#FF0000",
             "blue": "#0000FF", "green": "#008000", "yellow": "#FFFF00",
             "gray": "#808080", "grey": "#808080"}
    code = str(hex_code).strip().lower()
    code = named.get(code, code)
    code = code.lstrip("#")
    if len(code) == 3:
        code = "".join(c * 2 for c in code)
    try:
        if len(code) != 6:
            raise ValueError
        return RGBColor(int(code[0:2], 16), int(code[2:4], 16), int(code[4:6], 16))
    except Exception:
        return RGBColor(30, 30, 30)


def strip_md_plain(text: str) -> str:
    """純文本清洗 — 適用於標題等不需要富文本的位置。"""
    if not text:
        return ""
    text = re.sub(r'\*{1,3}(.+?)\*{1,3}', r'\1', text)
    text = re.sub(r'`(.+?)`', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
    return text.strip()


def get_content_list(elem: dict) -> list:
    """Return element content as a list of strings."""
    raw = elem.get("content", [])
    if isinstance(raw, list):
        return [str(c) for c in raw if c]
    if raw:
        return [str(raw)]
    return []


def add_paragraph_with_bold(tf, text: str, font_size: int,
                             color: "RGBColor", bold_default: bool = False,
                             accent_color: "RGBColor | None" = None,
                             align=None, first: bool = False) -> None:
    """
    Add a paragraph to a text frame, converting **bold** spans to real bold runs.
    `first=True` reuses the first (auto-created) paragraph instead of adding.
    """
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    if align:
        p.alignment = align

    segments = re.split(r'(\*\*[^*]+\*\*)', str(text))
    for seg in segments:
        if not seg:
            continue
        bold_match = re.match(r'\*\*([^*]+)\*\*', seg)
        run = p.add_run()
        if bold_match:
            run.text = bold_match.group(1)
            run.font.bold = True
            run.font.size = Pt(font_size)
            run.font.color.rgb = accent_color if accent_color else color
        else:
            cleaned = re.sub(r'`(.+?)`', r'\1', seg)
            cleaned = re.sub(r'^>\s+', '', cleaned, flags=re.MULTILINE)
            run.text = cleaned
            run.font.bold = bold_default
            run.font.size = Pt(font_size)
            run.font.color.rgb = color

    if not p.runs:                          # safety fallback
        run = p.add_run()
        run.text = strip_md_plain(text)
        run.font.size = Pt(font_size)
        run.font.color.rgb = color
        run.font.bold = bold_default


def add_title_box(slide, text: str, l, t, w, h, size: int,
                  color: "RGBColor", bold: bool = True,
                  align=None) -> None:
    """Simple title textbox, no markdown inside."""
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = strip_md_plain(str(text))
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color
    if align:
        p.alignment = align


def add_list_box(slide, items: list, l, t, w, h, size: int,
                 color: "RGBColor", accent: "RGBColor",
                 bullet_char: str = "•  ") -> None:
    """
    Render a list element as a single textbox with one paragraph per item.
    Each item gets a bullet prefix and supports **bold** inline.
    """
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True

    for i, item in enumerate(items):
        # Strip leading markdown list markers from item text
        clean_item = re.sub(r'^[\-\*\+]\s+', '', str(item))
        clean_item = re.sub(r'^\d+\.\s+', '', clean_item)
        # Add bullet prefix
        line = bullet_char + clean_item
        add_paragraph_with_bold(tf, line, size, color,
                                 accent_color=accent, first=(i == 0))


def add_rich_box(slide, text: str, l, t, w, h, size: int,
                 color: "RGBColor", accent: "RGBColor",
                 bold_default: bool = False, align=None) -> None:
    """Single-paragraph textbox with **bold** support."""
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    add_paragraph_with_bold(tf, text, size, color, bold_default,
                             accent_color=accent, align=align, first=True)


def add_rect(slide, l, t, w, h, fill_color: "RGBColor", shape_id: int = 1):
    shape = slide.shapes.add_shape(shape_id, Inches(l), Inches(t),
                                   Inches(w), Inches(h))
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape


# ──────────────────────────────────────────────
# Per-layout renderers
# ──────────────────────────────────────────────

def render_cover(slide, page: dict, colors: dict):
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    # Top accent bar
    add_rect(slide, 0, 0, SLIDE_W, 0.32, acc)
    # Bottom accent bar
    add_rect(slide, 0, SLIDE_H - 0.22, SLIDE_W, 0.22, pri)

    title = page.get("title", "")
    add_title_box(slide, title, MARGIN_LEFT, 1.6, CONTENT_W, 2.6, 48, pri, bold=True)

    subtitle_y = 4.5
    for elem in page.get("elements", []):
        etype = elem.get("type", "text_block")
        items = get_content_list(elem)
        if not items:
            continue
        content = " | ".join(items)
        if etype == "subtitle":
            add_rich_box(slide, content, MARGIN_LEFT, subtitle_y,
                         CONTENT_W, 0.65, 22, sec, acc)
        else:
            add_rich_box(slide, content, MARGIN_LEFT, subtitle_y,
                         CONTENT_W, 0.65, 18, txt, acc)
        subtitle_y += 0.7


def render_minimal_list(slide, page: dict, colors: dict):
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    # Title bar accent line
    add_rect(slide, MARGIN_LEFT, TITLE_T + TITLE_H + 0.05, 2.2, 0.05, acc)

    add_title_box(slide, page.get("title", ""),
                  MARGIN_LEFT, TITLE_T, CONTENT_W, TITLE_H, 30, pri, bold=True)

    elements = page.get("elements", [])
    if not elements:
        return

    # Layout: if only one element, full-width; otherwise split evenly
    col_count = min(len(elements), 2)
    col_w = CONTENT_W / col_count - 0.2
    row_h = CONTENT_H

    for col_idx, elem in enumerate(elements[:col_count]):
        etype = elem.get("type", "list")
        items = get_content_list(elem)
        x = MARGIN_LEFT + col_idx * (col_w + 0.2)

        if etype == "list" and len(items) > 1:
            add_list_box(slide, items, x, CONTENT_T, col_w, row_h, 16, txt, acc)
        elif etype == "huge_number":
            add_rich_box(slide, items[0] if items else "", x, CONTENT_T,
                         col_w, row_h, 64, acc, acc, bold_default=True,
                         align=PP_ALIGN.CENTER)
        else:
            full = "\n".join(items)
            add_rich_box(slide, full, x, CONTENT_T, col_w, row_h, 16, txt, acc)


def render_two_column(slide, page: dict, colors: dict):
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    # Left accent strip
    add_rect(slide, MARGIN_LEFT, TITLE_T, 0.07, SLIDE_H - TITLE_T - 0.3, acc)

    title_l = MARGIN_LEFT + 0.18
    add_title_box(slide, page.get("title", ""),
                  title_l, TITLE_T, CONTENT_W - 0.18, TITLE_H, 28, txt, bold=True)

    elements = page.get("elements", [])
    left_elems  = [e for e in elements if e.get("position", "left") == "left"]
    right_elems = [e for e in elements if "right" in str(e.get("position", ""))]
    if not left_elems and not right_elems:
        left_elems  = elements[:max(1, len(elements) // 2)]
        right_elems = elements[max(1, len(elements) // 2):]

    half_w = CONTENT_W / 2 - 0.25
    left_x  = MARGIN_LEFT + 0.18
    right_x = MARGIN_LEFT + 0.18 + half_w + 0.35

    # ── Left column ──
    y = CONTENT_T
    each_h = CONTENT_H / max(len(left_elems), 1)
    for elem in left_elems:
        items = get_content_list(elem)
        etype = elem.get("type", "list")
        if etype == "list" and len(items) > 1:
            add_list_box(slide, items, left_x, y, half_w, each_h - 0.1, 15, txt, acc)
        else:
            add_rich_box(slide, "\n".join(items), left_x, y,
                         half_w, each_h - 0.1, 15, txt, acc)
        y += each_h

    # ── Right column ──
    y = CONTENT_T
    each_h = CONTENT_H / max(len(right_elems), 1)
    for elem in right_elems:
        items = get_content_list(elem)
        etype = elem.get("type", "list")
        is_big = elem.get("is_accent", False) or etype == "huge_number"

        if is_big:
            add_rich_box(slide, items[0] if items else "", right_x, y,
                         half_w, each_h - 0.1, 52, acc, acc,
                         bold_default=True, align=PP_ALIGN.CENTER)
        else:
            # Card background
            add_rect(slide, right_x - 0.1, y, half_w + 0.2, each_h - 0.12, pri)
            if etype == "list" and len(items) > 1:
                add_list_box(slide, items, right_x, y + 0.1,
                             half_w, each_h - 0.3, 14, bg, bg)
            else:
                add_rich_box(slide, "\n".join(items), right_x, y + 0.1,
                             half_w, each_h - 0.3, 14, bg, bg)
        y += each_h


def render_stat_callout(slide, page: dict, colors: dict):
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    add_title_box(slide, page.get("title", ""),
                  MARGIN_LEFT, TITLE_T, CONTENT_W, TITLE_H, 30, txt, bold=True)
    add_rect(slide, MARGIN_LEFT, TITLE_T + TITLE_H + 0.05, 1.8, 0.05, acc)

    elements = page.get("elements", [])
    big_elems   = [e for e in elements if e.get("is_accent") or e.get("type") in ("huge_number", "stat")]
    other_elems = [e for e in elements if e not in big_elems]

    # Big number(s) centred
    big_y  = CONTENT_T + 0.3
    big_h  = 2.5
    for elem in big_elems:
        items = get_content_list(elem)
        add_rich_box(slide, items[0] if items else "",
                     MARGIN_LEFT, big_y, CONTENT_W, big_h,
                     80, acc, acc, bold_default=True, align=PP_ALIGN.CENTER)
        big_y += big_h

    # Supporting text below
    sup_y = big_y + 0.1
    sup_h = (SLIDE_H - sup_y - 0.3) / max(len(other_elems), 1)
    for elem in other_elems:
        items = get_content_list(elem)
        add_rich_box(slide, " ".join(items), MARGIN_LEFT, sup_y,
                     CONTENT_W, max(sup_h - 0.1, 0.5), 18, txt, acc,
                     align=PP_ALIGN.CENTER)
        sup_y += sup_h


def render_timeline(slide, page: dict, colors: dict):
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    add_title_box(slide, page.get("title", ""),
                  MARGIN_LEFT, TITLE_T, CONTENT_W, TITLE_H, 28, txt, bold=True)

    elements = page.get("elements", [])
    spine_x  = MARGIN_LEFT + 1.5
    spine_t  = CONTENT_T + 0.05
    spine_h  = CONTENT_H - 0.1
    add_rect(slide, spine_x, spine_t, 0.06, spine_h, sec)

    each_h = spine_h / max(len(elements), 1)
    for idx, elem in enumerate(elements):
        y      = spine_t + idx * each_h
        dot_y  = y + each_h * 0.35

        # Timeline dot
        add_rect(slide, spine_x - 0.1, dot_y - 0.1, 0.26, 0.26, acc, shape_id=9)

        # Time label
        time_label = elem.get("time", str(idx + 1))
        add_title_box(slide, time_label,
                      MARGIN_LEFT, dot_y - 0.12,
                      1.3, 0.4, 13, acc, bold=True)

        # Content
        items = get_content_list(elem)
        if len(items) > 1:
            add_list_box(slide, items, spine_x + 0.22, y,
                         CONTENT_W - 1.55 - 0.22, each_h - 0.05, 14, txt, acc,
                         bullet_char="― ")
        else:
            add_rich_box(slide, items[0] if items else "",
                         spine_x + 0.22, y,
                         CONTENT_W - 1.55 - 0.22, each_h - 0.05, 14, txt, acc)


def render_default(slide, page: dict, colors: dict):
    """Fallback / minimal_list-style full-page layout."""
    bg, pri, sec, acc, txt = (colors[k] for k in ("bg", "pri", "sec", "acc", "txt"))

    add_rect(slide, 0, 0, SLIDE_W, 0.16, pri)
    add_title_box(slide, page.get("title", ""),
                  MARGIN_LEFT, TITLE_T, CONTENT_W, TITLE_H, 28, pri, bold=True)

    elements = page.get("elements", [])
    each_h = CONTENT_H / max(len(elements), 1)
    y = CONTENT_T

    for elem in elements:
        items = get_content_list(elem)
        etype = elem.get("type", "text_block")
        is_accent = elem.get("is_accent", False) or etype == "huge_number"

        if is_accent:
            add_rich_box(slide, items[0] if items else "",
                         MARGIN_LEFT, y, CONTENT_W, each_h - 0.1,
                         40, acc, acc, bold_default=True, align=PP_ALIGN.CENTER)
        elif etype == "list" and len(items) > 1:
            add_list_box(slide, items, MARGIN_LEFT + 0.25, y,
                         CONTENT_W - 0.25, each_h - 0.1, 15, txt, acc)
        else:
            # Dot bullet
            dot_y = y + (each_h - 0.1) / 2 - 0.06
            add_rect(slide, MARGIN_LEFT, dot_y, 0.12, 0.12, acc, shape_id=9)
            add_rich_box(slide, "\n".join(items),
                         MARGIN_LEFT + 0.25, y,
                         CONTENT_W - 0.25, each_h - 0.1, 15, txt, acc)
        y += each_h


# ──────────────────────────────────────────────
# Main export task
# ──────────────────────────────────────────────

LAYOUT_RENDERERS = {
    "cover":        render_cover,
    "title_slide":  render_cover,
    "two_column":   render_two_column,
    "stat_callout": render_stat_callout,
    "timeline":     render_timeline,
    "minimal_list": render_default,
}


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

        courseware = db.query(Courseware).filter(
            Courseware.session_id == session_id
        ).first()
        if not courseware or not courseware.ppt_data:
            raise ValueError("No courseware found to export")

        task.stage = "rendering_ppt"
        task.progress = 50
        db.commit()

        try:
            prs = Presentation()
            # ← 强制 16:9
            prs.slide_width  = Inches(SLIDE_W)
            prs.slide_height = Inches(SLIDE_H)
            blank_layout = prs.slide_layouts[6]    # completely blank

            import json as _json
            raw_data = courseware.ppt_data
            if isinstance(raw_data, str):
                try:
                    raw_data = _json.loads(raw_data)
                except Exception:
                    raw_data = {}

            theme       = raw_data.get("theme", {}) if isinstance(raw_data, dict) else {}
            slides_arr  = raw_data.get("ppt_data", []) if isinstance(raw_data, dict) else raw_data
            if not isinstance(slides_arr, list):
                slides_arr = []

            # Use premium theme (deterministic by session_id + LLM intent luminance)
            # This mirrors the frontend PREMIUM_THEMES selection exactly
            sel = pick_premium_theme(session_id, theme)
            colors = {
                "bg":  hex2rgb(sel["bg_color"]),
                "pri": hex2rgb(sel["primary"]),
                "sec": hex2rgb(sel["secondary"]),
                "acc": hex2rgb(sel["accent"]),
                "txt": hex2rgb(sel["text_color"]),
            }

            for page in slides_arr:
                slide = prs.slides.add_slide(blank_layout)

                # Fill background
                bg_fill = slide.background.fill
                bg_fill.solid()
                bg_fill.fore_color.rgb = colors["bg"]

                layout_type = page.get("layout_type", "minimal_list")
                renderer = LAYOUT_RENDERERS.get(layout_type, render_default)
                renderer(slide, page, colors)

            task.stage    = "saving_file"
            task.progress = 90
            db.commit()

            filename  = f"export_{session_id}_{uuid.uuid4().hex[:6]}.pptx"
            file_path = os.path.join(EXPORT_DIR, filename)
            prs.save(file_path)

            task.status   = "completed"
            task.progress = 100
            task.result_data = {
                "download_urls": {"ppt_url": f"/api/v1/export/download/{filename}"},
                "filename": filename,
                "error": None,
            }

        except Exception as file_exp:
            import traceback
            task.status = "failed"
            task.result_data = {
                "error": f"PPT 渲染失败: {str(file_exp)}",
                "trace": traceback.format_exc(),
            }
        db.commit()

    except Exception as e:
        logger.error(f"Export Task Failed for session {session_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        task.status = "failed"
        task.result_data = {"error": str(e), "filename": None}
        db.commit()
    finally:
        db.close()
