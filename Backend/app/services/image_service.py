"""
image_service.py
图片上传、文本标注（基于文件名/标签推断）、ChromaDB 向量存储与检索服务。

标注策略：
  - 不依赖 Vision 模型（避免多模态兼容性问题）
  - 用文件名 + 用户标签 + LLM 推断的方式生成 description 和 tags
  - 对 PPT 图片语义检索已经足够准确
"""
import os
import uuid
import json
import logging
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.image import UserImage, ImageLibrary

logger = logging.getLogger(__name__)

# ChromaDB collection 名称
_COLLECTION_USER    = "images_user"
_COLLECTION_LIBRARY = "images_library"

# 相似度阈值 —— 基于文件名文本标注，相似度天然偏低，阈值不宜过高
_THRESHOLD_USER    = float(getattr(settings, "IMAGE_SEARCH_SESSION_THRESHOLD", 0.45))
_THRESHOLD_LIBRARY = float(getattr(settings, "IMAGE_SEARCH_LIBRARY_THRESHOLD", 0.40))


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
    """将图片描述文本向量化并存入指定集合。"""
    try:
        from langchain_core.documents import Document as LCDoc
    except ImportError:
        from langchain.schema import Document as LCDoc  # fallback for older versions
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


def search_image_by_query(query: str, user_id: str) -> Optional[dict]:
    """
    按自然语言 query 搜索最匹配的图片。
    优先搜用户个人图库，若无匹配则搜默认图库。
    返回 resolved 字典，或 None（无匹配时调用方应丢弃该 image element）。

    注意：ChromaDB 的 filter= 参数会绕开 HNSW 索引导致分数错乱，
    因此先取 top-K 无过滤结果，再在 Python 层按 user_id 过滤。
    """
    # 1. 搜用户个人图库（Python 层过滤 user_id）
    try:
        store = _get_image_vector_store(_COLLECTION_USER)
        # 获取向量数量，避免 k 超过集合大小导致 ChromaDB 退化为负分线性搜索
        try:
            n_total = store._collection.count()
        except Exception:
            n_total = 50
        k = max(1, min(n_total, 30))  # 不超过集合大小，最多 30
        candidates = store.similarity_search_with_relevance_scores(query, k=k)
        # Python 层过滤：只保留属于该用户且分数达标的
        for doc, score in candidates:
            if doc.metadata.get("user_id") == user_id and score >= _THRESHOLD_USER:
                img_id = doc.metadata.get("image_id", "")
                logger.info(f"[search_image] user match: score={score:.4f} img={img_id}")
                return {
                    "image_id": img_id,
                    "preview_url": f"/api/v1/users/me/images/{img_id}/preview",
                    "source": "user",
                    "similarity": round(score, 4),
                }
    except Exception as e:
        logger.warning(f"[image_service] user image search error: {e}")

    # 2. 搜默认图库（同样不用 filter，全量搜索后判断分数）
    try:
        store = _get_image_vector_store(_COLLECTION_LIBRARY)
        try:
            n_total = store._collection.count()
        except Exception:
            n_total = 50
        k = max(1, min(n_total, 10))
        results = store.similarity_search_with_relevance_scores(query, k=k)
        if results:
            doc, score = results[0]
            if score >= _THRESHOLD_LIBRARY:
                lib_id = doc.metadata.get("image_id", "")
                logger.info(f"[search_image] library match: score={score:.4f} img={lib_id}")
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
# 文本推断式标注（不依赖 Vision 模型）
# ─────────────────────────────────────────────────────────────────────────────

