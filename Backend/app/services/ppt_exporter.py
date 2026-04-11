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
MARGIN_LEFT   = 0.75
MARGIN_TOP    = 0.5
MARGIN_RIGHT  = 0.75
CONTENT_W     = SLIDE_W - MARGIN_LEFT - MARGIN_RIGHT   # ≈ 11.83"
TITLE_H       = 0.85
TITLE_T       = 0.3
CONTENT_T     = TITLE_T + TITLE_H + 0.22               # ≈ 1.37"
CONTENT_H     = SLIDE_H - CONTENT_T - 0.40             # ≈ 5.73"


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


# ──────────────────────────────────────────────
# OMML Math Equation Helpers
# Embeds real PowerPoint math equations (Office Math Markup Language)
# for \begin{cases}...\end{cases} environments.
# ──────────────────────────────────────────────

# OMML/DrawingML namespace constants
_NS_M   = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
_NS_A   = 'http://schemas.openxmlformats.org/drawingml/2006/main'
_NS_MC  = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
_NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'

# ── Registry of ALL math block environments that get OMML rendering ────────
# key: LaTeX env name  →  (type, beg_delimiter, end_delimiter)
_MATH_BLOCK_ENVS = {
    'cases':    ('cases',   '{',  ''),
    'aligned':  ('aligned', '',   ''),
    'align':    ('aligned', '',   ''),
    'align*':   ('aligned', '',   ''),
    'matrix':   ('matrix',  '',   ''),
    'pmatrix':  ('matrix',  '(',  ')'),
    'bmatrix':  ('matrix',  '[',  ']'),
    'vmatrix':  ('matrix',  '|',  '|'),
    'Vmatrix':  ('matrix',  '\u2016', '\u2016'),
}
_MATH_ENV_NAMES_RE = '|'.join(re.escape(k) for k in _MATH_BLOCK_ENVS)
_HAS_ENV_OPEN_RE  = re.compile(r'\\begin\{(' + _MATH_ENV_NAMES_RE + r')\}')
_HAS_ENV_CLOSE_RE = re.compile(r'\\end\{(' + _MATH_ENV_NAMES_RE + r')\}')

def _has_math_env_open(s: str) -> bool:
    """Return True if s contains any recognized \\begin{env} math block."""
    return bool(_HAS_ENV_OPEN_RE.search(s))

def _has_math_env_close(s: str) -> bool:
    """Return True if s contains any recognized \\end{env} math block."""
    return bool(_HAS_ENV_CLOSE_RE.search(s))


def _parse_tex_arg(s: str, start: int):
    """Extract {arg} beginning at position start; returns (content, end_pos).
    If no '{', treats the single character at start as the argument.
    Handles nested braces correctly.
    """
    if start >= len(s):
        return '', start
    if s[start] != '{':
        return s[start], start + 1
    depth = 0
    i = start
    while i < len(s):
        if s[i] == '{':   depth += 1
        elif s[i] == '}': depth -= 1; (depth == 0 and True) and (i := i)  # noqa
        if s[i] == '}' and depth == 0:
            return s[start + 1: i], i + 1
        i += 1
    return s[start + 1:], len(s)



# ── OMML symbol table: LaTeX command → Unicode (used in text runs) ─────────
_OMML_SYM = {
    # Greek lower
    'alpha':'α','beta':'β','gamma':'γ','delta':'δ','epsilon':'ε','zeta':'ζ',
    'eta':'η','theta':'θ','iota':'ι','kappa':'κ','lambda':'λ','mu':'μ',
    'nu':'ν','xi':'ξ','pi':'π','rho':'ρ','sigma':'σ','tau':'τ',
    'upsilon':'υ','phi':'φ','chi':'χ','psi':'ψ','omega':'ω',
    # Greek upper
    'Gamma':'Γ','Delta':'Δ','Theta':'Θ','Lambda':'Λ','Pi':'Π',
    'Sigma':'Σ','Phi':'Φ','Psi':'Ψ','Omega':'Ω',
    # Operators & misc
    'times':'×','div':'÷','pm':'±','mp':'∓','cdot':'·','cdots':'⋯',
    'ldots':'…','partial':'∂','nabla':'∇','infty':'∞',
    'leq':'≤','geq':'≥','neq':'≠','approx':'≈','equiv':'≡','propto':'∝',
    'in':'∈','notin':'∉','subset':'⊂','supset':'⊃','cup':'∪','cap':'∩',
    'forall':'∀','exists':'∃','angle':'∠','perp':'⊥','mid':'|',
    'rightarrow':'→','leftarrow':'←','Rightarrow':'⇒','Leftarrow':'⇐',
    'leftrightarrow':'↔','Leftrightarrow':'⇔','uparrow':'↑','downarrow':'↓',
    'to':'→','gets':'←',
    # Functions (keep as text)
    'sin':'sin','cos':'cos','tan':'tan','cot':'cot','sec':'sec','csc':'csc',
    'log':'log','ln':'ln','exp':'exp','max':'max','min':'min','lim':'lim',
    'det':'det','dim':'dim','ker':'ker','deg':'deg','gcd':'gcd',
    'arcsin':'arcsin','arccos':'arccos','arctan':'arctan',
    'sup':'sup','inf':'inf',
}

# n-ary operators: LaTeX cmd → OMML chr value
_NARY_CHR = {
    'sum':   '∑',
    'prod':  '∏',
    'int':   '∫',
    'iint':  '∬',
    'iiint': '∭',
    'oint':  '∮',
    'bigcup':'∪',
    'bigcap':'∩',
}


def _simple_sym(txt: str) -> str:
    """Convert a short LaTeX snippet to display text (symbols only, no structural conversion)."""
    s = txt.strip()
    # replace \cmd
    def _repl(m):
        cmd = m.group(1)
        return _OMML_SYM.get(cmd, m.group(0))
    s = re.sub(r'\\([A-Za-z]+\*?)', _repl, s)
    # strip remaining braces that are now bare (grouping only)
    s = s.replace('{', '').replace('}', '')
    return s


