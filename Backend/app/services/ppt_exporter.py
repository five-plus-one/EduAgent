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


def convert_latex(text: str) -> str:
    """
    Convert LaTeX math expressions ($...$  /  $$...$$) to readable Unicode text.
    Applied to all PPT content before export.
    """
    if not text or '$' not in text:
        return text

    # Symbol → Unicode  (no ambiguous alternation chars in patterns)
    _SYM = [
        # Greek lower
        ('\\\\alpha',   'α'), ('\\\\beta',    'β'), ('\\\\gamma',   'γ'), ('\\\\delta',   'δ'),
        ('\\\\epsilon', 'ε'), ('\\\\zeta',    'ζ'), ('\\\\eta',     'η'), ('\\\\theta',   'θ'),
        ('\\\\iota',   'ι'), ('\\\\kappa',   'κ'), ('\\\\lambda',  'λ'), ('\\\\mu',      'μ'),
        ('\\\\nu',     'ν'), ('\\\\xi',      'ξ'), ('\\\\pi',      'π'), ('\\\\rho',     'ρ'),
        ('\\\\sigma',  'σ'), ('\\\\tau',     'τ'), ('\\\\upsilon', 'υ'), ('\\\\phi',     'φ'),
        ('\\\\chi',    'χ'), ('\\\\psi',     'ψ'), ('\\\\omega',   'ω'),
        # Greek upper
        ('\\\\Gamma',  'Γ'), ('\\\\Delta',   'Δ'), ('\\\\Theta',   'Θ'), ('\\\\Lambda',  'Λ'),
        ('\\\\Pi',     'Π'), ('\\\\Sigma',   'Σ'), ('\\\\Phi',     'Φ'), ('\\\\Psi',     'Ψ'),
        ('\\\\Omega',  'Ω'),
        # Operators
        ('\\\\times',  '×'), ('\\\\div',     '÷'), ('\\\\pm',      '±'), ('\\\\mp',      '∓'),
        ('\\\\cdot',   '·'), ('\\\\cdots',   '⋯'), ('\\\\ldots',   '…'),
        ('\\\\partial','∂'), ('\\\\nabla',   '∇'), ('\\\\infty',   '∞'),
        ('\\\\leq',    '≤'), ('\\\\geq',     '≥'), ('\\\\neq',     '≠'), ('\\\\approx',  '≈'),
        ('\\\\equiv',  '≡'), ('\\\\propto',  '∝'),
        ('\\\\in',     '∈'), ('\\\\notin',   '∉'), ('\\\\subset',  '⊂'), ('\\\\supset',  '⊃'),
        ('\\\\cup',    '∪'), ('\\\\cap',     '∩'),
        ('\\\\sum',    'Σ'), ('\\\\prod',    'Π'), ('\\\\int',     '∫'),
        ('\\\\sqrt',   '√'), ('\\\\forall',  '∀'), ('\\\\exists',  '∃'),
        ('\\\\angle',  '∠'), ('\\\\perp',    '⊥'), ('\\\\mid',     '|'),
        # Arrows
        ('\\\\xrightarrow',   '→'), ('\\\\xleftarrow',    '←'),  # fallback if not consumed above
        ('\\\\Rightarrow',    '⇒'), ('\\\\Leftarrow',     '⇐'),
        ('\\\\rightarrow',    '→'), ('\\\\leftarrow',     '←'),
        ('\\\\leftrightarrow','↔'), ('\\\\Leftrightarrow','⇔'),
        ('\\\\uparrow',       '↑'), ('\\\\downarrow',     '↓'),
        ('\\\\to',            '→'), ('\\\\gets',          '←'),
    ]

    def _inner(s: str) -> str:
        """Recursively convert the body of a $...$ expression."""
        # 1. \xrightarrow{arg}  →  (d/dt)→
        s = re.sub(r'\\xrightarrow\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
                   lambda m: f"({_inner(m.group(1))})→", s)
        s = re.sub(r'\\xleftarrow\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
                   lambda m: f"←({_inner(m.group(1))})", s)

        # 2. \frac{num}{den}  →  num/den
        s = re.sub(r'\\frac\{([^{}]*)\}\{([^{}]*)\}',
                   lambda m: f"{_inner(m.group(1))}/{_inner(m.group(2))}", s)

        # 3. \vec{x}  →  x⃗   \hat{x}  →  x̂
        s = re.sub(r'\\vec\{([^{}]*)\}',  lambda m: m.group(1) + '\u20d7', s)
        s = re.sub(r'\\hat\{([^{}]*)\}',  lambda m: m.group(1) + '\u0302', s)
        s = re.sub(r'\\ddot\{([^{}]*)\}', lambda m: m.group(1) + '\u0308', s)
        s = re.sub(r'\\dot\{([^{}]*)\}',  lambda m: m.group(1) + '\u0307', s)
        s = re.sub(r'\\tilde\{([^{}]*)\}',lambda m: m.group(1) + '\u0303', s)
        s = re.sub(r'\\bar\{([^{}]*)\}',  lambda m: m.group(1) + '\u0305', s)

        # 4. ^{exp} and _{sub}
        s = re.sub(r'\^\{([^{}]*)\}', lambda m: f'^{m.group(1)}', s)
        s = re.sub(r'_\{([^{}]*)\}',  lambda m: f'_{m.group(1)}', s)
        s = re.sub(r'\^([A-Za-z0-9])', r'^\1', s)
        s = re.sub(r'_([A-Za-z0-9])',  r'_\1', s)

        # 5. Symbol table (longest first avoids partial matches)
        for pat, uni in _SYM:
            s = re.sub(pat, uni, s)

        # 6. Strip remaining \commands and bare braces
        s = re.sub(r'\\[A-Za-z]+\*?', '', s)
        s = s.replace('{', '').replace('}', '')
        return s.strip()

    # $$...$$  (block math, possibly multiline)
    text = re.sub(r'\$\$(.+?)\$\$', lambda m: _inner(m.group(1)), text, flags=re.DOTALL)
    # $...$  (inline math)
    text = re.sub(r'\$([^$\n]+?)\$', lambda m: _inner(m.group(1)), text)
    return text


