import collections 
import collections.abc
from pptx import Presentation
from pptx.util import Inches
from lxml import etree

prs = Presentation()
slide = prs.slides.add_slide(prs.slide_layouts[6]) # blank layout
tb = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(2))
p = tb.text_frame.paragraphs[0]
p.text = "Here is an equation: "

# OMML for quadratic formula or a cases block
omml_str = """
<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <m:f>
    <m:fPr>
      <m:ctrlPr>
        <a:rPr i="1"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:rPr>
      </m:ctrlPr>
    </m:fPr>
    <m:num>
      <m:r><m:t>x</m:t></m:r>
    </m:num>
    <m:den>
      <m:r><m:t>y</m:t></m:r>
    </m:den>
  </m:f>
</m:oMath>
"""
omml_elem = etree.fromstring(omml_str)
p._p.append(omml_elem)

try:
    prs.save("test_equation.pptx")
    print("Successfully saved test_equation.pptx")
except Exception as e:
    print("Error saving:", e)
