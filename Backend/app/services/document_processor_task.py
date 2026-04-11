import os
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.document import Document
from app.models.session import SessionFile
from app.services.document_parser import extract_text_from_file
from app.services.vector_store import store_document_vectors

def process_global_document_task(document_id: str, uploader_id: str):
    db: Session = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        db.close()
        return
        
    try:
        doc.status = "processing"
        doc.progress = 10
        db.commit()
        
        # 1. Extract text
        text = extract_text_from_file(doc.file_path, doc.filename)
        doc.progress = 40
        db.commit()
        
        # 2. Vectorize and store
        metadata = doc.metadata_json or {}
        metadata.update({"uploader_id": uploader_id, "filename": doc.filename, "source": "global"})
        store_document_vectors(text, document_id=doc.id, metadata=metadata)
        
        doc.progress = 100
        doc.status = "completed"
        doc.summary = f"Total length: {len(text)} characters extracted."
        db.commit()
    except Exception as e:
        doc.status = "failed"
        doc.summary = str(e)
        db.commit()
    finally:
        db.close()

def process_session_file_task(session_file_id: str):
    db: Session = SessionLocal()
    sf = db.query(SessionFile).filter(SessionFile.id == session_file_id).first()
    if not sf:
        db.close()
        return
        
    try:
        sf.status = "processing"
        sf.progress = 10
        db.commit()
        
        text = extract_text_from_file(sf.file_path, sf.filename)
        sf.progress = 50
        db.commit()
        
        # Vectorize and attribute to session file ID
        store_document_vectors(text, document_id=sf.id, metadata={"session_id": sf.session_id, "filename": sf.filename, "source": "session_local"})
        
        sf.progress = 100
        sf.status = "completed"
        db.commit()
    except Exception as e:
        sf.status = "failed"
        db.commit()


    finally:
        db.close()
