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
        # Match frontend's exact perceptual luminance formula:
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    except Exception:
        return 1.0


def pick_premium_theme(session_id: str, raw_theme: dict) -> dict:
    """
    Deterministically pick a premium theme.
    Uses the LLM's bg_color luminance to decide dark/light,
    then uses session_id hash to select which specific theme.
    """
    bg_raw = str(raw_theme.get("bg_color", "#FFFFFF")).lower()
    
    # Match frontend string overrides first before luminance check
    if "black" in bg_raw or "dark" in bg_raw:
        is_light = False
    elif "white" in bg_raw or "light" in bg_raw:
        is_light = True
    else:
        is_light = hex_luma(bg_raw) > 0.5
        
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




def _est_card_h(text: str, text_w_inches: float, font_sz: int = 16) -> float:
    """Estimate compact card height for text at font_sz pt in a text_w_inches-wide box.
    CJK chars count as 1 unit, ASCII as 0.55 units for character-width estimation."""
    s = str(text)
    cjk = sum(1 for c in s if '\u4e00' <= c <= '\u9fff')
    other = len(s) - cjk
    eff = cjk + other * 0.55            # CJK-equivalent length
    cpl = max(1.0, (text_w_inches * 72.0) / font_sz)  # CJK chars per line
    lines = max(1, int(eff / cpl + 0.99))              # ceiling division
    return lines * (font_sz * 1.5 / 72.0) + 0.28       # text height + top+bottom padding


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