def calc_safe_pt(available_h_inches: float, n_lines: int,
                 base_pt: int = 15, min_pt: int = 10, max_pt: int = 20) -> int:
    """
    Return a font size (pt) that makes `n_lines` lines fit within `available_h_inches`.
    Each line is approximately font_size * 1.6 pt tall (line-height factor).
    96 dpi: 1 pt = 1/72 inch, so 1 inch = 72 pt.
    """
    if n_lines <= 0:
        return base_pt
    available_pt = available_h_inches * 72.0
    line_height_factor = 1.65
    ideal = int(available_pt / (n_lines * line_height_factor))
    return max(min_pt, min(ideal, max_pt))


def get_content_list(elem: dict) -> list:
    """Return element content as a list of strings, with LaTeX converted."""
    raw = elem.get("content", [])
    if isinstance(raw, list):
        return [convert_latex(str(c)) for c in raw if c]
    if raw:
        return [convert_latex(str(raw))]
    return []




# ──────────────────────────────────────────────
# Color utilities
# ──────────────────────────────────────────────

def blend(fg: "RGBColor", bg: "RGBColor", opacity: float) -> "RGBColor":
    """Simulate alpha-blend: fg at `opacity` over bg."""
    r = int(fg[0] * opacity + bg[0] * (1 - opacity))
    g = int(fg[1] * opacity + bg[1] * (1 - opacity))
    b = int(fg[2] * opacity + bg[2] * (1 - opacity))
    return RGBColor(max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))


def _is_dark(colors: dict) -> bool:
    c = colors["bg"]
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255.0 < 0.5


# ──────────────────────────────────────────────
# Low-level drawing primitives
# ──────────────────────────────────────────────

def rect(slide, l, t, w, h, fill: "RGBColor", shape_id: int = 1) -> None:
    sp = slide.shapes.add_shape(shape_id, Inches(l), Inches(t), Inches(w), Inches(h))
    sp.fill.solid()
    sp.fill.fore_color.rgb = fill
    sp.line.fill.background()


def line_h(slide, l, t, w, thickness: float, color: "RGBColor") -> None:
    rect(slide, l, t, w, thickness, color)


def line_v(slide, l, t, h, thickness: float, color: "RGBColor") -> None:
    rect(slide, l, t, thickness, h, color)


def tb_plain(slide, text: str, l, t, w, h, size: int, color: "RGBColor",
             bold: bool = False, align=None) -> None:
    """Plain textbox — no markdown parsing."""
    from pptx.util import Pt
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