def _append_omml_for_expr(parent, latex: str, m_ns: str,
                          color_hex: str = '') -> None:
    """Recursively parse a LaTeX expression and append OMML elements to parent.
    Supports:
      \\frac{}{} → <m:f>
      \\sqrt[]{} → <m:rad>
      ^{}/{} → <m:sSup>/<m:sSub>  (proper superscript/subscript elements)
      \\sum/\\prod/\\int + limits → <m:nary>
      \\lim_{} → <m:limLow>
      \\left ... \\right → <m:d>
      Text/symbols → <m:r> with Unicode conversion
    color_hex: hex color string (e.g. '1E293B') injected into each <m:rPr> so
               OMML text inherits the surrounding PPT text color.
    """
    from lxml import etree
    m = m_ns
    A_NS   = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    XML_SP = '{http://www.w3.org/XML/1998/namespace}space'

    def _text_run(container, txt: str):
        """Emit an <m:r> text run into *container* with properly converted symbols."""
        if not txt:
            return
        display = _simple_sym(txt)
        display = display.strip()
        if not display:
            return
        r = etree.SubElement(container, f'{{{m}}}r')
        rPr = etree.SubElement(r, f'{{{m}}}rPr')
        sty = etree.SubElement(rPr, f'{{{m}}}sty')
        sty.set(f'{{{m}}}val', 'p')
        # Inject DrawingML color so math text matches the PPT text color
        if color_hex:
            a_rPr = etree.SubElement(rPr, f'{{{A_NS}}}rPr')
            sf    = etree.SubElement(a_rPr, f'{{{A_NS}}}solidFill')
            clr   = etree.SubElement(sf,    f'{{{A_NS}}}srgbClr')
            clr.set('val', color_hex.upper().lstrip('#'))
        t = etree.SubElement(r, f'{{{m}}}t')
        t.set(XML_SP, 'preserve')
        t.text = display

    def flush_buf(buf: str):
        """Emit buffered plain text as a text run."""
        if buf:
            _text_run(parent, buf)

    # ── Peek helper ─────────────────────────────────────────────────────────
    def peek_cmd(s: str, pos: int):
        """If s[pos] == '\\', read the command name. Returns (cmd, end_pos) or (None, pos)."""
        if pos >= len(s) or s[pos] != '\\':
            return None, pos
        j = pos + 1
        if j >= len(s):
            return None, pos
        if s[j].isalpha():
            while j < len(s) and s[j].isalpha():
                j += 1
            # strip trailing *
            if j < len(s) and s[j] == '*':
                j += 1
            return s[pos+1:j].rstrip('*'), j
        else:
            # single-char command like \, \\ \{ \}
            return s[j], j + 1

    i = 0
    buf = ''

    while i < len(latex):
        c = latex[i]

        # ─── \frac{num}{den} → <m:f> ────────────────────────────────────────
        if latex[i:i+5] == '\\frac':
            flush_buf(buf); buf = ''
            num_str, j = _parse_tex_arg(latex, i + 5)
            den_str, j = _parse_tex_arg(latex, j)
            f_el = etree.SubElement(parent, f'{{{m}}}f')
            num_el = etree.SubElement(f_el, f'{{{m}}}num')
            _append_omml_for_expr(num_el, num_str, m_ns, color_hex)
            den_el = etree.SubElement(f_el, f'{{{m}}}den')
            _append_omml_for_expr(den_el, den_str, m_ns, color_hex)
            i = j
            continue

        # ─── \sqrt[n]{x} or \sqrt{x} → <m:rad> ─────────────────────────────
        if latex[i:i+5] == '\\sqrt':
            flush_buf(buf); buf = ''
            j = i + 5
            deg_str = ''
            if j < len(latex) and latex[j] == '[':
                end_br = latex.find(']', j)
                if end_br != -1:
                    deg_str = latex[j+1:end_br]
                    j = end_br + 1
            rad_content, j = _parse_tex_arg(latex, j)
            rad_el = etree.SubElement(parent, f'{{{m}}}rad')
            radPr  = etree.SubElement(rad_el, f'{{{m}}}radPr')
            dh     = etree.SubElement(radPr, f'{{{m}}}degHide')
            dh.set(f'{{{m}}}val', '0' if deg_str else '1')
            # ctrlPr: color the radical sign
            rad_ctrlPr = etree.SubElement(radPr, f'{{{m}}}ctrlPr')
            if color_hex:
                _rpr = etree.SubElement(rad_ctrlPr, f'{{{A_NS}}}rPr')
                _sf  = etree.SubElement(_rpr, f'{{{A_NS}}}solidFill')
                _cl  = etree.SubElement(_sf,  f'{{{A_NS}}}srgbClr')
                _cl.set('val', color_hex.upper().lstrip('#'))
            deg_el = etree.SubElement(rad_el, f'{{{m}}}deg')
            if deg_str:
                _append_omml_for_expr(deg_el, deg_str, m_ns, color_hex)
            e_el = etree.SubElement(rad_el, f'{{{m}}}e')
            _append_omml_for_expr(e_el, rad_content, m_ns, color_hex)
            i = j
            continue


        # ─── n-ary: \sum, \prod, \int, etc. ── with optional _{lo}^{hi} ─────
        cmd, cmd_end = peek_cmd(latex, i)
        if cmd and cmd in _NARY_CHR:
            flush_buf(buf); buf = ''
            chr_val = _NARY_CHR[cmd]
            j = cmd_end
            # skip optional space
            while j < len(latex) and latex[j] == ' ':
                j += 1
            # parse optional limits: _{lo} and ^{hi} in any order
            sub_str = sup_str = ''
            for _ in range(2):
                if j < len(latex) and latex[j] == '_':
                    sub_str, j = _parse_tex_arg(latex, j + 1)
                elif j < len(latex) and latex[j] == '^':
                    sup_str, j = _parse_tex_arg(latex, j + 1)
                else:
                    break
                while j < len(latex) and latex[j] == ' ':
                    j += 1
            # body: next {…} or single token
            body_str, j = _parse_tex_arg(latex, j) if j < len(latex) else ('', j)

            nary = etree.SubElement(parent, f'{{{m}}}nary')
            nPr  = etree.SubElement(nary, f'{{{m}}}naryPr')
            chrEl = etree.SubElement(nPr, f'{{{m}}}chr')
            chrEl.set(f'{{{m}}}val', chr_val)
            limLoc = etree.SubElement(nPr, f'{{{m}}}limLoc')
            limLoc.set(f'{{{m}}}val', 'undOvr' if (sub_str or sup_str) else 'subSup')
            # hide empty sub/sup
            if not sub_str:
                hs = etree.SubElement(nPr, f'{{{m}}}subHide')
                hs.set(f'{{{m}}}val', '1')
            if not sup_str:
                hp = etree.SubElement(nPr, f'{{{m}}}supHide')
                hp.set(f'{{{m}}}val', '1')
            # ctrlPr: color the nary operator character (∫ Σ ∏ etc.)
            nary_ctrlPr = etree.SubElement(nPr, f'{{{m}}}ctrlPr')
            if color_hex:
                _rpr = etree.SubElement(nary_ctrlPr, f'{{{A_NS}}}rPr')
                _sf  = etree.SubElement(_rpr, f'{{{A_NS}}}solidFill')
                _cl  = etree.SubElement(_sf,  f'{{{A_NS}}}srgbClr')
                _cl.set('val', color_hex.upper().lstrip('#'))
            sub_el = etree.SubElement(nary, f'{{{m}}}sub')
            if sub_str:
                _append_omml_for_expr(sub_el, sub_str, m_ns, color_hex)
            sup_el = etree.SubElement(nary, f'{{{m}}}sup')
            if sup_str:
                _append_omml_for_expr(sup_el, sup_str, m_ns, color_hex)
            e_el = etree.SubElement(nary, f'{{{m}}}e')
            if body_str:
                _append_omml_for_expr(e_el, body_str, m_ns, color_hex)
            i = j
            continue

        # ─── \lim_{…} → <m:limLow> ──────────────────────────────────────────
        if cmd == 'lim':
            flush_buf(buf); buf = ''
            j = cmd_end
            while j < len(latex) and latex[j] == ' ':
                j += 1
            sub_str = ''
            if j < len(latex) and latex[j] == '_':
                sub_str, j = _parse_tex_arg(latex, j + 1)
            lim_el = etree.SubElement(parent, f'{{{m}}}limLow')
            e_el   = etree.SubElement(lim_el, f'{{{m}}}e')
            _text_run(e_el, 'lim')
            lim_sub = etree.SubElement(lim_el, f'{{{m}}}lim')
            if sub_str:
                _append_omml_for_expr(lim_sub, sub_str, m_ns, color_hex)
            i = j
            continue

        # ─── \left … \right → <m:d> ─────────────────────────────────────────
        if latex[i:i+5] == '\\left':
            flush_buf(buf); buf = ''
            j = i + 5
            # delimiter char (may be . for invisible)
            beg_chr = ''
            if j < len(latex):
                if latex[j] == '\\':
                    # \left\{ etc.
                    dc, j = peek_cmd(latex, j)
                    delim_map = {'lbrace':'{','rbrace':'}','lvert':'|','rvert':'|',
                                 '{':'{','}':'}','|':'|','(':' (',')':")"}
                    beg_chr = delim_map.get(dc or '', dc or '')
                elif latex[j] == '.':
                    beg_chr = ''; j += 1   # invisible delimiter
                else:
                    beg_chr = latex[j]; j += 1
            # find matching \right
            depth = 1
            k = j
            while k < len(latex) and depth > 0:
                if latex[k:k+5] == '\\left':
                    depth += 1; k += 5
                elif latex[k:k+6] == '\\right':
                    depth -= 1
                    if depth == 0:
                        break
                    k += 6
                else:
                    k += 1
            inner = latex[j:k]
            # read end delimiter
            end_chr = ''
            if k < len(latex) and latex[k:k+6] == '\\right':
                k += 6
                if k < len(latex):
                    if latex[k] == '\\':
                        dc, k = peek_cmd(latex, k)
                        delim_map2 = {'lbrace':'{','rbrace':'}','lvert':'|','rvert':'|',
                                      '{':'{','}':'}','|':'|','(':' (',')':')'}
                        end_chr = delim_map2.get(dc or '', dc or '')
                    elif latex[k] == '.':
                        end_chr = ''; k += 1
                    else:
                        end_chr = latex[k]; k += 1
            d_el  = etree.SubElement(parent, f'{{{m}}}d')
            dPr   = etree.SubElement(d_el,  f'{{{m}}}dPr')
            bc    = etree.SubElement(dPr,   f'{{{m}}}begChr'); bc.set(f'{{{m}}}val', beg_chr)
            ec    = etree.SubElement(dPr,   f'{{{m}}}endChr'); ec.set(f'{{{m}}}val', end_chr)
            sc    = etree.SubElement(dPr,   f'{{{m}}}sepChr'); sc.set(f'{{{m}}}val', '')
            # ctrlPr: color the bracket/delimiter characters
            d_ctrlPr = etree.SubElement(dPr,  f'{{{m}}}ctrlPr')
            if color_hex:
                _rpr = etree.SubElement(d_ctrlPr, f'{{{A_NS}}}rPr')
                _sf  = etree.SubElement(_rpr, f'{{{A_NS}}}solidFill')
                _cl  = etree.SubElement(_sf,  f'{{{A_NS}}}srgbClr')
                _cl.set('val', color_hex.upper().lstrip('#'))
            e_el  = etree.SubElement(d_el,  f'{{{m}}}e')
            _append_omml_for_expr(e_el, inner, m_ns, color_hex)
            i = k
            continue

        # ─── ^{exp} → <m:sSup> ───────────────────────────────────────────────
        # The base of sSup is the last atom preceding '^':
        #   • if the buffer holds chars (e.g. "v" in "v^2"), pop the LAST char
        #     as base and flush the prefix to parent.
        #   • if the buffer is empty, the last child of parent is the base
        #     (e.g. the <m:f> produced by \frac{a}{b}^n), steal it.
        if c == '^':
            sup_str, j = _parse_tex_arg(latex, i + 1)
            ss    = etree.SubElement(parent, f'{{{m}}}sSup')
            ssPr  = etree.SubElement(ss, f'{{{m}}}sSupPr')
            etree.SubElement(ssPr, f'{{{m}}}ctrlPr')
            e_el  = etree.SubElement(ss, f'{{{m}}}e')
            if buf:
                # flush prefix, put last char as base
                prefix, base_char = buf[:-1], buf[-1]
                buf = ''
                if prefix:
                    _text_run(parent, prefix)
                # move ss from parent back so it sits after prefix
                parent.remove(ss)
                parent.append(ss)
                _text_run(e_el, base_char)
            else:
                # steal the last child that was added to parent before ss
                children = list(parent)
                # ss is already the last child; last *base* child is children[-2]
                if len(children) >= 2:
                    base_el = children[-2]
                    parent.remove(base_el)
                    e_el.append(base_el)
            sup_el = etree.SubElement(ss, f'{{{m}}}sup')
            _append_omml_for_expr(sup_el, sup_str, m_ns, color_hex)
            i = j
            continue

        # ─── _{sub} → <m:sSub> ───────────────────────────────────────────────
        if c == '_':
            sub_str, j = _parse_tex_arg(latex, i + 1)
            ss    = etree.SubElement(parent, f'{{{m}}}sSub')
            ssPr  = etree.SubElement(ss, f'{{{m}}}sSubPr')
            etree.SubElement(ssPr, f'{{{m}}}ctrlPr')
            e_el  = etree.SubElement(ss, f'{{{m}}}e')
            if buf:
                prefix, base_char = buf[:-1], buf[-1]
                buf = ''
                if prefix:
                    _text_run(parent, prefix)
                parent.remove(ss)
                parent.append(ss)
                _text_run(e_el, base_char)
            else:
                children = list(parent)
                if len(children) >= 2:
                    base_el = children[-2]
                    parent.remove(base_el)
                    e_el.append(base_el)
            sub_el = etree.SubElement(ss, f'{{{m}}}sub')
            _append_omml_for_expr(sub_el, sub_str, m_ns, color_hex)
            i = j
            continue

        # ─── Known LaTeX command → emit symbol as text run ──────────────────
        if cmd is not None and cmd in _OMML_SYM:
            flush_buf(buf); buf = ''
            _text_run(parent, _OMML_SYM[cmd])
            i = cmd_end
            continue

        # ─── Accent decorators: \vec{r}, \hat{x}, \bar{v}, \dot{x}, \ddot{x}, \tilde{} ─
        # Rendered as <m:acc> element so they display visually correctly in PPT
        _ACC_MAP = {
            'vec':  '⃗',    # combining right arrow above → use acc chr
            'hat':  'ˆ',   # combining circumflex
            'bar':  '‾',   # overline
            'dot':  '˙',   # dot above
            'ddot': '¨',   # double dot
            'tilde':'˜',   # tilde
            'overline': '‾',
            'underline': '_',
            'overrightarrow': '⃗',
            'boldsymbol': None,  # just recurse into arg
            'mathbf':     None,
            'mathrm':     None,
            'mathit':     None,
            'text':       None,  # \text{word} → emit as text
        }
        if cmd is not None and cmd in _ACC_MAP:
            flush_buf(buf); buf = ''
            arg_str, j = _parse_tex_arg(latex, cmd_end)
            acc_chr = _ACC_MAP[cmd]
            if acc_chr is None:
                # Transparent wrappers — recurse into argument
                _append_omml_for_expr(parent, arg_str, m_ns, color_hex)
            else:
                # Build <m:acc><m:accPr><m:chr .val=acc_chr/></m:accPr><m:e>…</m:e></m:acc>
                acc_el = etree.SubElement(parent, f'{{{m}}}acc')
                accPr  = etree.SubElement(acc_el, f'{{{m}}}accPr')
                chrEl  = etree.SubElement(accPr, f'{{{m}}}chr')
                chrEl.set(f'{{{m}}}val', acc_chr)
                if color_hex:
                    ctrlPr = etree.SubElement(accPr, f'{{{m}}}ctrlPr')
                    _rpr = etree.SubElement(ctrlPr, f'{{{A_NS}}}rPr')
                    _sf  = etree.SubElement(_rpr, f'{{{A_NS}}}solidFill')
                    _cl  = etree.SubElement(_sf,  f'{{{A_NS}}}srgbClr')
                    _cl.set('val', color_hex.upper().lstrip('#'))
                e_inner = etree.SubElement(acc_el, f'{{{m}}}e')
                _append_omml_for_expr(e_inner, arg_str, m_ns, color_hex)
            i = j
            continue

        # ─── \xrightarrow{...} / \xleftarrow{...} → text + arrow ────────────
        if cmd in ('xrightarrow', 'xleftarrow', 'xRightarrow'):
            flush_buf(buf); buf = ''
            arg_str, j = _parse_tex_arg(latex, cmd_end)
            arrow = '→' if 'right' in (cmd or '').lower() else '←'
            if arg_str.strip():
                _text_run(parent, '(' + _simple_sym(arg_str) + ')')
            _text_run(parent, arrow)
            i = j
            continue

        # ─── {grouped expression} — recurse into group without braces ────────
        if c == '{':
            flush_buf(buf); buf = ''
            inner, j = _parse_tex_arg(latex, i)
            _append_omml_for_expr(parent, inner, m_ns, color_hex)
            i = j
            continue

        # ─── skip closing brace (unmatched) ─────────────────────────────────
        if c == '}':
            flush_buf(buf); buf = ''
            i += 1
            continue

        # ─── Unknown command: emit as best-effort symbol then skip arg ───────
        if c == '\\' and cmd is not None:
            flush_buf(buf); buf = ''
            # Try to get {arg} so it's not left dangling in buf
            has_arg = (cmd_end < len(latex) and latex[cmd_end] == '{')
            sym = _OMML_SYM.get(cmd, cmd)  # emit symbol if known, else cmd name
            _text_run(parent, sym)
            if has_arg:
                arg_str, cmd_end = _parse_tex_arg(latex, cmd_end)
                _append_omml_for_expr(parent, arg_str, m_ns, color_hex)
            i = cmd_end
            continue


        buf += c
        i += 1

    flush_buf(buf)