async def _text_annotate(filename: str, label: str = "") -> Optional[dict]:
    """
    使用文本 LLM 根据图片文件名和用户标签推断标注。
    无需多模态能力，兼容所有文本模型。
    """
    model = settings.LLM_MODEL
    logger.info(f"[text_annotate] start: model={model} filename={filename}")

    hint_parts = []
    if label:
        hint_parts.append(f"用户标签：{label}")
    # 去后缀后将下划线/连字符替换为空格，作为文件名提示
    base = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    if base and not base.startswith("img_"):
        hint_parts.append(f"文件名提示：{base}")

    prompt = (
        "你是一个专业的教学图片标注助手。根据以下信息推断图片内容，以中文输出：\n"
        + ("\n".join(hint_parts) if hint_parts else "（无额外提示，请根据图片用途给出通用标注）")
        + "\n\n输出严格为 JSON 格式，不要包含其他内容：\n"
        '{"description": "一句话精准描述（30字以内）", "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]}'
    )

    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 200,
        "temperature": 0.3,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            logger.info(f"[text_annotate] HTTP status: {resp.status_code}")
            if resp.status_code != 200:
                logger.error(f"[text_annotate] API error: {resp.text[:300]}")
                # 降级：直接用文件名构造最小标注
                return _fallback_annotation(filename, label)
            result_text = resp.json()["choices"][0]["message"]["content"]
            logger.info(f"[text_annotate] raw: {result_text[:150]}")

        # 提取 JSON
        import re as _re
        if "```" in result_text:
            parts = result_text.split("```")
            for part in parts:
                stripped = part.strip()
                if stripped.startswith("json"):
                    result_text = stripped[4:].strip()
                    break
                elif "{" in stripped:
                    result_text = stripped
                    break

        m = _re.search(r"\{.*\}", result_text, _re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
            logger.info(f"[text_annotate] success: {parsed.get('description','')[:40]}")
            return parsed
        else:
            logger.warning(f"[text_annotate] no JSON, using fallback")
            return _fallback_annotation(filename, label)

    except Exception as e:
        import traceback
        logger.error(f"[text_annotate] FAILED: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        return _fallback_annotation(filename, label)


def _fallback_annotation(filename: str, label: str = "") -> dict:
    """最小降级标注——纯本地，绝对不会失败。"""
    base = os.path.splitext(filename)[0].replace("_", " ").replace("-", " ")
    desc = label or base or "教学图片"
    tags = [t for t in (label or base).split() if t][:5] or ["教学", "图片"]
    return {"description": desc[:30], "tags": tags}


# ─────────────────────────────────────────────────────────────────────────────
# 用户图片操作
# ─────────────────────────────────────────────────────────────────────────────

async def annotate_user_image(image_id: str):
    """
    后台任务：对指定 UserImage 执行文本推断式标注并存向量。
    """
    from app.db.session import SessionLocal
    db: Session = SessionLocal()
    img = db.query(UserImage).filter(UserImage.id == image_id).first()
    if not img:
        db.close()
        return
    try:
        img.annotate_status = "processing"
        db.commit()

        result = await _text_annotate(img.filename, img.label or "")
        desc = result.get("description", "")
        tags = result.get("tags", [])
        img.description = desc
        img.tags = tags
        text_for_embed = desc + " " + " ".join(tags)
        _store_image_vector(
            _COLLECTION_USER, image_id, text_for_embed,
            {"user_id": img.user_id, "filename": img.filename}
        )
        img.vector_id = image_id
        img.annotate_status = "done"
        db.commit()
        logger.info(f"[annotate_user_image] done: {image_id} desc={desc[:30]}")
    except Exception as e:
        logger.error(f"[annotate_user_image] error: {e}")
        img.annotate_status = "failed"
        db.commit()
    finally:
        db.close()


def delete_user_image_data(db: Session, image_id: str):
    """删除用户图片的物理文件和向量。"""
    img = db.query(UserImage).filter(UserImage.id == image_id).first()
    if not img:
        return
    _delete_image_vector(_COLLECTION_USER, image_id)
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
    """后台任务：对 ImageLibrary 图片做文本推断式标注并存向量。"""
    from app.db.session import SessionLocal
    db: Session = SessionLocal()
    img = db.query(ImageLibrary).filter(ImageLibrary.id == lib_id).first()
    if not img:
        db.close()
        return
    try:
        img.annotate_status = "processing"
        db.commit()

        result = await _text_annotate(img.filename, img.import_note or "")
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
        db.commit()
        logger.info(f"[annotate_library_image] done: {lib_id} desc={desc[:30]}")
    except Exception as e:
        logger.error(f"[annotate_library_image] error: {e}")
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
