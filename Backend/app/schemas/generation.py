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
    element_id: Optional[str] = ""
    type: str = "text_block"        # text_block, list, image, huge_number, stat
    position: Optional[str] = "left"
    content: Optional[List[str]] = None
    is_accent: Optional[bool] = False
    url: Optional[str] = None
    alt: Optional[str] = None

class SlideModel(BaseModel):
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