def _add_rich_para(tf, text: str, size: int, color: "RGBColor", accent: "RGBColor",
                   bold: bool = False, align=None, first: bool = False) -> None:
    """Add one paragraph with **bold** span support."""
    from pptx.util import Pt
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    if align:
        p.alignment = align
    for seg in re.split(r'(\*\*[^*]+\*\*)', str(text)):
        if not seg:
            continue
        m = re.match(r'\*\*([^*]+)\*\*', seg)
        run = p.add_run()
        if m:
            run.text = m.group(1)
            run.font.bold = True
            run.font.size = Pt(size)
            run.font.color.rgb = accent
        else:
            run.text = re.sub(r'`(.+?)`', r'\1', seg)
            run.font.bold = bold
            run.font.size = Pt(size)
            run.font.color.rgb = color
    if not p.runs:
        run = p.add_run()
        run.text = strip_md_plain(text)
        run.font.size = Pt(size)
        run.font.color.rgb = color


def add_rich_box(slide, text: str, l, t, w, h, size: int,
                 color: "RGBColor", accent: "RGBColor",
                 bold: bool = False, align=None) -> None:
    """Single-paragraph rich textbox."""
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    _add_rich_para(tf, text, size, color, accent, bold=bold, align=align, first=True)


def add_list_box(slide, items: list, l, t, w, h, size: int,
                 color: "RGBColor", accent: "RGBColor",
                 bullet: str = "•  ") -> None:
    """Multi-paragraph list textbox, auto-sized to fit."""
    MAX = 8
    if len(items) > MAX:
        items = items[:MAX - 1] + [f"… (+{len(items) - MAX + 1} 项)"]
    safe = calc_safe_pt(h, len(items), base_pt=size, min_pt=10, max_pt=size)
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        clean = re.sub(r'^[\-\*\+]\s+', '', str(item))
        clean = re.sub(r'^\d+\.\s+', '', clean)
        _add_rich_para(tf, bullet + clean, safe, color, accent, first=(i == 0))


# ──────────────────────────────────────────────
# Shared slide chrome
# ──────────────────────────────────────────────

def draw_chrome(slide, page_idx: int, title: str, colors: dict) -> None:
    """Top accent bar + left strip + faded page number + title + underline."""
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]

    # Top bar
    line_h(slide, 0, 0, SLIDE_W, 0.12, acc)

    # Left vertical strip
    line_v(slide, MARGIN_LEFT - 0.07, TITLE_T - 0.05,
           SLIDE_H - TITLE_T + 0.05 - 0.2, 0.055, acc)

    # Faded giant page number (top-right, ~10% opacity via color blend)
    faded_num = blend(pri, bg, 0.12)
    tb = slide.shapes.add_textbox(
        Inches(SLIDE_W - 2.1), Inches(0.08), Inches(1.95), Inches(1.1))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.text = str(page_idx).zfill(2)
    p.alignment = PP_ALIGN.RIGHT
    p.font.size = Pt(70)
    p.font.bold = True
    p.font.color.rgb = faded_num

    # Title
    tb_plain(slide, title, MARGIN_LEFT, TITLE_T, CONTENT_W - 1.9, TITLE_H,
             size=28, color=pri, bold=True)

    # Title underline
    line_h(slide, MARGIN_LEFT, TITLE_T + TITLE_H + 0.02, 2.0, 0.045, acc)


# ──────────────────────────────────────────────
# Per-layout renderers
# ──────────────────────────────────────────────

