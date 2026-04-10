# coding: utf-8
"""
word_exporter.py — 将 word_markdown（Markdown 格式讲义）导出为标准 .docx 文件。
使用 python-docx 生成真实 Word 文档，支持标题、段落、列表、加粗、斜体、分割线。
"""
import re
import os
import logging
from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

logger = logging.getLogger(__name__)


def _set_heading_style(paragraph, level: int):
    """设置标题样式（级别 1-4）。"""
    style_map = {1: "Heading 1", 2: "Heading 2", 3: "Heading 3", 4: "Heading 4"}
    style_name = style_map.get(level, "Heading 3")
    try:
        paragraph.style = style_name
    except Exception:
        pass  # 某些模板可能缺少样式，忽略


def _add_horizontal_rule(doc: Document):
    """在文档末尾添加水平分隔线。"""
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "CCCCCC")
    pBdr.append(bottom)
    pPr.append(pBdr)


def _apply_inline(run, text: str):
    """解析行内 **bold** 和 *italic*，为 run 设置文本。"""
    run.text = text  # 最终回调设置纯文本（调用方已拆分 run）


def _parse_inline(paragraph, text: str):
    """
    解析行内标记并添加多个 run（支持 **bold**、*italic*、`code`）。
    """
    # 支持 **bold**, *italic*, `code`
    pattern = re.compile(r"(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)")
    last = 0
    for m in pattern.finditer(text):
        # 普通文本
        if m.start() > last:
            paragraph.add_run(text[last:m.start()])
        if m.group(1).startswith("**"):
            r = paragraph.add_run(m.group(2))
            r.bold = True
        elif m.group(1).startswith("*"):
            r = paragraph.add_run(m.group(3))
            r.italic = True
        else:  # `code`
            r = paragraph.add_run(m.group(4))
            r.font.name = "Courier New"
            r.font.size = Pt(10)
        last = m.end()
    if last < len(text):
        paragraph.add_run(text[last:])


def markdown_to_docx(markdown_text: str, output_path: str, title: str = "课件讲义") -> str:
    """
    将 markdown_text 转换为 .docx 文件并保存到 output_path。
    返回 output_path。
    """
    doc = Document()

    # ── 页面设置 ──
    section = doc.sections[0]
    section.page_width  = Cm(21.0)   # A4
    section.page_height = Cm(29.7)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)
    section.top_margin    = Cm(2.5)
    section.bottom_margin = Cm(2.5)

    # ── 标题页首行 ──
    heading = doc.add_heading(title, 0)
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER

    lines = markdown_text.splitlines()
    i = 0
    in_list = False  # 跟踪是否在列表中

    while i < len(lines):
        line = lines[i]

        # 跳过空行
        if not line.strip():
            in_list = False
            i += 1
            continue

        # ── 标题 ──
        m_h = re.match(r"^(#{1,4})\s+(.+)$", line)
        if m_h:
            level = len(m_h.group(1))
            p = doc.add_paragraph()
            _set_heading_style(p, level)
            _parse_inline(p, m_h.group(2))
            in_list = False
            i += 1
            continue

        # ── 水平线 ──
        if re.match(r"^[-]{3,}$", line.strip()) or re.match(r"^[=]{3,}$", line.strip()):
            _add_horizontal_rule(doc)
            in_list = False
            i += 1
            continue

        # ── 无序列表 ──
        m_ul = re.match(r"^(?:\s*)[-*+]\s+(.+)$", line)
        if m_ul:
            p = doc.add_paragraph(style="List Bullet")
            _parse_inline(p, m_ul.group(1))
            in_list = True
            i += 1
            continue

        # ── 有序列表 ──
        m_ol = re.match(r"^(?:\s*)\d+\.\s+(.+)$", line)
        if m_ol:
            p = doc.add_paragraph(style="List Number")
            _parse_inline(p, m_ol.group(1))
            in_list = True
            i += 1
            continue

        # ── 普通段落 ──
        in_list = False
        p = doc.add_paragraph()
        _parse_inline(p, line.strip())
        i += 1

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    doc.save(output_path)
    logger.info(f"[word_exporter] saved: {output_path}")
    return output_path
