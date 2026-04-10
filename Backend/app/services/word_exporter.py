# coding: utf-8
"""
word_exporter.py — 将 word_markdown（Markdown 格式讲义）导出为标准 .docx 文件。

支持：
  - 标题 (# ~ ####)、段落、有序/无序列表、加粗/斜体/代码行内格式、水平线
  - 行内 LaTeX 公式：$...$  $$...$$ → OMML（Word 原生数学对象，可编辑）
  - 块级 LaTeX 公式：多行 $$...$$  \\begin{equation/align/matrix...}...\\end{...} → 居中 oMathPara
  - 复用 ppt_exporter 中的 _append_omml_for_expr 统一渲染逻辑，与 PPT 导出一致
"""
import re
import os
import logging
from lxml import etree
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

logger = logging.getLogger(__name__)

# ── OMML 数学命名空间（与 ppt_exporter 完全相同）────────────────────────────
_NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'


# ──────────────────────────────────────────────
# 惰性导入 ppt_exporter 中的公式辅助函数
# ──────────────────────────────────────────────

def _ppt_math():
    """懒导入避免循环依赖，返回四个公式辅助函数。"""
    from app.services.ppt_exporter import (
        _append_omml_for_expr,
        _has_math_env_open,
        _has_math_env_close,
        parse_block_math_env,
    )
    return _append_omml_for_expr, _has_math_env_open, _has_math_env_close, parse_block_math_env


# ──────────────────────────────────────────────
# 辅助：清洗 LaTeX 中的 XML 非法控制字符
# ──────────────────────────────────────────────

def _sanitize_latex(s: str) -> str:
    """去除 XML 不兼容的控制字符（null、退格等），保留换行和制表。"""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', s)


# ──────────────────────────────────────────────
# OMML 插入辅助
# ──────────────────────────────────────────────

def _add_inline_math_run(para, latex: str) -> bool:
    """
    在 python-docx 段落当前位置后追加内联 <m:oMath>。
    成功返回 True；失败降级为纯文本，返回 False。
    """
    latex = _sanitize_latex(latex.strip())
    if not latex:
        return False
    try:
        _append_omml_for_expr, *_ = _ppt_math()
        m = _NS_M
        omath = etree.Element(f'{{{m}}}oMath', nsmap={'m': m})
        _append_omml_for_expr(omath, latex, m, '')
        para._p.append(omath)
        return True
    except Exception as exc:
        logger.warning(f'[word_math] inline OMML failed ({latex[:30]!r}): {exc}')
        return False


def _add_block_math_para(doc: Document, latex: str) -> bool:
    """
    向文档追加居中块级数学段落（<m:oMathPara>）。
    成功返回 True；失败降级为普通文本段落，返回 False。
    """
    latex = _sanitize_latex(latex.strip())
    if not latex:
        return False
    try:
        _append_omml_for_expr, *_ = _ppt_math()
        m = _NS_M
        para = doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p = para._p

        omath_para = etree.SubElement(p, f'{{{m}}}oMathPara')
        ompr = etree.SubElement(omath_para, f'{{{m}}}oMathParaPr')
        jc = etree.SubElement(ompr, f'{{{m}}}jc')
        jc.set(f'{{{m}}}val', 'center')
        omath = etree.SubElement(omath_para, f'{{{m}}}oMath')
        _append_omml_for_expr(omath, latex, m, '')
        return True
    except Exception as exc:
        logger.warning(f'[word_math] block OMML failed ({latex[:30]!r}): {exc}')
        doc.add_paragraph(_sanitize_latex(latex))   # 降级
        return False


# ──────────────────────────────────────────────
# 行内 Markdown + 公式解析
# ──────────────────────────────────────────────

# 匹配优先级：**bold** / *italic* / `code` / $$display$$ / $inline$
_INLINE_PATTERN = re.compile(
    r'\*\*(.+?)\*\*'          # group 1: bold content
    r'|\*(.+?)\*'             # group 2: italic content
    r'|`(.+?)`'               # group 3: inline code
    r'|\$\$(.+?)\$\$'         # group 4: display math (single-line inline)
    r'|\$([^$\n]+?)\$',       # group 5: inline math
    re.DOTALL
)


def _parse_inline(paragraph, text: str) -> None:
    """
    解析单行文本写入 python-docx 段落。
    支持 **bold**、*italic*、`code`、$...$、$$...$$ (单行)。
    """
    last = 0
    for m in _INLINE_PATTERN.finditer(text):
        # 普通文本段
        if m.start() > last:
            paragraph.add_run(text[last:m.start()])
        b, it, code, disp, inl = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        if b is not None:
            r = paragraph.add_run(b); r.bold = True
        elif it is not None:
            r = paragraph.add_run(it); r.italic = True
        elif code is not None:
            r = paragraph.add_run(code)
            r.font.name = 'Courier New'; r.font.size = Pt(10)
        elif disp is not None:
            if not _add_inline_math_run(paragraph, disp):
                paragraph.add_run(disp)
        elif inl is not None:
            if not _add_inline_math_run(paragraph, inl):
                paragraph.add_run(inl)
        last = m.end()
    if last < len(text):
        paragraph.add_run(text[last:])


