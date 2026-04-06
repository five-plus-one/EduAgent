from pydantic import BaseModel, Field

class GenerateFullPPT(BaseModel):
    """当用户明确要求从头智能生成课件大纲或整套PPT、或者说'生成讲义'、'写大纲'时调用。绝不要直接将PPT内容大纲在对话框里输出，必须调用此工具！"""
    mode: str = Field(description="生成深度模式，通常为 'depth'")

class UpdateSlide(BaseModel):
    """修改某一特定页PPT的内容（如标题、正文文本）。必须准确指定页码和新内容。当用户说'把第三页标题改一下'时使用。"""
    page_index: int = Field(description="幻灯片页码（从1开始）", ge=1)
    new_content: str = Field(description="整页需要替换或更新的全新内容段落（可以直接写大纲或文段）")

class AddSlide(BaseModel):
    """在指定位置新增一页幻灯片。参数格式与 UpdateSlide 完全一致，必须传入结构化 title 和 new_elements。"""
    insert_after_index: int = Field(description="在哪一页之后插入（从1开始）。如果是0则插入在最前。")
    title: str = Field(description="新幻灯片的标题")
    new_elements: list = Field(description="页面内部元素数组，格式与 UpdateSlide.new_elements 完全相同")

class DeleteSlide(BaseModel):
    """删除某一特定页的幻灯片。当用户说'删掉第四页'时使用。"""
    page_index: int = Field(description="要删除的幻灯片页码（从1开始）", ge=1)