def _latex_line_to_omml(line: str, color_hex: str = ''):
    """Convert a single equation line (one row of a cases env) to OMML <m:e>.
    Uses _append_omml_for_expr for proper \\frac -> <m:f> rendering.
    """
    from lxml import etree
    e_elem = etree.Element(f'{{{_NS_M}}}e')
    _append_omml_for_expr(e_elem, str(line).strip(), _NS_M, color_hex)
    return e_elem

def _build_cases_omath(lines: list, color_hex: str = '') -> 'etree._Element':
    """
    Build an <m:oMath> element representing a \begin{cases} environment:
    A left curly brace delimiter with stacked equation lines.
    """
    from lxml import etree
    m = _NS_M

    omath = etree.Element(f'{{{m}}}oMath',
                          nsmap={'m': m})
    d_elem = etree.SubElement(omath, f'{{{m}}}d')

    # Delimiter properties: { on left, nothing on right
    dPr = etree.SubElement(d_elem, f'{{{m}}}dPr')
    begChr = etree.SubElement(dPr, f'{{{m}}}begChr')
    begChr.set(f'{{{m}}}val', '{')
    endChr = etree.SubElement(dPr, f'{{{m}}}endChr')
    endChr.set(f'{{{m}}}val', '')
    sepChr = etree.SubElement(dPr, f'{{{m}}}sepChr')
    sepChr.set(f'{{{m}}}val', '')

    # One <m:e> containing an equation array <m:eqArr>
    e_outer = etree.SubElement(d_elem, f'{{{m}}}e')
    eqArr = etree.SubElement(e_outer, f'{{{m}}}eqArr')

    for line in lines:
        e_inner = _latex_line_to_omml(line, color_hex)
        eqArr.append(e_inner)

    return omath


def _build_aligned_omath(lines: list, color_hex: str = '') -> 'etree._Element':
    """Build <m:oMath> for \\begin{aligned} — equation array with no bracket delimiter."""
    from lxml import etree
    m = _NS_M
    omath = etree.Element(f'{{{m}}}oMath', nsmap={'m': m})
    eqArr = etree.SubElement(omath, f'{{{m}}}eqArr')
    for line in lines:
        clean = re.sub(r'&+', '\u2003', line).strip()  # & = alignment tab → em-space
        e_elem = etree.SubElement(eqArr, f'{{{m}}}e')
        _append_omml_for_expr(e_elem, clean, m, color_hex)
    return omath


def _build_matrix_omath(body: str, beg_chr: str, end_chr: str,
                        color_hex: str = '') -> 'etree._Element':
    """Build <m:oMath> for matrix environments (matrix/pmatrix/bmatrix/vmatrix/Vmatrix).
    body: content between \\begin{xmatrix} and \\end{xmatrix}.
    beg_chr / end_chr: delimiter chars, e.g. '(' ')' for pmatrix, '|' '|' for vmatrix.
    """
    from lxml import etree
    m = _NS_M
    omath = etree.Element(f'{{{m}}}oMath', nsmap={'m': m})

    # Parse rows and cells
    raw_rows = re.split(r'\\{1,2}(?![a-zA-Z{\\])', body)
    parsed = []
    max_cols = 1
    for row in raw_rows:
        cells = [c.strip() for c in row.split('&')]
        cells_clean = [c for c in cells if any(ch.strip() for ch in c)]
        if cells_clean:
            parsed.append(cells_clean)
            max_cols = max(max_cols, len(cells_clean))

    # Optional outer delimiter <m:d>
    if beg_chr or end_chr:
        d_el  = etree.SubElement(omath, f'{{{m}}}d')
        dPr   = etree.SubElement(d_el,  f'{{{m}}}dPr')
        bc    = etree.SubElement(dPr,   f'{{{m}}}begChr');  bc.set(f'{{{m}}}val', beg_chr)
        ec    = etree.SubElement(dPr,   f'{{{m}}}endChr');  ec.set(f'{{{m}}}val', end_chr)
        sc    = etree.SubElement(dPr,   f'{{{m}}}sepChr');  sc.set(f'{{{m}}}val', '')
        e_out = etree.SubElement(d_el,  f'{{{m}}}e')
        mat_parent = e_out
    else:
        mat_parent = omath

    # <m:m> matrix element
    m_el  = etree.SubElement(mat_parent, f'{{{m}}}m')
    mPr   = etree.SubElement(m_el, f'{{{m}}}mPr')
    mcs   = etree.SubElement(mPr,  f'{{{m}}}mcs')
    mc    = etree.SubElement(mcs,  f'{{{m}}}mc')
    mcPr  = etree.SubElement(mc,   f'{{{m}}}mcPr')
    cnt   = etree.SubElement(mcPr, f'{{{m}}}count');  cnt.set(f'{{{m}}}val', str(max_cols))
    mcJc  = etree.SubElement(mcPr, f'{{{m}}}mcJc');   mcJc.set(f'{{{m}}}val', 'ctr')
    for cells in parsed:
        mr = etree.SubElement(m_el, f'{{{m}}}mr')
        for cell in cells:
            cell_e = etree.SubElement(mr, f'{{{m}}}e')
            _append_omml_for_expr(cell_e, cell, m, color_hex)
    return omath


# _insert_omath_in_para removed: it used mc:AlternateContent which is
# the Word/.docx approach. In PPTX, use <a14:m> directly in <a:p>.
# See add_cases_math_box for the correct implementation.


def parse_cases_env(text: str):
    """
    Parse text containing $\begin{cases}...\end{cases}$ or $$...$$.
    Returns (pre_text, cases_lines, post_text) or None if not found.
    cases_lines is a list of equation strings (one per row).
    """
    if '\\begin{cases}' not in text:
        return None

    # Try $$...$$ FIRST (must come before single-$ check to avoid false match)
    pat_block = re.compile(
        r'(.*?)\$\$\s*\\begin\{cases\}(.*?)\\end\{cases\}\s*\$\$(.*)',
        re.DOTALL
    )
    # Then $...$
    pat_inline = re.compile(
        r'(.*?)(?<!\$)\$(?!\$)\s*\\begin\{cases\}(.*?)\\end\{cases\}\s*\$(?!\$)(.*)',
        re.DOTALL
    )

    # Priority 3: bare cases -- no $ delimiters (LLMs often omit them)
    pat_bare = re.compile(
        r'(.*?)\\begin\{cases\}(.*?)\\end\{cases\}(.*)',
        re.DOTALL
    )

    m = pat_block.match(text) or pat_inline.match(text) or pat_bare.match(text)
    if not m:
        return None

    pre   = m.group(1).strip()
    body  = m.group(2)
    post  = m.group(3).strip()

    # Split on LaTeX line break: \\  (may be 1 OR 2 backslashes depending on
    # JSON encoding level). Stop before \letter (LaTeX commands like \frac, \alpha).
    raw_lines = re.split(r'\\{1,2}(?![a-zA-Z{\\])', body)
    lines = [l.strip().lstrip('&').strip() for l in raw_lines if l.strip()]
    return pre, lines, post


def parse_block_math_env(text: str):
    """Match ANY recognized \\begin{env}...\\end{env} block in text.
    Returns (env_name, pre_text, body_str, post_text) or None.
    Handles $$, $, and bare (no dollar) delimiters.
    env_name is the raw LaTeX environment name (e.g. 'vmatrix', 'aligned').
    """
    env_alt = _MATH_ENV_NAMES_RE
    for pat_str, grp_map in [
        # ── NEW: $$INNER_PRE\begin{env}...\end{env}$$ ────────────────────────
        # Handles e.g. $$D_n= \begin{vmatrix}...\end{vmatrix}$$
        # grp 1=outer_pre, grp 2=inner_pre (between $$ and \begin), grp 3=env,
        # grp 4=body, grp 5=post
        (r'(.*?)\$\$([^$\\][^\\]*?)\s*\\begin\{(' + env_alt + r')\}(.*?)\\end\{\3\}\s*\$\$(.*)',
         'inner_$$'),
        # ── $$\begin{env}...$$ (only whitespace between $$ and \begin) ───────
        (r'(.*?)\$\$\s*\\begin\{(' + env_alt + r')\}(.*?)\\end\{\2\}\s*\$\$(.*)',
         (2, 1, 3, 4)),
        # $...env...$  with NOTHING between \end{env} and closing $
        (r'(.*?)(?<!\$)\$(?!\$)\s*\\begin\{(' + env_alt + r')\}(.*?)\\end\{\2\}\s*\$(?!\$)(.*)',
         (2, 1, 3, 4)),
        # $...env... trailing_content $  (content between \end{env} and $)
        # e.g. $\begin{vmatrix}a&b\\c&d\end{vmatrix} = ad-bc$
        (r'(.*?)(?<!\$)\$(?!\$)\s*\\begin\{(' + env_alt + r')\}(.*?)\\end\{\2\}([^$\n]*)\$(?!\$)(.*)',
         (2, 1, 3, (4, 5))),    # grp 4=tail-inside-$ grp 5=after-$
        # bare: no $ delimiters
        (r'(.*?)\\begin\{(' + env_alt + r')\}(.*?)\\end\{\2\}(.*)',
         (2, 1, 3, 4)),
    ]:
        mo = re.compile(pat_str, re.DOTALL).match(text)
        if mo:
            if grp_map == 'inner_$$':
                # Special case: combine outer_pre + inner_pre as the full pre_text
                outer_pre = mo.group(1).strip()
                inner_pre = mo.group(2).strip()          # e.g. "D_n="
                env_name  = mo.group(3)
                body      = mo.group(4)
                post      = mo.group(5).strip()
                # Merge outer_pre and inner_pre
                pre = (outer_pre + ' ' + inner_pre).strip() if outer_pre else inner_pre
                # Strip any orphan $ signs from pre/post
                pre  = re.sub(r'\$+\s*$', '', pre).strip()
                post = re.sub(r'^\s*\$+', '', post).strip()
                return env_name, pre, body, post

            env_g, pre_g, body_g, post_g = grp_map
            if isinstance(post_g, tuple):
                # two groups make up post: tail inside $...$ + content after closing $
                post = (mo.group(post_g[0]) + ' ' + mo.group(post_g[1])).strip()
            else:
                post = mo.group(post_g).strip()
            # Strip ALL orphan $ signs left by bare-pattern or mismatched delimiters
            pre  = re.sub(r'\$+\s*$', '',  mo.group(pre_g).strip()).strip()
            post = re.sub(r'^\s*\$+',  '', post).strip()
            return mo.group(env_g), pre, mo.group(body_g), post
    return None


