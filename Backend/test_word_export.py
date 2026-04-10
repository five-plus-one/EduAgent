"""Quick validation: generate a DOCX and check it has OMML but NO DrawingML."""
import sys, os
sys.path.insert(0, '.')
os.environ.setdefault('OPENAI_API_KEY', 'dummy')
os.environ.setdefault('OPENAI_API_BASE', 'https://dummy')
os.environ.setdefault('LLM_MODEL', 'dummy')

from app.services.word_exporter import markdown_to_docx

md = r"""
# 数学公式测试

行内公式：$E = mc^2$

行内复杂公式：$\frac{d}{dx}\sin x = \cos x$

块级公式：

$$
i\hbar\frac{\partial\psi}{\partial t} = \hat{H}\psi
$$

矩阵：

$$\begin{pmatrix} a & b \\ c & d \end{pmatrix}$$

列表含公式：

- 万有引力 $F = G\frac{m_1 m_2}{r^2}$
- 欧拉公式 $e^{i\pi} + 1 = 0$
- 不确定原理 $\Delta x \cdot \Delta p \geq \hbar/2$
"""

out = markdown_to_docx(md, 'test_clean.docx', '数学验证')
print(f'Generated: {out}')

import zipfile
with zipfile.ZipFile(out) as z:
    xml = z.read('word/document.xml').decode('utf-8')

has_drawingml = 'schemas.openxmlformats.org/drawingml' in xml
has_omml      = 'm:oMath' in xml
omml_count    = xml.count('<m:oMath')
mathpara_count = xml.count('<m:oMathPara')

print(f'DrawingML present (MUST be False): {has_drawingml}')
print(f'OMML present      (MUST be True):  {has_omml}')
print(f'oMath elements:    {omml_count}')
print(f'oMathPara blocks:  {mathpara_count}')

if has_drawingml:
    print('FAIL: DrawingML detected - Word will corrupt the file')
    sys.exit(1)
if not has_omml:
    print('FAIL: No OMML math found')
    sys.exit(1)
print('PASS: DOCX is valid - no DrawingML contamination')