# ──────────────────────────────────────────────
# 文档结构辅助
# ──────────────────────────────────────────────

def _set_heading_style(paragraph, level: int) -> None:
    style_map = {1: 'Heading 1', 2: 'Heading 2', 3: 'Heading 3', 4: 'Heading 4'}
    try:
        paragraph.style = style_map.get(level, 'Heading 3')
    except Exception:
        pass


def _add_horizontal_rule(doc: Document) -> None:
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'CCCCCC')
    pBdr.append(bottom)
    pPr.append(pBdr)


# ──────────────────────────────────────────────
# 主函数
# ──────────────────────────────────────────────

def markdown_to_docx(markdown_text: str, output_path: str, title: str = '课件讲义') -> str:
    """
    将 Markdown 格式的讲义文本转换为 .docx 文件。

    - 完整 LaTeX 公式渲染：行内 $...$、块级 $$...$$、\\begin{env}...\\end{env}
      均转换为 Word 原生 OMML 数学对象（可在 Word 中直接编辑）
    - 标准 Markdown 格式（标题/列表/行内样式/分割线）

    返回 output_path。
    """
    _, _has_env_open, _has_env_close, _ = _ppt_math()

    doc = Document()

    # ── 页面设置（A4）──
    section = doc.sections[0]
    section.page_width    = Cm(21.0)
    section.page_height   = Cm(29.7)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)

    # ── 文档标题 ──
    heading = doc.add_heading(title, 0)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

    lines = markdown_text.splitlines()
    i = 0
    in_list = False

    # 块级数学状态机
    in_display_math: bool = False       # 跨行 $$ ... $$
    display_math_buf: list[str] = []
    in_block_env: bool = False          # \begin{env}...\end{env}
    block_env_buf: list[str] = []

    while i < len(lines):
        line     = lines[i]
        stripped = line.strip()

        # ── 1. 累积 \begin{env}...\end{env} ────────────────────────────────
        if not in_block_env and _has_env_open(stripped):
            in_block_env = True
            block_env_buf = [stripped]
            if _has_env_close(stripped):          # 单行完整
                _add_block_math_para(doc, '\n'.join(block_env_buf))
                in_block_env = False
                block_env_buf = []
            in_list = False
            i += 1
            continue

        if in_block_env:
            block_env_buf.append(stripped)
            if _has_env_close(stripped):
                _add_block_math_para(doc, '\n'.join(block_env_buf))
                in_block_env = False
                block_env_buf = []
            i += 1
            continue

        # ── 2. 块级 $$..$$ ─────────────────────────────────────────────────
        # 单行自闭合：$$expr$$
        m_single_disp = re.match(r'^\$\$(.+)\$\$$', stripped)
        if m_single_disp:
            _add_block_math_para(doc, m_single_disp.group(1))
            in_list = False
            i += 1
            continue

        # 开/关 $$（独立行）
        if stripped == '$$':
            if not in_display_math:
                in_display_math = True
                display_math_buf = []
            else:
                _add_block_math_para(doc, '\n'.join(display_math_buf))
                in_display_math = False
                display_math_buf = []
            in_list = False
            i += 1
            continue

        if in_display_math:
            display_math_buf.append(stripped)
            i += 1
            continue

        # ── 3. 空行 ────────────────────────────────────────────────────────
        if not stripped:
            in_list = False
            i += 1
            continue

        # ── 4. 标题 ────────────────────────────────────────────────────────
        m_h = re.match(r'^(#{1,4})\s+(.+)$', line)
        if m_h:
            level = len(m_h.group(1))
            p = doc.add_paragraph()
            _set_heading_style(p, level)
            _parse_inline(p, m_h.group(2))
            in_list = False
            i += 1
            continue

        # ── 5. 水平线 ───────────────────────────────────────────────────────
        if re.match(r'^[-]{3,}$', stripped) or re.match(r'^[=]{3,}$', stripped):
            _add_horizontal_rule(doc)
            in_list = False
            i += 1
            continue

        # ── 6. 无序列表 ─────────────────────────────────────────────────────
        m_ul = re.match(r'^(?:\s*)[-*+]\s+(.+)$', line)
        if m_ul:
            p = doc.add_paragraph(style='List Bullet')
            _parse_inline(p, m_ul.group(1))
            in_list = True
            i += 1
            continue

        # ── 7. 有序列表 ─────────────────────────────────────────────────────
        m_ol = re.match(r'^(?:\s*)\d+\.\s+(.+)$', line)
        if m_ol:
            p = doc.add_paragraph(style='List Number')
            _parse_inline(p, m_ol.group(1))
            in_list = True
            i += 1
            continue

        # ── 8. 普通段落（含行内公式）──────────────────────────────────────
        in_list = False
        p = doc.add_paragraph()
        _parse_inline(p, stripped)
        i += 1

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    doc.save(output_path)
    logger.info(f'[word_exporter] saved: {output_path}')
    return output_path