def _append_block_math_to_tf(tf, text: str, size: int,
                              color: 'RGBColor', accent: 'RGBColor') -> None:
    """
    Append one or more paragraphs to an existing TextFrame for `text` which may
    contain multiple \\begin{env}...\\end{env} math environments mixed with prose.

    Algorithm:
      1. Look for the first recognized math environment in `text`.
      2. If found: add pPr-paragraph with inline pre_text run + OMML block,
         then call self recursively for the remaining post_text.
      3. If not found: add a plain paragraph (inline $...$ → OMML if present,
         otherwise convert_latex → plain text).
    """
    from pptx.util import Pt
    from lxml import etree

    text = text.strip()
    if not text:
        return

    A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main'
    M_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    A_NS   = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    XML_SP = '{http://www.w3.org/XML/1998/namespace}space'

    result = parse_block_math_env(text)
    if result is None:
        # No block math environment — try inline $...$ OMML, else plain text
        p = tf.add_paragraph()
        if '$' in text and re.search(r'\\[A-Za-z]|[\^_]', text):
            if not _add_inline_math_para(p._p, text, size, color, accent):
                _add_rich_para(tf, convert_latex(text), size, color, accent, first=False)
        else:
            _add_rich_para(tf, convert_latex(text), size, color, accent, first=False)
        return

    env_name, pre_text, body, post_text = result
    post_text = re.sub(r'^[，。、；：！？,;:!\.\s]+', '', post_text).strip()

    env_cfg  = _MATH_BLOCK_ENVS.get(env_name, ('cases', '{', ''))
    env_type, beg_chr, end_chr = env_cfg
    color_hex = str(color).upper().lstrip('#')

    # ── New paragraph in the existing textframe ──────────────────────────────
    p_math = tf.add_paragraph()
    p_elem = p_math._p

    for existing_pPr in p_elem.findall(f'{{{A_NS}}}pPr'):
        p_elem.remove(existing_pPr)
    pPr    = etree.Element(f'{{{A_NS}}}pPr')
    defRPr = etree.SubElement(pPr, f'{{{A_NS}}}defRPr')
    defRPr.set('sz', str(size * 100))
    sf     = etree.SubElement(defRPr, f'{{{A_NS}}}solidFill')
    clr    = etree.SubElement(sf, f'{{{A_NS}}}srgbClr')
    clr.set('val', str(color).upper())
    p_elem.insert(0, pPr)

    # Inline pre_text run (if any)
    if pre_text:
        r_pre   = etree.SubElement(p_elem, f'{{{A_NS}}}r')
        rPr_pre = etree.SubElement(r_pre, f'{{{A_NS}}}rPr')
        rPr_pre.set('sz', str(size * 100))
        sf2 = etree.SubElement(rPr_pre, f'{{{A_NS}}}solidFill')
        cl2 = etree.SubElement(sf2,     f'{{{A_NS}}}srgbClr')
        cl2.set('val', str(color).upper())
        t2 = etree.SubElement(r_pre, f'{{{A_NS}}}t')
        t2.set(XML_SP, 'preserve')
        t2.text = convert_latex(pre_text) + '\u2009'

    # OMML block
    raw_lines = re.split(r'\\{1,2}(?![a-zA-Z{\\])', body)
    lines     = [ln.strip().lstrip('&').strip() for ln in raw_lines if ln.strip()]
    if env_type == 'cases':
        omath = _build_cases_omath(lines, color_hex)
    elif env_type == 'aligned':
        omath = _build_aligned_omath(lines, color_hex)
    else:
        omath = _build_matrix_omath(body, beg_chr, end_chr, color_hex)

    oMathPara = etree.Element(f'{{{M_NS}}}oMathPara', nsmap={'m': M_NS})
    oMathPara.append(omath)
    a14_m = etree.SubElement(p_elem, f'{{{A14_NS}}}m', nsmap={'a14': A14_NS, 'm': M_NS})
    a14_m.append(oMathPara)

    # Recurse for any further math environments in post_text
    if post_text:
        _append_block_math_to_tf(tf, post_text, size, color, accent)


def add_cases_math_box(slide, text: str, l, t, w, h, size: int,
                       color: 'RGBColor', accent: 'RGBColor') -> bool:
    """Render any recognized \\begin{env}...\\end{env} math block as OMML.
    Handles: cases, aligned, align, align*, matrix, pmatrix, bmatrix, vmatrix, Vmatrix.
    Returns True if handled, False if nothing matched (caller falls back to plain text).

    Rendering rule:
      - If pre_text exists (e.g. 'D_n ='), it is placed as an inline <a:r> run
        in the SAME paragraph as the OMML block (same line).
      - post_text is handled recursively by _append_block_math_to_tf so that
        additional \\begin{env} blocks in the post_text are also OMML-rendered.
    """
    from pptx.util import Pt
    from lxml import etree

    result = parse_block_math_env(text)
    if result is None:
        return False

    env_name, pre_text, body, post_text = result
    post_text = re.sub(r'^[，。、；：！？,;:!\.\s]+', '', post_text).strip()

    env_cfg  = _MATH_BLOCK_ENVS.get(env_name, ('cases', '{', ''))
    env_type, beg_chr, end_chr = env_cfg

    A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main'
    M_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    A_NS   = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    XML_SP = '{http://www.w3.org/XML/1998/namespace}space'

    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True

    # ── First paragraph: pre_text (inline) + OMML (same line) ───────────────
    p_math = tf.paragraphs[0]
    p_elem = p_math._p

    for existing_pPr in p_elem.findall(f'{{{A_NS}}}pPr'):
        p_elem.remove(existing_pPr)
    pPr     = etree.Element(f'{{{A_NS}}}pPr')
    defRPr  = etree.SubElement(pPr, f'{{{A_NS}}}defRPr')
    defRPr.set('sz', str(size * 100))
    sf      = etree.SubElement(defRPr, f'{{{A_NS}}}solidFill')
    clr     = etree.SubElement(sf, f'{{{A_NS}}}srgbClr')
    clr.set('val', str(color).upper())
    p_elem.insert(0, pPr)

    # Inline pre_text run (e.g. "D_n =", "解析：观察得$A=")
    if pre_text:
        pre_converted = convert_latex(pre_text)
        r_pre   = etree.SubElement(p_elem, f'{{{A_NS}}}r')
        rPr_pre = etree.SubElement(r_pre, f'{{{A_NS}}}rPr')
        rPr_pre.set('sz', str(size * 100))
        sf_pre  = etree.SubElement(rPr_pre, f'{{{A_NS}}}solidFill')
        cl_pre  = etree.SubElement(sf_pre,  f'{{{A_NS}}}srgbClr')
        cl_pre.set('val', str(color).upper())
        t_pre = etree.SubElement(r_pre, f'{{{A_NS}}}t')
        t_pre.set(XML_SP, 'preserve')
        t_pre.text = pre_converted + '\u2009'  # thin space separator before matrix

    # ── Route to correct OMML builder ──────────────────────────────────────
    color_hex = str(color).upper().lstrip('#')
    raw_lines = re.split(r'\\{1,2}(?![a-zA-Z{\\])', body)
    lines     = [ln.strip().lstrip('&').strip() for ln in raw_lines if ln.strip()]
    if env_type == 'cases':
        omath = _build_cases_omath(lines, color_hex)
    elif env_type == 'aligned':
        omath = _build_aligned_omath(lines, color_hex)
    else:  # matrix
        omath = _build_matrix_omath(body, beg_chr, end_chr, color_hex)

    oMathPara = etree.Element(f'{{{M_NS}}}oMathPara', nsmap={'m': M_NS})
    oMathPara.append(omath)
    a14_m = etree.SubElement(p_elem, f'{{{A14_NS}}}m', nsmap={'a14': A14_NS, 'm': M_NS})
    a14_m.append(oMathPara)

    # ── post_text: may contain more math envs → recursive helper ─────────────
    if post_text:
        _append_block_math_to_tf(tf, post_text, size, color, accent)

    return True


def _add_inline_math_para(p_elem, text: str, size: int,
                          color: 'RGBColor', accent: 'RGBColor',
                          bold: bool = False) -> bool:
    """Build a paragraph with mixed plain-text <a:r> runs and inline OMML <a14:m> math.
    Activates when text contains ANY $...$ expression with a LaTeX construct
    (backslash command, ^ superscript, _ subscript).
    Returns True if the paragraph was built (caller must NOT also call _add_rich_para).
    Returns False if no qualifying inline math was found (falls back to plain text).
    """
    # Activate if text has a $ delimiter at all (single or double)
    if '$' not in text:
        return False

    from lxml import etree

    A_NS   = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    A14    = 'http://schemas.microsoft.com/office/drawing/2010/main'
    M_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
    XML_SP = '{http://www.w3.org/XML/1998/namespace}space'

    # Split text into (type, content) segments: 'text' | 'math'
    segments = []
    pos = 0
    for mobj in re.finditer(r'\$\$(.+?)\$\$|\$([^$\n]+?)\$', text, re.DOTALL):
        if mobj.start() > pos:
            segments.append(('text', text[pos:mobj.start()]))
        segments.append(('math', mobj.group(1) or mobj.group(2) or ''))
        pos = mobj.end()
    if pos < len(text):
        segments.append(('text', text[pos:]))

    # Only activate OMML path if at least one math segment contains a real LaTeX construct
    def _has_latex(s: str) -> bool:
        return bool(re.search(r'\\[A-Za-z]|[\^_]', s))

    if not any(seg[0] == 'math' and _has_latex(seg[1]) for seg in segments):
        return False

    def _plain_run(txt: str, is_bold: bool):
        """Emit a plain-text <a:r> run (with convert_latex for any $ or \ inside)."""
        converted = convert_latex(txt) if ('$' in txt or '\\' in txt) else txt
        converted = re.sub(r'\\[A-Za-z]+\*?', '', converted).strip()
        if not converted:
            return
        r_el = etree.SubElement(p_elem, f'{{{A_NS}}}r')
        rPr  = etree.SubElement(r_el, f'{{{A_NS}}}rPr')
        rPr.set('sz', str(size * 100))
        if is_bold:
            rPr.set('b', '1')
        sf = etree.SubElement(rPr, f'{{{A_NS}}}solidFill')
        cl = etree.SubElement(sf, f'{{{A_NS}}}srgbClr')
        cl.set('val', str(accent if is_bold else color).upper())
        t_el = etree.SubElement(r_el, f'{{{A_NS}}}t')
        t_el.set(XML_SP, 'preserve')
        t_el.text = converted

    for seg_type, seg_content in segments:
        if seg_type == 'text':
            for piece in re.split(r'(\*\*[^*]+\*\*)', seg_content):
                is_b = piece.startswith('**') and piece.endswith('**')
                _plain_run(piece[2:-2] if is_b else re.sub(r'`(.+?)`', r'\1', piece), is_b)
        else:
            # Pass the text color so OMML math runs match surrounding PPT text
            color_hex = str(color).upper().lstrip('#')
            omath = etree.Element(f'{{{M_NS}}}oMath', nsmap={'m': M_NS})
            _append_omml_for_expr(omath, seg_content, M_NS, color_hex)
            oMathPara = etree.Element(f'{{{M_NS}}}oMathPara', nsmap={'m': M_NS})
            oMathPara.append(omath)
            a14_m = etree.SubElement(p_elem, f'{{{A14}}}m', nsmap={'a14': A14, 'm': M_NS})
            a14_m.append(oMathPara)
    return True