def render_cover(slide, page: dict, colors: dict) -> None:
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    sec = colors["sec"]
    acc = colors["acc"]
    txt = colors["txt"]

    # Top stripe (accent color, thick)
    line_h(slide, 0, 0, SLIDE_W, 0.32, acc)
    # Secondary stripe (blend)
    line_h(slide, 0, 0.32, SLIDE_W, 0.1, blend(acc, bg, 0.3))
    # Bottom bar (primary color)
    line_h(slide, 0, SLIDE_H - 0.28, SLIDE_W, 0.28, pri)
    # Left edge block
    line_v(slide, 0, 0, SLIDE_H, 0.16, pri)

    title = page.get("title", "")
    t_l, t_t, t_w, t_h = 0.9, 1.4, SLIDE_W - 1.4, 2.9

    # Title
    tb = slide.shapes.add_textbox(Inches(t_l), Inches(t_t), Inches(t_w), Inches(t_h))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = strip_md_plain(title)
    p.alignment = PP_ALIGN.LEFT
    p.font.size = Pt(52)
    p.font.bold = True
    p.font.color.rgb = pri

    # Accent underline under title
    line_h(slide, t_l, t_t + t_h - 0.5, 3.2, 0.06, acc)

    # Subtitle / elements
    sub_y = t_t + t_h + 0.05
    for elem in list(page.get("elements", []))[:3]:
        items = get_content_list(elem)
        if not items:
            continue
        content = " | ".join(items)
        if len(content) > 90:
            content = content[:87] + "…"
        etype = elem.get("type", "")
        color = sec if etype == "subtitle" else txt
        sz    = 22 if etype == "subtitle" else 17
        tb_plain(slide, content, t_l, sub_y, t_w, 0.6, sz, color)
        sub_y += 0.7
        if sub_y > SLIDE_H - 0.45:
            break


def render_minimal_list(slide, page: dict, colors: dict) -> None:
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]
    dark = _is_dark(colors)

    draw_chrome(slide, page.get("page_index", 1), page.get("title", ""), colors)

    elements = page.get("elements", [])
    if not elements:
        return

    list_elems  = [e for e in elements if e.get("type") in ("list", "text_block")]
    right_elems = [e for e in elements if e.get("type") in
                   ("huge_number", "stat", "subtitle") or e.get("is_accent")]

    if not list_elems and not right_elems:
        list_elems = elements

    avail_h = SLIDE_H - CONTENT_T - 0.3

    if right_elems:
        left_w = CONTENT_W * 0.60
    else:
        left_w = CONTENT_W

    # Left zone
    lx, ly = MARGIN_LEFT, CONTENT_T
    for elem in list_elems[:3]:
        items = get_content_list(elem)
        etype = elem.get("type", "list")
        zone_h = avail_h / max(len(list_elems[:3]), 1)
        if etype == "list" and len(items) > 1:
            add_list_box(slide, items, lx, ly, left_w - 0.15, zone_h - 0.05, 16, txt, acc)
        else:
            sz = calc_safe_pt(zone_h, max(len(items), 1), 16, 10, 18)
            add_rich_box(slide, "\n".join(items), lx, ly, left_w - 0.15,
                         zone_h - 0.05, sz, txt, acc)
        ly += zone_h

    # Right highlight zone
    if right_elems:
        rx = MARGIN_LEFT + left_w + 0.15
        rw = CONTENT_W - left_w - 0.15
        ry = CONTENT_T

        # Card background
        card_bg = blend(acc, bg, 0.14) if dark else blend(pri, bg, 0.06)
        rect(slide, rx - 0.12, ry - 0.08, rw + 0.17, avail_h + 0.08, card_bg)
        line_h(slide, rx - 0.12, ry - 0.08, rw + 0.17, 0.05, acc)

        each = avail_h / max(len(right_elems), 1)
        for i, elem in enumerate(right_elems):
            items = get_content_list(elem)
            etype = elem.get("type", "list")
            cy = ry + i * each
            if etype in ("huge_number", "stat") and items and len(str(items[0])) <= 10:
                add_rich_box(slide, items[0], rx, cy, rw,
                             each - 0.05, 52, acc, acc, bold=True, align=PP_ALIGN.CENTER)
            else:
                sz = calc_safe_pt(each, max(len(items), 1), 15, 10, 18)
                add_rich_box(slide, "\n".join(items), rx, cy, rw,
                             each - 0.05, sz, txt, acc)


