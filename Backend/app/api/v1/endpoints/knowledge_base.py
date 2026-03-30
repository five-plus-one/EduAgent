import os
import shutil
import uuid
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.document import Document
from app.services.document_processor_task import process_global_document_task
from app.services.vector_store import delete_document_vectors

router = APIRouter()
UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "global")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/documents")
async def upload_global_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    metadata_json: str = Form(default="{}"),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    try:
        meta = json.loads(metadata_json)
    except Exception:
        meta = {}
        
    doc_id = "doc_" + uuid.uuid4().hex[:8]
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    safe_filename = f"{doc_id}{ext}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    new_doc = Document(
        id=doc_id,
        filename=file.filename,
        file_path=file_path,
        status="pending",
        metadata_json=meta
    )
    db.add(new_doc)
    db.commit()
    
    # Send to background task for parsing and embedding
    background_tasks.add_task(process_global_document_task, doc_id, current_user.id)
    
    return {"document_id": doc_id, "status": "processing"}

@router.get("/documents")
def list_global_documents(
    page: int = 1,
    size: int = 20,
    status: str = None,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    query = db.query(Document)
    if status:
        query = query.filter(Document.status == status)
        
    total = query.count()
    docs = query.order_by(Document.created_at.desc()).offset((page - 1) * size).limit(size).all()
    
    items = []
    for d in docs:
        items.append({
            "document_id": d.id,
            "filename": d.filename,
            "status": d.status,
            "progress": d.progress,
            "summary": d.summary,
            "metadata": d.metadata_json,
            "created_at": d.created_at
        })
        
    return {
        "total": total,
        "page": page,
        "size": size,
        "has_more": (page * size) < total,
        "items": items
    }

@router.put("/documents/{doc_id}")
def update_document_metadata(
    doc_id: str,
    metadata_json: dict,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Replace metadata dictionary
    doc.metadata_json = metadata_json
    db.commit()
    return None

@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Cleanup vectors
    delete_document_vectors(doc_id)
    
    # Cleanup file
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
        
    db.delete(doc)
    db.commit()
    return None