def convert_latex(text: str) -> str:
    """
    Convert LaTeX math expressions ($...$  /  $$...$$) to readable Unicode text.
    Also converts bare subscript/superscript notation like a_t or v^2 outside $ delimiters.
    Applied to all PPT content before export.
    """
    if not text:
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
        """Convert LaTeX math body to readable Unicode text."""
        # 1a. \begin{cases}...\end{cases} → Unicode brace staircase
        def _do_cases(m):
            body = m.group(1)
            rows = re.split(r'\\\\', body)
            parts = [_inner(ln.strip().lstrip('&').strip()) for ln in rows if ln.strip()]
            if len(parts) == 0:   return ''
            elif len(parts) == 1: return '\u23a7 ' + parts[0]
            elif len(parts) == 2: return '\u23a7 ' + parts[0] + '\n\u23a9 ' + parts[1]
            else:
                out = '\u23a7 ' + parts[0]
                for mid in parts[1:-1]: out += '\n\u23aa ' + mid
                out += '\n\u23a9 ' + parts[-1]
                return out
        s = re.sub(r'\\begin\{cases\}(.*?)\\end\{cases\}', _do_cases, s, flags=re.DOTALL)

        # 1b. \begin{aligned/align}...\end{...} → numbered rows separated by newlines
        def _do_aligned(m):
            body = m.group(1)
            rows = re.split(r'\\\\', body)
            parts = [_inner(re.sub(r'&+', '  ', ln).strip()) for ln in rows if ln.strip()]
            return '\n'.join(parts)
        s = re.sub(r'\\begin\{align(?:\*|ed)?\}(.*?)\\end\{align(?:\*|ed)?\}',
                   _do_aligned, s, flags=re.DOTALL)

        # 1c. Matrix environments → bracket notation
        def _do_matrix(m_obj):
            env_  = m_obj.group(1)  # e.g. 'vmatrix', 'pmatrix'
            body  = m_obj.group(2)
            _BEG  = {'pmatrix':'(','bmatrix':'[','vmatrix':'|','Vmatrix':'\u2016','matrix':''}
            _END  = {'pmatrix':')','bmatrix':']','vmatrix':'|','Vmatrix':'\u2016','matrix':''}
            rows  = re.split(r'\\\\', body)
            row_strs = []
            for row in rows:
                cells = [_inner(c.strip()) for c in row.split('&') if c.strip()]
                row_strs.append('  '.join(cells))
            mat_str = '\n'.join(row_strs)
            b, e = _BEG.get(env_, ''), _END.get(env_, '')
            return f'{b}\n{mat_str}\n{e}' if b or e else mat_str
        s = re.sub(
            r'\\begin\{(matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}(.*?)\\end\{\1\}',
            _do_matrix, s, flags=re.DOTALL)

        # 1d. \sqrt[n]{x} → ⁿ√x  / \sqrt{x} → √x
        s = re.sub(r'\\sqrt\[([^\]]+)\]\{([^{}]*)\}',
                   lambda m: _inner(m.group(1)) + '\u221a' + _inner(m.group(2)), s)
        s = re.sub(r'\\sqrt\{([^{}]*)\}',
                   lambda m: '\u221a(' + _inner(m.group(1)) + ')', s)
        s = re.sub(r'\\sqrt\s+([A-Za-z0-9])',
                   lambda m: '\u221a' + m.group(1), s)

        # 2. \frac{num}{den} -> num/den  (parenthesise multi-char denominators for readability)
        def _frac_fmt(mf):
            num = _inner(mf.group(1))
            den = _inner(mf.group(2))
            if len(den.replace(' ', '')) > 1:
                den = f'({den})'
            return f'{num}/{den}'
        s = re.sub(r'\\frac\{([^{}]*)\}\{([^{}]*)\}', _frac_fmt, s)

        # 3. \xrightarrow, \xleftarrow
        s = re.sub(r'\\xrightarrow\{([^{}]*)\}', lambda m: f"({_inner(m.group(1))})\u2192", s)
        s = re.sub(r'\\xleftarrow\{([^{}]*)\}',  lambda m: f"\u2190({_inner(m.group(1))})", s)

        # 4. Decorated letters (recurse into arg so \Delta inside works)
        s = re.sub(r'\\vec\{([^{}]*)\}',   lambda m: _inner(m.group(1)) + '\u20d7', s)
        s = re.sub(r'\\hat\{([^{}]*)\}',   lambda m: _inner(m.group(1)) + '\u0302', s)
        s = re.sub(r'\\ddot\{([^{}]*)\}',  lambda m: _inner(m.group(1)) + '\u0308', s)
        s = re.sub(r'\\dot\{([^{}]*)\}',   lambda m: _inner(m.group(1)) + '\u0307', s)
        s = re.sub(r'\\tilde\{([^{}]*)\}', lambda m: _inner(m.group(1)) + '\u0303', s)
        s = re.sub(r'\\bar\{([^{}]*)\}',   lambda m: _inner(m.group(1)) + '\u0305', s)
        s = re.sub(r'\\vec\s+([A-Za-z])',  lambda m: m.group(1) + '\u20d7', s)

        # 5. SYMBOL TABLE -- must run BEFORE ^_{} subscript expansion
        #    so \Delta inside _{} becomes \u0394 first, not garbled subscript chars
        for pat, uni in _SYM:
            s = re.sub(pat, uni, s)

        # 6. Function names: strip backslash, keep text
        for fn in ('lim','sin','cos','tan','cot','sec','csc',
                   'log','ln','exp','max','min','sup','inf',
                   'det','dim','ker','deg','gcd','arcsin','arccos','arctan'):
            s = re.sub(r'\\' + fn + r'\b', fn, s)

        # 7. ^{exp} and _{sub} -- dict-based, works for single chars
        #    For long subscripts (e.g. {\Delta t \to 0}), wrap in parens after symbol sub
        _IN_SUB = {
            '0':'\u2080','1':'\u2081','2':'\u2082','3':'\u2083','4':'\u2084',
            '5':'\u2085','6':'\u2086','7':'\u2087','8':'\u2088','9':'\u2089',
            'a':'\u2090','e':'\u2091','i':'\u1d62','j':'\u2c7c','o':'\u2092',
            'r':'\u1d63','s':'\u209b','t':'\u209c','u':'\u1d64','n':'\u2099',
            'k':'\u2096','m':'\u2098','p':'\u209a','x':'\u2093','v':'\u1d65',
            'l':'\u2097','h':'\u2095','+':'\u208a','-':'\u208b','=':'\u208c',
            '(':'\u208d',')':'\u208e',
        }
        _IN_SUP = {
            '0':'\u2070','1':'\u00b9','2':'\u00b2','3':'\u00b3','4':'\u2074',
            '5':'\u2075','6':'\u2076','7':'\u2077','8':'\u2078','9':'\u2079',
            'a':'\u1d43','b':'\u1d47','c':'\u1d9c','d':'\u1d48','e':'\u1d49',
            'f':'\u1da0','g':'\u1d4d','h':'\u02b0','i':'\u2071','j':'\u02b2',
            'k':'\u1d4f','l':'\u02e1','m':'\u1d50','n':'\u207f','o':'\u1d52',
            'p':'\u1d56','r':'\u02b3','s':'\u02e2','t':'\u1d57','u':'\u1d58',
            'v':'\u1d5b','w':'\u02b7','x':'\u02e3','y':'\u02b8','z':'\u1dbb',
            'A':'\u1d2c','B':'\u1d2e','D':'\u1d30','E':'\u1d31','G':'\u1d33',
            'H':'\u1d34','I':'\u1d35','J':'\u1d36','K':'\u1d37','L':'\u1d38',
            'M':'\u1d39','N':'\u1d3a','O':'\u1d3c','P':'\u1d3e','R':'\u1d3f',
            'T':'\u1d40','U':'\u1d41','W':'\u1d42',
            '+':'\u207a','-':'\u207b','=':'\u207c','(':'\u207d',')':'\u207e',
        }
        def _to_sub(seg: str) -> str:
            # long/complex subscripts: wrap in parens to keep readable
            if len(seg) > 3 or (' ' in seg and len(seg) > 1):
                return '(' + seg + ')'
            return ''.join(_IN_SUB.get(c, c) for c in seg)
        def _to_sup(seg: str) -> str:
            if len(seg) > 3 or (' ' in seg and len(seg) > 1):
                return '(' + seg + ')'
            return ''.join(_IN_SUP.get(c, c) for c in seg)

        s = re.sub(r'\^\{([^{}]*)\}', lambda m: _to_sup(m.group(1)), s)
        s = re.sub(r'_\{([^{}]*)\}',  lambda m: _to_sub(m.group(1)), s)
        s = re.sub(r'\^([A-Za-z0-9])', lambda m: _to_sup(m.group(1)), s)
        s = re.sub(r'_([A-Za-z0-9])',  lambda m: _to_sub(m.group(1)), s)

        # 8. Strip remaining \commands and bare braces
        s = re.sub(r'\\[A-Za-z]+\*?', '', s)
        s = s.replace('{', '').replace('}', '')
        return s.strip()


    # $$...$$  (block math, possibly multiline)
    text = re.sub(r'\$\$(.+?)\$\$', lambda m: _inner(m.group(1)), text, flags=re.DOTALL)
    # $...$  (inline math)
    text = re.sub(r'\$([^$\n]+?)\$', lambda m: _inner(m.group(1)), text)

    # Handle bare sub/superscripts outside $...$  e.g. a_t, v^2, a_n
    _SUB_DICT = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
                 'a':'ₐ','e':'ₑ','i':'ᵢ','j':'ⱼ','o':'ₒ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','n':'ₙ',
                 'k':'ₖ','m':'ₘ','p':'ₚ','x':'ₓ','v':'ᵥ','l':'ₗ','h':'ₕ'}
    _SUP_DICT = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹',
                 'a':'ᵃ','b':'ᵇ','c':'ᶜ','d':'ᵈ','e':'ᵉ','f':'ᶠ','g':'ᵍ','h':'ʰ','i':'ⁱ','j':'ʲ',
                 'k':'ᵏ','l':'ˡ','m':'ᵐ','n':'ⁿ','o':'ᵒ','p':'ᵖ','r':'ʳ','s':'ˢ','t':'ᵗ','u':'ᵘ',
                 'v':'ᵛ','w':'ʷ','x':'ˣ','y':'ʸ','z':'ᶻ','A':'ᴬ','B':'ᴮ','D':'ᴰ','E':'ᴱ','G':'ᴳ',
                 'H':'ᴴ','I':'ᴵ','J':'ᴶ','K':'ᴷ','L':'ᴸ','M':'ᴹ','N':'ᴺ','O':'ᴼ','P':'ᴾ','R':'ᴿ',
                 'T':'ᵀ','U':'ᵁ','V':'ⱽ','W':'ᵂ','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾'}
    def _bare_sub(s):
        return ''.join(_SUB_DICT.get(c, c) for c in s)
    def _bare_sup(s):
        return ''.join(_SUP_DICT.get(c, c) for c in s)
    text = re.sub(r'([A-Za-z0-9])_\{([^}]+)\}', lambda m: m.group(1) + _bare_sub(m.group(2)), text)
    text = re.sub(r'([A-Za-z0-9])\^\{([^}]+)\}', lambda m: m.group(1) + _bare_sup(m.group(2)), text)
    text = re.sub(r'([A-Za-z0-9])_([A-Za-z0-9])', lambda m: m.group(1) + _bare_sub(m.group(2)), text)
    text = re.sub(r'([A-Za-z0-9])\^([A-Za-z0-9])', lambda m: m.group(1) + _bare_sup(m.group(2)), text)
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
    """Return element content as a list of strings, with LaTeX converted.
    IMPORTANT: do NOT split on \\n from cases environments - that would create
    phantom cards from equation lines.
    """
    raw = elem.get("content", [])
    if not isinstance(raw, list):
        raw = [str(raw)] if raw else []
    result = []
    for c in raw:
        if not c:
            continue
        converted = convert_latex(str(c))
        result.append(converted)
    return result







