"""
image_service.py
图片上传、Vision LLM 自动标注、ChromaDB 向量存储与检索服务。
"""
import os
import uuid
import base64
import json
import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.image import SessionImage, ImageLibrary

logger = logging.getLogger(__name__)

# ChromaDB collection 名称
_COLLECTION_SESSION = "images_session"
_COLLECTION_LIBRARY = "images_library"

# 相似度阈值（来自 settings，若未配置则用默认）
_THRESHOLD_SESSION = float(getattr(settings, "IMAGE_SEARCH_SESSION_THRESHOLD", 0.75))
_THRESHOLD_LIBRARY = float(getattr(settings, "IMAGE_SEARCH_LIBRARY_THRESHOLD", 0.70))


# ─────────────────────────────────────────────────────────────────────────────
# 向量存储辅助
# ─────────────────────────────────────────────────────────────────────────────

def _get_image_vector_store(collection_name: str):
    """获取图片专用的 ChromaDB 集合（与文档知识库隔离）。"""
    import chromadb
    from langchain_chroma import Chroma
    from app.services.vector_store import get_embeddings, CHROMA_PERSIST_DIR

    os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
    client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
    return Chroma(
        client=client,
        collection_name=collection_name,
        embedding_function=get_embeddings(),
    )


def _store_image_vector(collection_name: str, image_id: str,
                        text: str, metadata: dict) -> str:
    """将图片描述文本向量化并存入指定集合，返回使用的 vector_id。"""
    from langchain.schema import Document as LCDoc
    store = _get_image_vector_store(collection_name)
    doc = LCDoc(page_content=text, metadata={**metadata, "image_id": image_id})
    store.add_documents([doc], ids=[image_id])
    return image_id


def _delete_image_vector(collection_name: str, image_id: str):
    """删除指定图片的向量。"""
    try:
        store = _get_image_vector_store(collection_name)
        if hasattr(store, "_collection"):
            store._collection.delete(ids=[image_id])
    except Exception as e:
        logger.warning(f"[image_service] delete vector failed: {e}")


def search_image_by_query(query: str, session_id: str) -> Optional[dict]:
    """
    按自然语言 query 搜索最匹配的图片。
    优先搜会话图片库，若无匹配则搜默认图库。
    返回 resolved 字典，或 None。
    """
    # 1. 搜会话图片
    try:
        store = _get_image_vector_store(_COLLECTION_SESSION)
        results = store.similarity_search_with_relevance_scores(
            query, k=1,
            filter={"session_id": session_id}
        )
        if results:
            doc, score = results[0]
            if score >= _THRESHOLD_SESSION:
                img_id = doc.metadata.get("image_id", "")
                return {
                    "image_id": img_id,
                    "preview_url": f"/api/v1/sessions/{session_id}/images/{img_id}/preview",
                    "source": "session",
                    "similarity": round(score, 4),
                }
    except Exception as e:
        logger.warning(f"[image_service] session image search error: {e}")

    # 2. 搜默认图库
    try:
        store = _get_image_vector_store(_COLLECTION_LIBRARY)
        results = store.similarity_search_with_relevance_scores(query, k=1)
        if results:
            doc, score = results[0]
            if score >= _THRESHOLD_LIBRARY:
                lib_id = doc.metadata.get("image_id", "")
                return {
                    "image_id": lib_id,
                    "preview_url": f"/api/v1/admin/image-library/{lib_id}/preview",
                    "source": "library",
                    "similarity": round(score, 4),
                }
    except Exception as e:
        logger.warning(f"[image_service] library image search error: {e}")

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Vision LLM 标注
# ─────────────────────────────────────────────────────────────────────────────