def rect_rounded(slide, l, t, w, h, fill: "RGBColor", radius_pt: float = 8.0) -> None:
    """Rectangle with ONLY the right two corners rounded (left stays square).
    Matches CSS: border-radius: 0 8px 8px 0 — as used in the frontend preview cards.
    Uses OOXML custGeom for precise per-corner control.
    """
    W_emu = int(Inches(w))
    H_emu = int(Inches(h))
    r_emu = int(Pt(radius_pt))
    r_emu = min(r_emu, H_emu // 2, W_emu // 4)  # clamp to sensible max

    NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    # Path: top-left and bottom-left are square; top-right and bottom-right are arc'd
    cg_xml = (
        f'<a:custGeom xmlns:a="{NS_A}">'
        f'<a:avLst/><a:gdLst/>'
        f'<a:pathLst>'
        f'<a:path w="{W_emu}" h="{H_emu}">'
        f'<a:moveTo><a:pt x="0" y="0"/></a:moveTo>'
        f'<a:lnTo><a:pt x="{W_emu - r_emu}" y="0"/></a:lnTo>'
        f'<a:arcTo wR="{r_emu}" hR="{r_emu}" stAng="-5400000" swAng="5400000"/>'
        f'<a:lnTo><a:pt x="{W_emu}" y="{H_emu - r_emu}"/></a:lnTo>'
        f'<a:arcTo wR="{r_emu}" hR="{r_emu}" stAng="0" swAng="5400000"/>'
        f'<a:lnTo><a:pt x="0" y="{H_emu}"/></a:lnTo>'
        f'<a:close/>'
        f'</a:path></a:pathLst>'
        f'</a:custGeom>'
    )

    sp = slide.shapes.add_shape(1, Inches(l), Inches(t), Inches(w), Inches(h))
    sp_el = sp._element
    # Swap prstGeom → custGeom
    prstGeom = sp_el.find('.//' + qn('a:prstGeom'))
    if prstGeom is not None:
        parent = prstGeom.getparent()
        idx = list(parent).index(prstGeom)
        parent.remove(prstGeom)
        parent.insert(idx, etree.fromstring(cg_xml))

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
    """Slide chrome matching frontend: small accent page-num before title, large faded watermark at bottom-right."""
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]

    # Top accent bar
    line_h(slide, 0, 0, SLIDE_W, 0.10, acc)

    # Large faded page number — BOTTOM-RIGHT watermark
    faded_num = blend(pri, bg, 0.12)
    tb = slide.shapes.add_textbox(
        Inches(SLIDE_W - 1.9), Inches(SLIDE_H - 1.3),
        Inches(1.75), Inches(1.25))
    tf = tb.text_frame
    p = tf.paragraphs[0]
    p.text = str(page_idx).zfill(2)
    p.alignment = PP_ALIGN.RIGHT
    p.font.size = Pt(80)
    p.font.bold = True
    p.font.color.rgb = faded_num

    # Title row: small accent number + main title (matching frontend)
    num_w = 0.52
    tb_plain(slide, str(page_idx).zfill(2),
             MARGIN_LEFT, TITLE_T + 0.08, num_w, TITLE_H - 0.12,
             size=16, color=acc, bold=True)
    tb_plain(slide, title,
             MARGIN_LEFT + num_w + 0.08, TITLE_T,
             CONTENT_W - num_w - 0.08 - 1.5, TITLE_H,
             size=24, color=txt, bold=True)

    # Underline below title
    line_h(slide, MARGIN_LEFT, TITLE_T + TITLE_H + 0.02, CONTENT_W * 0.45, 0.04, acc)



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

    avail_h = SLIDE_H - CONTENT_T - 0.3

    # Only genuine short-content stats go to the accent right zone
    def _is_stat(e):
        return (e.get("type") in ("huge_number", "stat")
                and any(len(str(c)) <= 10 for c in (e.get("content") or ["x"])))

    stat_elems = [e for e in elements if _is_stat(e)]
    body_elems = [e for e in elements if not _is_stat(e)] or elements

    left_w = CONTENT_W * 0.60 if stat_elems else CONTENT_W

    # ── Body cards (left / full column) ── explode each list item into its own card ──
    lx = MARGIN_LEFT
    # Card background: match frontend glassmorphism formula.
    # Dark themes: 30% black overlay = card DARKER than bg (rgba(0,0,0,0.3) in CSS)
    # Light themes: 40% white overlay = card LIGHTER than bg (rgba(255,255,255,0.4) in CSS)
    _W = RGBColor(0xFF, 0xFF, 0xFF)
    _B = RGBColor(0x00, 0x00, 0x00)
    card_bg_body = blend(_B, bg, 0.30) if dark else blend(_W, bg, 0.40)

    body_cards = []
    for elem in body_elems[:6]:
        items = get_content_list(elem)
        etype = elem.get("type", "text_block")
        if etype == "list" and len(items) > 1:
            for item in items:
                s = re.sub(r'^[\-\*\+]\s+', '', str(item))
                s = re.sub(r'^\d+\.\s+', '', s).strip()
                if s:
                    body_cards.append(s)
        else:
            text = "\n".join(items).strip()
            if text:
                body_cards.append(text)

    if body_cards:
        GAP = 0.07
        n_c = len(body_cards)
        text_w_est = left_w - 0.22
        nat_c = [_est_card_h(ct, text_w_est) for ct in body_cards]
        avail_c = avail_h - GAP * (n_c - 1)
        total_nat_c = sum(nat_c)
        if total_nat_c <= avail_c:
            factor_c = min(avail_c / max(total_nat_c, 0.01), 1.5)
            heights_c = [max(0.38, h * factor_c) for h in nat_c]
        else:
            scale_c = avail_c / max(total_nat_c, 0.01)
            heights_c = [max(0.38, h * scale_c) for h in nat_c]

        cy_m = CONTENT_T
        for i, card_text in enumerate(body_cards):
            each_c = heights_c[i]
            rect_rounded(slide, lx, cy_m, left_w - 0.05, each_c, card_bg_body)
            line_v(slide, lx, cy_m, each_c, 0.055, acc)
            clen = len(card_text)
            max_sz = 18 if clen < 50 else (17 if clen < 100 else 16)
            sz = calc_safe_pt(each_c - 0.16, 1, max_sz, 13, max_sz)
            add_rich_box(slide, card_text, lx + 0.14, cy_m + 0.08,
                         left_w - 0.22, each_c - 0.16, sz, txt, acc)
            cy_m += each_c + GAP


    # ── Stat accent zone (right) ────────────────────────────────────────────────
    if stat_elems:
        rx = MARGIN_LEFT + left_w + 0.18
        rw = CONTENT_W - left_w - 0.18
        ry = CONTENT_T
        card_bg_stat = blend(acc, bg, 0.16) if dark else blend(acc, bg, 0.12)
        rect(slide, rx - 0.08, ry - 0.04, rw + 0.12, avail_h + 0.04, card_bg_stat)
        line_h(slide, rx - 0.08, ry - 0.04, rw + 0.12, 0.05, acc)
        each_s = avail_h / max(len(stat_elems), 1)
        for i, elem in enumerate(stat_elems):
            items = get_content_list(elem)
            cy = ry + i * each_s
            sz_big = min(64, max(28, int(each_s * 36)))
            add_rich_box(slide, items[0] if items else "", rx, cy + 0.1, rw,
                         each_s - 0.2, sz_big, acc, acc,
                         bold=True, align=PP_ALIGN.CENTER)


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

    _W = RGBColor(0xFF, 0xFF, 0xFF)
    _B = RGBColor(0x00, 0x00, 0x00)
    card_bg_normal = blend(_B, bg, 0.30) if dark else blend(_W, bg, 0.40)
    card_bg_stat   = blend(acc, bg, 0.18) if dark else blend(acc, bg, 0.13)

    def _render_col(elems, col_x):
        # Explode: each list sub-item becomes its own individual card (matching frontend)
        cards = []
        for elem in elems:
            items = get_content_list(elem)
            etype = elem.get("type", "text_block")
            if _is_stat(elem):
                cards.append({"text": "\n".join(items), "stat": True})
            elif etype == "list" and len(items) > 1:
                for item in items:
                    s = re.sub(r'^[\-\*\+]\s+', '', str(item))
                    s = re.sub(r'^\d+\.\s+', '', s).strip()
                    if s:
                        cards.append({"text": s, "stat": False})
            else:
                text = "\n".join(items).strip()
                if text:
                    cards.append({"text": text, "stat": False})

        if not cards:
            return

        # Dynamic heights: natural (text-fitted), expand up to 1.5x to fill slide
        GAP = 0.07
        n = len(cards)
        text_w_est = half_w - 0.26
        nat = [_est_card_h(c["text"], text_w_est) if not c["stat"] else 0.60
               for c in cards]
        avail_c = avail_h - GAP * (n - 1)
        total_nat = sum(nat)
        if total_nat <= avail_c:
            factor = min(avail_c / max(total_nat, 0.01), 1.5)
            heights = [max(0.38, h * factor) for h in nat]
        else:
            scale = avail_c / max(total_nat, 0.01)
            heights = [max(0.38, h * scale) for h in nat]

        cy = CONTENT_T
        for i, card in enumerate(cards):
            each_h = heights[i]
            text = card["text"]
            cb = card_bg_stat if card["stat"] else card_bg_normal
            # Card fill
            rect_rounded(slide, col_x, cy, half_w - 0.05, each_h, cb)
            # Left accent border
            line_v(slide, col_x, cy, each_h, 0.055, acc)

            if card["stat"]:
                sz_big = min(52, max(24, int(each_h * 36)))
                add_rich_box(slide, text, col_x + 0.14, cy + 0.06,
                             half_w - 0.26, each_h - 0.12,
                             sz_big, acc, acc, bold=True, align=PP_ALIGN.CENTER)
            else:
                clen = len(text)
                max_sz = 18 if clen < 50 else (17 if clen < 100 else 16)
                sz = calc_safe_pt(each_h - 0.16, 1, max_sz, 13, max_sz)
                add_rich_box(slide, text, col_x + 0.14, cy + 0.08,
                             half_w - 0.26, each_h - 0.16, sz, txt, acc)
            cy += each_h + GAP



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
    if not elements:
        return

    # ── Layout geometry ──────────────────────────────────────────
    spine_x  = MARGIN_LEFT + 2.1       # spine vertical line
    spine_t  = CONTENT_T + 0.1
    avail_h  = SLIDE_H - spine_t - 0.45
    each_h   = avail_h / max(len(elements), 1)

    card_x   = spine_x + 0.38          # gap between spine and card
    card_w   = SLIDE_W - card_x - MARGIN_RIGHT - 0.10
    v_gap    = 0.13                    # vertical breathing room per row

    # ── Spine vertical line ───────────────────────────────────────
    spine_col = blend(acc, bg, 0.55) if dark else blend(acc, bg, 0.40)
    line_v(slide, spine_x, spine_t, avail_h, 0.05, spine_col)

    # ── Card background (matches other layouts) ─────────────────────
    _W = RGBColor(0xFF, 0xFF, 0xFF)
    _B = RGBColor(0x00, 0x00, 0x00)
    card_bg = blend(_B, bg, 0.30) if dark else blend(_W, bg, 0.40)

    for i, elem in enumerate(elements):
        row_y   = spine_t + i * each_h
        dot_cy  = row_y + each_h * 0.50   # dot centred in its row

        # ── Dot on spine ───────────────────────────────────────
        dot_sz = 0.23
        sp = slide.shapes.add_shape(9,
            Inches(spine_x - dot_sz / 2 + 0.025),
            Inches(dot_cy - dot_sz / 2),
            Inches(dot_sz), Inches(dot_sz))
        sp.fill.solid()
        sp.fill.fore_color.rgb = acc
        sp.line.fill.background()

        # ── Step number label (right-aligned, left of spine) ─────────────
        raw_label = elem.get("time", f"{i + 1:02d}")
        raw_label = str(raw_label)
        if raw_label.isdigit() and len(raw_label) < 2:
            raw_label = raw_label.zfill(2)
        lbl_w = 1.45
        lbl_h = 0.42
        tb_plain(slide, raw_label,
                 MARGIN_LEFT, dot_cy - lbl_h / 2,
                 lbl_w, lbl_h, 14, acc, bold=True, align=PP_ALIGN.RIGHT)

        # ── Card: background rect + left accent border ────────────────
        card_h = max(0.42, each_h - v_gap * 2)
        card_y = row_y + v_gap

        rect_rounded(slide, card_x, card_y, card_w, card_h, card_bg)
        line_v(slide, card_x, card_y, card_h, 0.07, acc)

        # ── Content text ───────────────────────────────────────
        items = get_content_list(elem)
        if not items:
            continue
        text = items[0] if len(items) == 1 else "；".join(items)
        clen   = len(text)
        max_sz = 18 if clen < 50 else (17 if clen < 100 else 16)
        sz     = calc_safe_pt(card_h - 0.14, 1, max_sz, 13, max_sz)
        add_rich_box(slide, text,
                     card_x + 0.20, card_y + 0.07,
                     card_w - 0.28, card_h - 0.14,
                     sz, txt, acc)


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