def get_raw_content_list(elem: dict) -> list:
    """Return element content as raw strings WITHOUT converting LaTeX.
    Used when we need to preserve \\begin{cases} etc. for OMML rendering.
    """
    raw = elem.get("content", [])
    if not isinstance(raw, list):
        raw = [str(raw)] if raw else []
    return [str(c) for c in raw if c]


def _est_card_h(text: str, text_w_inches: float, font_sz: int = 16) -> float:
    """Estimate compact card height for text at font_sz pt in a text_w_inches-wide box.
    CJK chars count as 1 unit, ASCII as 0.55 units for character-width estimation.
    Handles \\begin{cases} environments by counting rows via parse_cases_env.
    """
    s = str(text)
    line_h = font_sz * 1.5 / 72.0   # height per text line, in inches
    extra_h = 0.0
    spacer_h = 0.0

    # Use parse_block_math_env so ALL environments are counted correctly.
    bme = parse_block_math_env(s)
    if bme is None:
        bme = parse_cases_env(s)  # legacy fallback; returns (pre, lines, post)
        if bme is not None:
            pre2, case_lines2, post2 = bme
            bme = ('cases', pre2, None, post2)
            case_lines = case_lines2
        else:
            case_lines = []
    else:
        _, pre2, body2, post2 = bme
        raw_rows = re.split(r'\\{1,2}(?![a-zA-Z{\\])', body2 or '')
        case_lines = [r.strip() for r in raw_rows if r.strip()]
    if bme is not None:
        pre  = pre2 if isinstance(bme, tuple) and len(bme) == 4 else bme[1]
        post = post2 if isinstance(bme, tuple) and len(bme) == 4 else bme[3]
        n_rows = max(1, len(case_lines))
        math_line_h = font_sz * 1.6 / 72.0
        extra_h = n_rows * math_line_h + 0.10
        s = pre2
        has_post = bool(post2.strip() if post2 else '')
        spacer_h = (max(font_sz - 4, 10) * 1.5 / 72.0) if has_post else 0.0

    cjk   = sum(1 for c in s if '\u4e00' <= c <= '\u9fff')
    other = len(s) - cjk
    eff   = cjk + other * 0.55           # CJK-equivalent length
    cpl   = max(1.0, (text_w_inches * 72.0) / font_sz)  # chars per line
    lines = max(0, int(eff / cpl + 0.99))                # text lines (0 if only math)

    return lines * line_h + extra_h + spacer_h + 0.28    # text + math + spacer + padding



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


def _lum(c: "RGBColor") -> float:
    """Perceptual relative luminance of an RGBColor (0–1)."""
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255.0


def _card_bg(bg: "RGBColor", acc: "RGBColor", dark: bool) -> "RGBColor":
    """Luminance-aware card background, matching frontend glassmorphism logic.

    CSS for dark themes: rgba(0,0,0,0.3) overlay = card is DARKER than bg.
    But for extremely dark bgs (lum < 0.08) darkening yields indistinguishable
    near-black, so we fall back to a subtle accent tint instead.

    For light themes: rgba(255,255,255,0.55) = card is lighter than bg.
    """
    _W = RGBColor(0xFF, 0xFF, 0xFF)
    _B = RGBColor(0x00, 0x00, 0x00)
    if dark:
        bg_lum = _lum(bg)
        if bg_lum < 0.05:          # near-black bg — use a medium dark overlay
            return blend(RGBColor(0x00, 0x00, 0x00), bg, 0.40)  # slightly visible dark card
        if bg_lum < 0.15:          # dark bg — darken significantly for visible contrast
            return blend(_B, bg, 0.50)   # 50% darken — strong contrast card
        return blend(_B, bg, 0.35)   # moderate dark bg: darken 35%
    return blend(_W, bg, 0.55)       # light bg: card is clearly lighter


def _card_border(bg: "RGBColor", dark: bool) -> "RGBColor | None":
    """Thin glassy card border matching CSS border: 1px solid rgba(255,255,255,0.15).
    Returns None for light themes (no border needed).
    """
    if not dark:
        return None
    return blend(RGBColor(0xFF, 0xFF, 0xFF), bg, 0.18)


# ──────────────────────────────────────────────
# Low-level drawing primitives
# ──────────────────────────────────────────────

def rect(slide, l, t, w, h, fill: "RGBColor", shape_id: int = 1) -> None:
    sp = slide.shapes.add_shape(shape_id, Inches(l), Inches(t), Inches(w), Inches(h))
    sp.fill.solid()
    sp.fill.fore_color.rgb = fill
    sp.line.fill.background()