def render_two_column(slide, page: dict, colors: dict) -> None:
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]
    dark = _is_dark(colors)

    draw_chrome(slide, page.get("page_index", 1), page.get("title", ""), colors)

    elements = page.get("elements", [])

    # Flexible position detection:
    #   left / left_top / left_bottom  → left column
    #   right / right_top / right_bottom → right column
    def _col(e):
        return str(e.get("position", "left")).lower()

    left_elems  = [e for e in elements if "left"  in _col(e)]
    right_elems = [e for e in elements if "right" in _col(e)]

    if not left_elems and not right_elems:
        half = max(len(elements) // 2, 1)
        left_elems, right_elems = elements[:half], elements[half:]
    elif not left_elems:           # all labeled right — split evenly
        half = max(len(right_elems) // 2, 1)
        left_elems, right_elems = right_elems[:half], right_elems[half:]
    elif not right_elems:          # all labeled left — split evenly
        half = max(len(left_elems) // 2, 1)
        left_elems, right_elems = left_elems[:half], left_elems[half:]

    half_w  = (CONTENT_W - 0.28) / 2
    lx      = MARGIN_LEFT
    rx      = MARGIN_LEFT + half_w + 0.28
    avail_h = SLIDE_H - CONTENT_T - 0.3

    # Only truly short numeric/symbol content gets large font
    def _is_stat(e):
        return (e.get("type") in ("huge_number", "stat")
                and any(len(str(c)) <= 10 for c in (e.get("content") or ["x"])))

    card_bg_normal = blend(acc, bg, 0.10) if dark else blend(pri, bg, 0.05)
    card_bg_stat   = blend(acc, bg, 0.18) if dark else blend(acc, bg, 0.13)

    def _render_col(elems, col_x):
        n = max(len(elems), 1)
        each_h = avail_h / n
        for i, elem in enumerate(elems):
            cy    = CONTENT_T + i * each_h
            items = get_content_list(elem)
            etype = elem.get("type", "text_block")
            is_stat = _is_stat(elem)
            cb = card_bg_stat if is_stat else card_bg_normal
            rect(slide, col_x - 0.04, cy + 0.04, half_w, each_h - 0.10, cb)
            if is_stat:
                val = items[0] if items else ""
                sz_big = min(56, max(28, int(each_h * 36)))
                add_rich_box(slide, val, col_x + 0.05, cy + 0.10,
                             half_w - 0.10, each_h - 0.26,
                             sz_big, acc, acc, bold=True, align=PP_ALIGN.CENTER)
            elif etype == "list" and len(items) > 1:
                add_list_box(slide, items, col_x + 0.08, cy + 0.10,
                             half_w - 0.14, each_h - 0.26, 14, txt, acc)
            else:
                content = "\n".join(items)
                clen = len(content)
                max_sz = 16 if clen < 40 else (14 if clen < 80 else 13)
                sz = calc_safe_pt(each_h - 0.26, max(len(items), 1), max_sz, 10, max_sz)
                add_rich_box(slide, content, col_x + 0.08, cy + 0.10,
                             half_w - 0.14, each_h - 0.26, sz, txt, acc)

    _render_col(left_elems,  lx)
    _render_col(right_elems, rx)




def render_stat_callout(slide, page: dict, colors: dict) -> None:
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]
    dark = _is_dark(colors)

    draw_chrome(slide, page.get("page_index", 1), page.get("title", ""), colors)

    elements = page.get("elements", [])
    big   = [e for e in elements if e.get("is_accent") or e.get("type") in ("huge_number", "stat")]
    other = [e for e in elements if e not in big]

    big_y = CONTENT_T + 0.2
    for elem in big[:1]:
        items = get_content_list(elem)
        val = items[0] if items else ""
        sz = 2.6
        cx = (SLIDE_W - sz) / 2
        # Decorative bg circle
        circ_bg = blend(acc, bg, 0.14)
        sp = slide.shapes.add_shape(9, Inches(cx), Inches(big_y), Inches(sz), Inches(sz))
        sp.fill.solid()
        sp.fill.fore_color.rgb = circ_bg
        sp.line.fill.background()
        # Stat number
        tb = slide.shapes.add_textbox(
            Inches(cx - 0.6), Inches(big_y + 0.05), Inches(sz + 1.2), Inches(sz - 0.1))
        tf = tb.text_frame
        p = tf.paragraphs[0]
        p.text = val
        p.alignment = PP_ALIGN.CENTER
        p.font.size = Pt(80)
        p.font.bold = True
        p.font.color.rgb = acc
        big_y += sz + 0.2

    sup_y = max(big_y, CONTENT_T + 3.3)
    each_h = (SLIDE_H - sup_y - 0.35) / max(len(other), 1)
    for elem in other:
        items = get_content_list(elem)
        add_rich_box(slide, " ".join(items), MARGIN_LEFT, sup_y,
                     CONTENT_W, each_h - 0.05, 17, txt, acc, align=PP_ALIGN.CENTER)
        sup_y += each_h


def render_timeline(slide, page: dict, colors: dict) -> None:
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]
    dark = _is_dark(colors)

    draw_chrome(slide, page.get("page_index", 1), page.get("title", ""), colors)

    elements = page.get("elements", [])
    spine_x = MARGIN_LEFT + 1.75
    spine_t = CONTENT_T + 0.05
    avail_h = SLIDE_H - spine_t - 0.35
    spine_col = blend(acc, bg, 0.45)
    line_v(slide, spine_x, spine_t, avail_h, 0.04, spine_col)

    each_h = avail_h / max(len(elements), 1)
    for i, elem in enumerate(elements):
        ey = spine_t + i * each_h
        dot_y = ey + each_h * 0.28
        dot_sz = 0.2
        sp = slide.shapes.add_shape(9,
            Inches(spine_x - dot_sz / 2 + 0.02),
            Inches(dot_y - dot_sz / 2),
            Inches(dot_sz), Inches(dot_sz))
        sp.fill.solid()
        sp.fill.fore_color.rgb = acc
        sp.line.fill.background()

        time_label = elem.get("time", str(i + 1))
        tb_plain(slide, time_label, MARGIN_LEFT, dot_y - 0.16,
                 1.55, 0.33, 12, acc, bold=True, align=PP_ALIGN.RIGHT)

        cx = spine_x + 0.2
        cw = SLIDE_W - cx - MARGIN_RIGHT
        items = get_content_list(elem)
        if len(items) > 1:
            add_list_box(slide, items, cx, ey, cw, each_h - 0.08, 13, txt, acc, bullet="― ")
        elif items:
            sz = calc_safe_pt(each_h, 1, 14, 10, 16)
            add_rich_box(slide, items[0], cx, ey, cw, each_h - 0.08, sz, txt, acc)


def render_default(slide, page: dict, colors: dict) -> None:
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]
    dark = _is_dark(colors)

    draw_chrome(slide, page.get("page_index", 1), page.get("title", ""), colors)

    elements = page.get("elements", [])
    avail_h = SLIDE_H - CONTENT_T - 0.35
    each_h = avail_h / max(len(elements), 1)

    for i, elem in enumerate(elements):
        items = get_content_list(elem)
        etype = elem.get("type", "text_block")
        is_acc = elem.get("is_accent", False) or etype in ("huge_number", "stat")
        cy = CONTENT_T + i * each_h

        if is_acc and items and len(str(items[0])) <= 10:
            add_rich_box(slide, items[0] if items else "", MARGIN_LEFT, cy, CONTENT_W,
                         each_h - 0.05, min(52, max(24, int(each_h * 28))),
                         acc, acc, bold=True, align=PP_ALIGN.CENTER)
        elif etype == "list" and len(items) > 1:
            add_list_box(slide, items, MARGIN_LEFT, cy, CONTENT_W, each_h - 0.05, 15, txt, acc)
        else:
            sz = calc_safe_pt(each_h, max(len(items), 1), 15, 10, 18)
            add_rich_box(slide, "\n".join(items), MARGIN_LEFT, cy, CONTENT_W,
                         each_h - 0.05, sz, txt, acc)


# ──────────────────────────────────────────────
# Layout dispatch table
# ──────────────────────────────────────────────

LAYOUT_RENDERERS = {
    "cover":        render_cover,
    "title_slide":  render_cover,
    "two_column":   render_two_column,
    "stat_callout": render_stat_callout,
    "timeline":     render_timeline,
    "minimal_list": render_minimal_list,
    "image_focus":  render_default,
}


# ──────────────────────────────────────────────
# Main export entry point
# ──────────────────────────────────────────────

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
            prs.slide_width  = Inches(SLIDE_W)
            prs.slide_height = Inches(SLIDE_H)
            blank_layout = prs.slide_layouts[6]

            import json as _json
            raw_data = courseware.ppt_data
            if isinstance(raw_data, str):
                try:
                    raw_data = _json.loads(raw_data)
                except Exception:
                    raw_data = {}

            theme      = raw_data.get("theme", {}) if isinstance(raw_data, dict) else {}
            slides_arr = raw_data.get("ppt_data", []) if isinstance(raw_data, dict) else raw_data
            if not isinstance(slides_arr, list):
                slides_arr = []

            # Use premium theme (deterministic by session_id + LLM luminance intent)
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
