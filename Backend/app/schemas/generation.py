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

class ElementModel(BaseModel):
    element_id: str
    type: str # text_block, image
    position: str
    content: Optional[List[str]] = None
    url: Optional[str] = None
    alt: Optional[str] = None

class SlideModel(BaseModel):
    page_index: int
    layout_type: str # cover, standard, two_column, image_gallery
    title: str
    speaker_notes: str
    elements: List[ElementModel]

class CoursewarePreviewResponse(BaseModel):
    ppt_data: List[SlideModel]
    word_markdown: str

class IterateRequest(BaseModel):
    target_type: str # ppt
    page_index: int
    instruction: str