async def _vision_annotate(file_path: str) -> Optional[dict]:
    """
    调用 Vision LLM 对图片路径做标注，返回 {"description": str, "tags": list}。
    若失败返回 None。
    """
    vision_model = getattr(settings, "VISION_MODEL", settings.LLM_MODEL)
    try:
        with open(file_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        # 猜测 mime type
        ext = os.path.splitext(file_path)[1].lower()
        mime = {"jpg": "image/jpeg", ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg", ".png": "image/png",
                ".webp": "image/webp"}.get(ext, "image/jpeg")

        system_prompt = (
            "你是一个专业的教学图片标注助手。请分析图片内容，以中文输出：\n"
            "1. 一句话精准描述（30字以内），聚焦图片的核心教学信息\n"
            "2. 5-8个检索标签（简短词组，用于教学场景语义匹配）\n\n"
            '输出严格为 JSON 格式，不要包含其他内容：\n'
            '{"description": "...", "tags": ["tag1", "tag2", ...]}'
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{img_b64}"
                        }
                    },
                    {"type": "text", "text": "请分析这张教学图片。"}
                ]
            }
        ]

        url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": vision_model,
            "messages": messages,
            "max_tokens": 300,
            "temperature": 0.1,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            resp.raise_for_status()
            result_text = resp.json()["choices"][0]["message"]["content"]

        # 提取 JSON
        if "```" in result_text:
            result_text = result_text.split("```json")[-1].split("```")[0].strip()
        import re
        m = re.search(r"\{.*\}", result_text, re.DOTALL)
        if m:
            return json.loads(m.group(0))
    except Exception as e:
        logger.error(f"[image_service] vision annotate failed for {file_path}: {e}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 会话图片操作
# ─────────────────────────────────────────────────────────────────────────────

async def annotate_session_image(image_id: str):
    """
    后台任务：对指定 SessionImage 执行 Vision LLM 标注并存向量。
    使用独立 DB Session 避免与请求 Session 冲突。
    """
    from app.db.session import SessionLocal
    db: Session = SessionLocal()
    img = db.query(SessionImage).filter(SessionImage.id == image_id).first()
    if not img:
        db.close()
        return
    try:
        img.annotate_status = "processing"
        db.commit()

        result = await _vision_annotate(img.file_path)
        if result:
            desc = result.get("description", "")
            tags = result.get("tags", [])
            img.description = desc
            img.tags = tags
            # 向量化：描述 + 标签拼接
            text_for_embed = desc + " " + " ".join(tags)
            _store_image_vector(
                _COLLECTION_SESSION, image_id, text_for_embed,
                {"session_id": img.session_id, "filename": img.filename}
            )
            img.vector_id = image_id
            img.annotate_status = "done"
        else:
            img.annotate_status = "failed"
        db.commit()
    except Exception as e:
        logger.error(f"[image_service] annotate_session_image error: {e}")
        img.annotate_status = "failed"
        db.commit()
    finally:
        db.close()


def delete_session_image_data(db: Session, image_id: str):
    """删除会话图片的物理文件和向量。"""
    img = db.query(SessionImage).filter(SessionImage.id == image_id).first()
    if not img:
        return
    _delete_image_vector(_COLLECTION_SESSION, image_id)
    if img.file_path and os.path.exists(img.file_path):
        try:
            os.remove(img.file_path)
        except OSError:
            pass
    db.delete(img)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# 默认图库操作
# ─────────────────────────────────────────────────────────────────────────────

async def annotate_library_image(lib_id: str):
    """后台任务：对 ImageLibrary 图片做 Vision 标注并存向量。"""
    from app.db.session import SessionLocal
    db: Session = SessionLocal()
    img = db.query(ImageLibrary).filter(ImageLibrary.id == lib_id).first()
    if not img:
        db.close()
        return
    try:
        img.annotate_status = "processing"
        db.commit()

        result = await _vision_annotate(img.file_path)
        if result:
            desc = result.get("description", "")
            tags = result.get("tags", [])
            img.description = desc
            img.tags = tags
            text_for_embed = desc + " " + " ".join(tags)
            _store_image_vector(
                _COLLECTION_LIBRARY, lib_id, text_for_embed,
                {"category": img.category, "filename": img.filename}
            )
            img.vector_id = lib_id
            img.annotate_status = "done"
        else:
            img.annotate_status = "failed"
        db.commit()
    except Exception as e:
        logger.error(f"[image_service] annotate_library_image error: {e}")
        img.annotate_status = "failed"
        db.commit()
    finally:
        db.close()


def delete_library_image_data(db: Session, lib_id: str):
    """删除默认图库图片的物理文件和向量。"""
    img = db.query(ImageLibrary).filter(ImageLibrary.id == lib_id).first()
    if not img:
        return
    _delete_image_vector(_COLLECTION_LIBRARY, lib_id)
    if img.file_path and os.path.exists(img.file_path):
        try:
            os.remove(img.file_path)
        except OSError:
            pass
    db.delete(img)
    db.commit()