def rect_rounded(slide, l, t, w, h, fill: "RGBColor",
                 border_col: "RGBColor | None" = None,
                 radius_pt: float = 8.0) -> None:
    """Rectangle with ONLY the right two corners rounded (left stays square).
    Matches CSS: border-radius: 0 8px 8px 0.
    border_col: if given, draw a 0.75pt border line (for dark theme card outline).
    """
    W_emu = int(Inches(w))
    H_emu = int(Inches(h))
    r_emu = int(Pt(radius_pt))
    r_emu = min(r_emu, H_emu // 2, W_emu // 4)

    NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
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
    prstGeom = sp_el.find('.//' + qn('a:prstGeom'))
    if prstGeom is not None:
        parent = prstGeom.getparent()
        idx = list(parent).index(prstGeom)
        parent.remove(prstGeom)
        parent.insert(idx, etree.fromstring(cg_xml))

    sp.fill.solid()
    sp.fill.fore_color.rgb = fill
    if border_col is not None:
        sp.line.color.rgb = border_col
        sp.line.width = Pt(0.75)
    else:
        sp.line.fill.background()


def line_h(slide, l, t, w, thickness: float, color: "RGBColor") -> None:
    rect(slide, l, t, w, thickness, color)


def line_v(slide, l, t, h, thickness: float, color: "RGBColor") -> None:
    rect(slide, l, t, thickness, h, color)


def tb_plain(slide, text: str, l, t, w, h, size: int, color: "RGBColor",
             bold: bool = False, align=None,
             v_anchor: str = 't', fixed_h: bool = False) -> None:
    """Plain textbox.
    v_anchor: 't'=top (default), 'ctr'=center, 'b'=bottom aligned text.
    fixed_h: if True, sets noAutofit so the text box keeps the given height.
    """
    from pptx.util import Pt
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.text = strip_md_plain(str(text))
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color
    if align:
        p.alignment = align
    # Vertical anchor + optional fixed height
    bodyPr = tf._txBody.bodyPr
    if v_anchor != 't':
        bodyPr.set('anchor', v_anchor)
    if fixed_h:
        for tag in ('a:spAutoFit', 'a:normAutofit', 'a:noAutofit'):
            el = bodyPr.find(qn(tag))
            if el is not None:
                bodyPr.remove(el)
        etree.SubElement(bodyPr, qn('a:noAutofit'))


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
    """Single-paragraph rich textbox.
    Routing priority:
      1. \\begin{cases}  -> OMML via add_cases_math_box
      2. $\\frac{}{} ... $ -> mixed plain+OMML via _add_inline_math_para
      3. Plain text via _add_rich_para
    """
    # 1. Cases OMML
    if add_cases_math_box(slide, text, l, t, w, h, size, color, accent):
        return
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    from pptx.oxml.ns import qn as _qn
    _bpr = tf._txBody.find(_qn('a:bodyPr'))
    if _bpr is not None:
        _bpr.set('anchor', 'ctr')
    p_elem = tf.paragraphs[0]._p
    # 2. Inline fraction OMML
    if _add_inline_math_para(p_elem, text, size, color, accent, bold=bold):
        return
    # 3. Plain rich text
    _add_rich_para(tf, text, size, color, accent, bold=bold, align=align, first=True)


def add_list_box(slide, items: list, l, t, w, h, size: int,
                 color: "RGBColor", accent: "RGBColor",
                 bullet: str = "•  ") -> None:
    """Multi-paragraph list textbox, vertically centered.
    Each bullet item that contains LaTeX $...$ math is rendered via OMML.
    """
    from lxml import etree
    MAX = 8
    if len(items) > MAX:
        items = items[:MAX - 1] + [f"… (+{len(items) - MAX + 1} 项)"]
    safe = calc_safe_pt(h, len(items), base_pt=size, min_pt=10, max_pt=size)
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    # Vertically center text within the card background rectangle.
    from pptx.oxml.ns import qn as _qn
    _bpr = tf._txBody.find(_qn('a:bodyPr'))
    if _bpr is not None:
        _bpr.set('anchor', 'ctr')

    A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'

    for i, item in enumerate(items):
        clean = re.sub(r'^[\-\*\+]\s+', '', str(item))
        clean = re.sub(r'^\d+\.\s+', '', clean)
        full_text = bullet + clean

        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p_elem = p._p

        # Try OMML inline math first
        if _add_inline_math_para(p_elem, full_text, safe, color, accent):
            continue  # OMML path handled it

        # Fallback: plain rich text (bullet prefix + content)
        _add_rich_para(tf, full_text, safe, color, accent, first=(i == 0))




# ──────────────────────────────────────────────
# Shared slide chrome
# ──────────────────────────────────────────────

def draw_chrome(slide, page_idx: int, title: str, colors: dict) -> None:
    """Slide chrome: page number in muted primary (opacity ~0.45), bold title bottom-anchored
    above the accent underline, and large faded watermark in bottom-right."""
    from pptx.util import Pt
    from pptx.enum.text import PP_ALIGN
    bg  = colors["bg"]
    pri = colors["pri"]
    acc = colors["acc"]
    txt = colors["txt"]

    # Top accent bar (thin chromic strip)
    line_h(slide, 0, 0, SLIDE_W, 0.10, acc)

    # Large faded page number — BOTTOM-RIGHT watermark (12% primary blended with bg)
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

    # ── Title row ────────────────────────────────────────────────────────────
    # Small page-index number: muted primary (like CSS opacity:0.45 on primary)
    num_color = blend(pri, bg, 0.45)
    num_w = 0.52
    tb_plain(slide, str(page_idx).zfill(2),
             MARGIN_LEFT, TITLE_T, num_w, TITLE_H,
             size=24, color=num_color, bold=True,
             v_anchor='b', fixed_h=True)

    # Main title: primary_color, bold, bottom-anchored so it kisses the underline
    tb_plain(slide, title,
             MARGIN_LEFT + num_w + 0.08, TITLE_T,
             CONTENT_W - num_w - 0.08 - 1.5, TITLE_H,
             size=30, color=pri, bold=True,
             v_anchor='b', fixed_h=True)

    # Underline immediately below title zone (accent color), length matches frontend 2.2in
    line_h(slide, MARGIN_LEFT, TITLE_T + TITLE_H + 0.02, 2.2, 0.04, acc)



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

    stat_elems  = [e for e in elements if _is_stat(e)]
    table_elems = [e for e in elements if e.get("type") == "table"]
    # ── 先渲染图片元素（right-column 或全宽）──────────────────────────────────
    img_elems  = [e for e in elements if e.get("type") == "image"]
    body_elems = [e for e in elements
                  if not _is_stat(e) and e.get("type") not in ("image", "table")] or [
        e for e in elements if e.get("type") not in ("image", "table")
    ]

    # 图片放右半列（宽度与 stat 右区相同，约 40% CONTENT_W）
    img_col_x = MARGIN_LEFT + CONTENT_W * 0.62
    img_col_w = CONTENT_W * 0.36
    for _img_elem in img_elems:
        _render_image_elem(slide, _img_elem, img_col_x, img_col_w, colors)

    left_w = CONTENT_W * 0.60 if (stat_elems or img_elems) else CONTENT_W

    # ── Body cards (left / full column) ── explode each list item into its own card ──
    lx = MARGIN_LEFT
    card_bg_body = _card_bg(bg, acc, dark)
    card_border  = _card_border(bg, dark)

    body_cards = []
    MAX_CARDS = 9  # hard cap to prevent overflow
    for elem in body_elems[:MAX_CARDS]:
        # Use raw content list to preserve \begin{cases} for OMML rendering
        raw_items = get_raw_content_list(elem)
        items_converted = get_content_list(elem)
        etype = elem.get("type", "text_block")
        if etype == "list" and len(raw_items) > 1:
            for raw_item, conv_item in zip(raw_items, items_converted):
                item_str  = str(raw_item)
                has_open  = _has_math_env_open(item_str)
                has_close = _has_math_env_close(item_str)

                # ── Tail-fragment stitch ──────────────────────────────────────────
                if not has_open and has_close and body_cards:
                    body_cards[-1] = body_cards[-1] + ' ' + item_str
                    continue

                # ── Math env / plain-text handling ───────────────────────────────
                bme = parse_block_math_env(item_str)
                if bme is None:
                    bme_legacy = parse_cases_env(item_str)
                    if bme_legacy is not None:
                        pre_l, _, post_l = bme_legacy
                        bme = ('cases', pre_l, None, post_l)
                if bme is not None:
                    pre_b  = bme[1] if isinstance(bme[1], str) else ''
                    post_b = bme[3] if isinstance(bme[3], str) else ''
                    is_pure_math = (not pre_b.strip() and not post_b.strip())
                    if is_pure_math and body_cards:
                        body_cards[-1] = body_cards[-1] + '\n' + item_str
                    else:
                        body_cards.append(item_str)
                else:
                    # Check for inline $...$ math — keep raw if it has LaTeX constructs
                    # This mirrors the exact logic in _render_col for two_column layout
                    use_raw = '$' in item_str and re.search(r'\\[A-Za-z]|[\^_]', item_str)
                    s_text = item_str if use_raw else str(conv_item)
                    s = re.sub(r'^[\-\*\+]\s+', '', s_text)
                    s = re.sub(r'^\d+\.\s+', '', s).strip()
                    if s:
                        body_cards.append(s)
        else:
            # Check if any raw item has a math block environment
            has_cases = any(_has_math_env_open(str(r)) for r in raw_items)
            has_inline = any('$' in str(r) and re.search(r'\\[A-Za-z]|[\^_]', str(r))
                             for r in raw_items)
            if has_cases or has_inline:
                body_cards.append("\n".join(str(r) for r in raw_items).strip())
            else:
                text = "\n".join(items_converted).strip()
                if text:
                    body_cards.append(text)

    # Trim cards to fit available space
    if len(body_cards) > MAX_CARDS:
        body_cards = body_cards[:MAX_CARDS]

    if body_cards:
        GAP = 0.06
        n_c = len(body_cards)
        text_w_est = left_w - 0.24
        nat_c = [_est_card_h(ct, text_w_est) for ct in body_cards]
        avail_c = avail_h - GAP * (n_c - 1)
        total_nat_c = sum(nat_c)
        # Math-env cards: keep exact natural height (OMML won't stretch)
        # Regular cards: expand proportionally up to 1.2x
        is_cases_card = [_has_math_env_open(ct) for ct in body_cards]
        if total_nat_c <= avail_c:
            fixed_h  = sum(n for n, ic in zip(nat_c, is_cases_card) if ic)
            flex_h   = sum(n for n, ic in zip(nat_c, is_cases_card) if not ic)
            flex_avail = avail_c - fixed_h
            factor_c = min(flex_avail / max(flex_h, 0.01), 1.2) if flex_h > 0 else 1.0
            heights_c = []
            for n, ic in zip(nat_c, is_cases_card):
                if ic:
                    heights_c.append(max(0.36, n))
                else:
                    heights_c.append(max(0.32, n * factor_c))
        else:
            scale_c = avail_c / max(total_nat_c, 0.01)
            heights_c = [max(0.28, h * scale_c) for h in nat_c]

        cy_m = CONTENT_T
        for i, card_text in enumerate(body_cards):
            each_c = heights_c[i]
            rect_rounded(slide, lx, cy_m, left_w - 0.05, each_c, card_bg_body, card_border)
            line_v(slide, lx, cy_m, each_c, 0.055, acc)
            clen = len(card_text)
            # More aggressive font scaling for dense slides
            if n_c >= 7:
                max_sz = 13
            elif n_c >= 5:
                max_sz = 15 if clen < 50 else 13
            else:
                max_sz = 17 if clen < 50 else (15 if clen < 100 else 14)
            sz = calc_safe_pt(each_c - 0.12, max(1, clen // 40), max_sz, 10, max_sz)
            add_rich_box(slide, card_text, lx + 0.14, cy_m + 0.06,
                         left_w - 0.24, each_c - 0.12, sz, txt, acc)
            cy_m += each_c + GAP
        content_end_y = cy_m
    else:
        content_end_y = CONTENT_T

    # ── Stat accent zone (right) ────────────────────────────────────────────────
    if stat_elems and not table_elems:
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

    # ── Table elements (full-width, renders after body cards) ────────────────────
    if table_elems:
        t_y = content_end_y + (0.08 if body_cards else 0)
        t_avail = SLIDE_H - t_y - 0.32
        if t_avail > 0.4:
            render_table_element(slide, table_elems[0], colors,
                                 MARGIN_LEFT, t_y, CONTENT_W)


def _render_image_elem(slide, elem: dict, col_x: float, col_w: float, colors: dict) -> None:
    """
    渲染 type=image 的 element。
    从 resolved 字段或数据库中查找图片路径，用 add_picture 插入幻灯片。
    此函数与 LaTeX/OMML 渲染管线完全隔离，不共享任何代码路径。
    """
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor

    acc = colors["acc"]
    txt = colors["txt"]

    # 1) 确定要插入的图片本地路径
    image_path = None
    resolved = elem.get("resolved")
    logger.info(f"[image_elem] rendering: alt={elem.get('alt','')[:30]} resolved={bool(resolved)}")

    if resolved and isinstance(resolved, dict):
        # 流式生成时，resolved 携带了 image_id，通过 image_id 找本地路径
        image_id = resolved.get("image_id", "")
        source   = resolved.get("source", "user")
        logger.info(f"[image_elem] image_id={image_id} source={source}")
        if image_id:
            try:
                from app.db.session import SessionLocal
                from app.models.image import UserImage, ImageLibrary
                _db = SessionLocal()
                try:
                    if source == "library":
                        rec = _db.query(ImageLibrary).filter(ImageLibrary.id == image_id).first()
                    else:  # source == "user"
                        rec = _db.query(UserImage).filter(UserImage.id == image_id).first()
                    if rec:
                        if rec.file_path and os.path.exists(rec.file_path):
                            image_path = rec.file_path
                            logger.info(f"[image_elem] file found: {image_path}")
                        else:
                            logger.warning(f"[image_elem] file missing: {rec.file_path}")
                    else:
                        logger.warning(f"[image_elem] DB record not found for {image_id}")
                finally:
                    _db.close()
            except Exception as _e:
                logger.warning(f"[image_elem] DB lookup failed: {_e}")
    else:
        logger.info(f"[image_elem] no resolved dict, will render placeholder")

    if image_path is None:
        # 没有找到图片：绘制灰色占位框
        logger.info(f"[image_elem] rendering placeholder (no image_path)")
        _render_image_placeholder(slide, elem, col_x, col_w, colors)
        return

    # 2) 用 PIL 读取图片真实像素宽高（避免 add_picture 拉伸后再算比例的错误）
    try:
        from PIL import Image as _PilImg
        with _PilImg.open(image_path) as _im:
            real_w_px, real_h_px = _im.size
    except Exception as _pe:
        logger.warning(f"[image_elem] PIL size read failed: {_pe}, using 1:1")
        real_w_px, real_h_px = 1, 1

    aspect = real_w_px / real_h_px  # > 1: 横图; < 1: 竖图

    # 3) 根据宽高比决定放置区域
    #    横图/方图 (aspect >= 0.75) → 右列
    #    竖图 (aspect < 0.75)      → 底部横幅
    if aspect >= 0.75:
        # ── 右列放置 ──
        area_x = col_x + 0.08
        area_y = CONTENT_T + 0.05
        area_w = col_w - 0.16          # 可用宽度
        area_h = SLIDE_H - area_y - 0.45  # 可用高度

        # contain-fit: 保持比例缩放至 area_w × area_h 内
        if area_w / area_h >= aspect:
            # 高度受限
            fit_h = area_h
            fit_w = fit_h * aspect
        else:
            # 宽度受限
            fit_w = area_w
            fit_h = fit_w / aspect

        # 居中
        off_x = area_x + (area_w - fit_w) / 2.0
        off_y = area_y + (area_h - fit_h) / 2.0
    else:
        # ── 底部横幅放置 ──
        area_x = MARGIN_LEFT + 0.1
        area_w = CONTENT_W - 0.2
        area_h = min(3.5, CONTENT_H * 0.55)   # 高度不超过内容区的 55%
        area_y = SLIDE_H - area_h - 0.42       # 底部留 caption 空间

        if area_w / area_h >= aspect:
            fit_h = area_h
            fit_w = fit_h * aspect
        else:
            fit_w = area_w
            fit_h = fit_w / aspect

        # 水平居中
        off_x = MARGIN_LEFT + (CONTENT_W - fit_w) / 2.0
        off_y = area_y

    try:
        from pptx.util import Emu
        pic = slide.shapes.add_picture(
            image_path,
            Inches(off_x), Inches(off_y),
            Inches(fit_w), Inches(fit_h)   # 已按比例计算，直接传入
        )

        # 4) 添加 alt 图注（底部小字）
        alt_text = elem.get("alt", "")
        if alt_text:
            cap_y = min(Inches(off_y + fit_h + 0.04), Inches(SLIDE_H - 0.35))
            alt_box = slide.shapes.add_textbox(
                Inches(col_x + 0.05 if aspect >= 0.75 else MARGIN_LEFT),
                cap_y,
                Inches(col_w - 0.1 if aspect >= 0.75 else CONTENT_W),
                Inches(0.30)
            )
            tf = alt_box.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            from pptx.enum.text import PP_ALIGN
            p.alignment = PP_ALIGN.CENTER
            run = p.add_run()
            run.text = alt_text
            run.font.size = Pt(8)
            run.font.color.rgb = hex2rgb(txt)
            run.font.italic = True

    except Exception as _e:
        logger.warning(f"[image_elem] add_picture failed: {_e}")
        _render_image_placeholder(slide, elem, col_x, col_w, colors)


def _render_image_placeholder(slide, elem: dict, col_x: float, col_w: float, colors: dict) -> None:
    """当图片不可用时渲染灰色占位框。"""
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    bg  = colors["bg"]
    txt = colors["txt"]
    acc = colors["acc"]

    ph_x, ph_y = col_x + 0.05, CONTENT_T + 0.1
    ph_w = col_w - 0.15
    ph_h = SLIDE_H - ph_y - 0.5

    # 灰色矩形
    from pptx.util import Emu
    placeholder_color = blend(RGBColor(0x80, 0x80, 0x80), hex2rgb(bg), 0.3)
    rect_rounded(slide, ph_x, ph_y, ph_w, ph_h, placeholder_color, hex2rgb(bg))

    # 📷 图标 + query 文字
    query_text = f"📷\n{elem.get('query', '图片检索无匹配')}"
    from pptx.enum.text import PP_ALIGN
    add_rich_box(slide, query_text, ph_x + 0.1, ph_y + ph_h * 0.3,
                 ph_w - 0.2, ph_h * 0.4, 12, txt, acc, align=PP_ALIGN.CENTER)


# ──────────────────────────────────────────────
# Table element renderer
# ──────────────────────────────────────────────

def render_table_element(slide, elem: dict, colors: dict,
                         x: float, y: float, w: float) -> float:
    """
    Render a type=table element as a native python-pptx table.
    Returns the height consumed in inches.

    elem must contain:
      headers : list[str]       — column header labels
      rows    : list[list[str]] — data rows (each row is a list of cell strings)
    LaTeX formulas in cells are converted to Unicode via convert_latex().
    """
    from pptx.enum.text import PP_ALIGN

    headers   = elem.get("headers") or []
    rows_data = elem.get("rows") or []
    if not isinstance(headers, list):
        headers = []
    if not isinstance(rows_data, list):
        rows_data = []
    rows_data = [r for r in rows_data if isinstance(r, (list, tuple)) and r]

    n_cols = max(
        len(headers),
        max((len(r) for r in rows_data), default=0),
        1,
    )
    has_header  = bool(headers)
    n_data_rows = len(rows_data)
    n_rows      = n_data_rows + (1 if has_header else 0)

    if n_rows == 0:
        return 0.0

    bg   = colors["bg"]
    acc  = colors["acc"]
    txt  = colors["txt"]
    pri  = colors["pri"]
    dark = _is_dark(colors)

    # Header text color based on accent luminance
    acc_luma = (0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]) / 255.0
    hdr_txt  = RGBColor(0xFF, 0xFF, 0xFF) if acc_luma < 0.55 else RGBColor(0x1F, 0x2D, 0x3D)

    # Alternating row background colors
    even_bg = blend(pri, bg, 0.12) if dark else blend(RGBColor(0xCC, 0xCC, 0xFF), bg, 0.05)
    odd_bg  = bg

    # Compute heights, cap at slide bottom
    HDR_H   = 0.44
    DATA_H  = 0.40
    avail   = SLIDE_H - y - 0.32
    nat_h   = HDR_H * (1 if has_header else 0) + DATA_H * n_data_rows
    total_h = min(nat_h, avail)
    if total_h < 0.3:
        return 0.0

    scale = total_h / nat_h if nat_h > 0 else 1.0

    # Create python-pptx table shape
    tbl_shape = slide.shapes.add_table(
        n_rows, n_cols,
        Inches(x), Inches(y),
        Inches(w), Inches(total_h),
    )
    tbl = tbl_shape.table

    def _fill(cell, text: str, bold: bool, size: int,
               fg: "RGBColor", bg_c: "RGBColor", align):
        """Style one table cell."""
        f = cell.fill
        f.solid()
        f.fore_color.rgb = bg_c
        tf = cell.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = align
        run = p.runs[0] if p.runs else p.add_run()
        run.text = convert_latex(str(text)) if text else ""
        run.font.bold  = bold
        run.font.size  = Pt(size)
        run.font.color.rgb = fg

    # Header row
    row_off = 0
    if has_header:
        for ci in range(n_cols):
            hdr_text = headers[ci] if ci < len(headers) else ""
            align    = PP_ALIGN.LEFT if ci == 0 else PP_ALIGN.CENTER
            _fill(tbl.cell(0, ci), hdr_text, True, 13, hdr_txt, acc, align)
        row_off = 1

    # Data rows
    for ri, row in enumerate(rows_data):
        row_bg = even_bg if ri % 2 == 0 else odd_bg
        for ci in range(n_cols):
            cell_text = row[ci] if ci < len(row) else ""
            align_    = PP_ALIGN.LEFT if ci == 0 else PP_ALIGN.CENTER
            _fill(tbl.cell(row_off + ri, ci), cell_text,
                  ci == 0, 12, txt, row_bg, align_)

    return total_h


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

    card_bg_normal = _card_bg(bg, acc, dark)
    card_border    = _card_border(bg, dark)
    card_bg_stat   = blend(acc, bg, 0.18) if dark else blend(acc, bg, 0.13)

    def _render_col(elems, col_x):
        # ── Image elements: render first, skip in card loop ──────────────────
        text_elems = []
        for elem in elems:
            if elem.get("type") == "image":
                _render_image_elem(slide, elem, col_x, half_w, colors)
            else:
                text_elems.append(elem)
        elems = text_elems

        # Explode: each list sub-item becomes its own individual card.
        # Use raw content for math preservation (mirrors render_minimal_list logic).
        cards = []  # list of {"text": str, "stat": bool}
        for elem in elems:
            raw_items   = get_raw_content_list(elem)
            conv_items  = get_content_list(elem)
            etype = elem.get("type", "text_block")
            if _is_stat(elem):
                cards.append({"text": "\n".join(conv_items), "stat": True})
            elif etype == "list" and len(raw_items) > 1:
                for raw_item, conv_item in zip(raw_items, conv_items):
                    item_str  = str(raw_item)
                    has_open  = _has_math_env_open(item_str)
                    has_close = _has_math_env_close(item_str)

                    # Tail-fragment stitch (close-only env fragment joins prev card)
                    if not has_open and has_close and cards:
                        cards[-1]["text"] = cards[-1]["text"] + ' ' + item_str
                        continue

                    bme = parse_block_math_env(item_str)
                    if bme is None:
                        bme_legacy = parse_cases_env(item_str)
                        if bme_legacy is not None:
                            pre_l, _, post_l = bme_legacy
                            bme = ('cases', pre_l, None, post_l)
                    if bme is not None:
                        pre_b  = bme[1] if isinstance(bme[1], str) else ''
                        post_b = bme[3] if isinstance(bme[3], str) else ''
                        is_pure_math = (not pre_b.strip() and not post_b.strip())
                        if is_pure_math and cards:
                            cards[-1]["text"] = cards[-1]["text"] + '\n' + item_str
                        else:
                            cards.append({"text": item_str, "stat": False})
                    else:
                        # Check for inline $...$ math — keep raw if it has LaTeX
                        use_raw = '$' in item_str and re.search(r'\\[A-Za-z]|[\^_]', item_str)
                        s_text = item_str if use_raw else str(conv_item)
                        s_text = re.sub(r'^[\-\*\+]\s+', '', s_text)
                        s_text = re.sub(r'^\d+\.\s+', '', s_text).strip()
                        if s_text:
                            cards.append({"text": s_text, "stat": False})
            else:
                # Single-item or non-list: use raw if any item has math
                has_cases = any(_has_math_env_open(str(r)) for r in raw_items)
                has_inline = any('$' in str(r) and re.search(r'\\[A-Za-z]|[\^_]', str(r))
                                 for r in raw_items)
                if has_cases or has_inline:
                    text = "\n".join(str(r) for r in raw_items).strip()
                else:
                    text = "\n".join(conv_items).strip()
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
            rect_rounded(slide, col_x, cy, half_w - 0.05, each_h, cb, card_border)
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
    card_bg     = _card_bg(bg, acc, dark)
    card_border = _card_border(bg, dark)

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

        rect_rounded(slide, card_x, card_y, card_w, card_h, card_bg, card_border)
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

    # ── 图片元素单独渲染，不进入文字卡循环 ────────────────────────────────────
    img_elems  = [e for e in elements if e.get("type") == "image"]
    text_elems = [e for e in elements if e.get("type") != "image"]
    has_img    = bool(img_elems)

    # 图片放右列（40% 宽），文字占左 58%（有图时）
    img_col_x = MARGIN_LEFT + CONTENT_W * 0.62
    img_col_w = CONTENT_W * 0.36
    txt_col_w = CONTENT_W * 0.60 if has_img else CONTENT_W

    for _img_elem in img_elems:
        _render_image_elem(slide, _img_elem, img_col_x, img_col_w, colors)

    each_h = avail_h / max(len(text_elems), 1)

    for i, elem in enumerate(text_elems):
        items = get_content_list(elem)
        etype = elem.get("type", "text_block")
        is_acc = elem.get("is_accent", False) or etype in ("huge_number", "stat")
        cy = CONTENT_T + i * each_h

        if is_acc and items and len(str(items[0])) <= 10:
            add_rich_box(slide, items[0] if items else "", MARGIN_LEFT, cy, txt_col_w,
                         each_h - 0.05, min(52, max(24, int(each_h * 28))),
                         acc, acc, bold=True, align=PP_ALIGN.CENTER)
        elif etype == "list" and len(items) > 1:
            add_list_box(slide, items, MARGIN_LEFT, cy, txt_col_w, each_h - 0.05, 15, txt, acc)
        else:
            sz = calc_safe_pt(each_h, max(len(items), 1), 15, 10, 18)
            add_rich_box(slide, "\n".join(items), MARGIN_LEFT, cy, txt_col_w,
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
