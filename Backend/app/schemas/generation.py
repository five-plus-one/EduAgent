from typing import List, Optional
from pydantic import BaseModel

class GenerateRequest(BaseModel):
    selected_file_ids: List[str] = []
    generation_mode: str = "depth"

class TaskResponse(BaseModel):
    task_id: str
    status: str

class TaskStatusResponse(BaseModel):
    status: str
    stage: Optional[str] = None
    progress: int
    download_urls: Optional[dict] = None
    filename: Optional[str] = None
    error: Optional[str] = None

class ElementModel(BaseModel):
    """
    PPT element — 对应一页中的一个内容块。
    extra='allow' 保证 table 的 headers/rows、timeline_item 的 time 等
    类型专属字段不被 Pydantic 序列化时裁掉。
    """
    model_config = {"extra": "allow"}

    element_id: Optional[str] = ""
    type: str = "text_block"        # text_block, list, image, huge_number, stat, table, timeline_item
    position: Optional[str] = "left"
    content: Optional[List] = None  # List[str] 对普通元素；table 元素为 []
    is_accent: Optional[bool] = False
    url: Optional[str] = None
    alt: Optional[str] = None
    query: Optional[str] = None           # 图片搜索词（LLM 生成）
    resolved: Optional[dict] = None       # 图片解析结果 {image_id, preview_url, source, similarity}
    # table element 专属字段
    headers: Optional[List[str]] = None   # 表头列名
    rows: Optional[List[List]] = None     # 数据行（每行是 List[str]）
    # timeline_item 专属字段
    time: Optional[str] = None

class SlideModel(BaseModel):
    model_config = {"extra": "allow"}   # 保留所有未知字段（如 layout_type 别名等）

    page_index: int
    layout_type: str # cover, standard, two_column, image_gallery
    title: str
    speaker_notes: Optional[str] = ""
    elements: Optional[List[ElementModel]] = []

class CoursewarePreviewResponse(BaseModel):
    ppt_data: List[SlideModel]
    word_markdown: str
    theme: Optional[dict] = None

class IterateRequest(BaseModel):
    target_type: str # ppt
    page_index: int
    instruction: str
