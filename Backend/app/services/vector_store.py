import os
import chromadb
from langchain_openai import OpenAIEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.config import settings

CHROMA_PERSIST_DIR = os.path.join(os.getcwd(), "chroma_db")

def get_embeddings():
    return OpenAIEmbeddings(
        model=settings.EMBEDDING_MODEL,
        openai_api_base=settings.OPENAI_API_BASE,
        openai_api_key=settings.OPENAI_API_KEY
    )

def get_vector_store(collection_name: str = "eduagent_global"):
    os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)
    embeddings = get_embeddings()
    
    # Use PersistentClient to avoid 'default_tenant' common connection issues
    client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
    
    return Chroma(
        client=client,
        collection_name=collection_name,
        embedding_function=embeddings,
    )

def store_document_vectors(text: str, document_id: str, metadata: dict = None):
    """
    Split text and store vectors in ChromaDB collection
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=150
    )
    docs = splitter.create_documents([text], metadatas=[metadata or {}])
    
    # Inject document_id into metadata for all chunks
    for d in docs:
        d.metadata["document_id"] = document_id
        
    vector_store = get_vector_store()
    vector_store.add_documents(docs)
    
def delete_document_vectors(document_id: str):
    """
    Delete all vector chunks belonging to a document_id
    """
    vector_store = get_vector_store()
    try:
        if hasattr(vector_store, "_collection"):
            vector_store._collection.delete(where={"document_id": document_id})
    except Exception:
        pass

def search_vectors(query: str, filter_document_ids: list = None, top_k: int = 5):
    """
    Search vector similarity. 
    If filter_document_ids is provided, narrow down to specific file IDs.
    """
    vector_store = get_vector_store()
    if filter_document_ids:
        # Search constrained to specific document IDs mounted to a session
        results = vector_store.similarity_search(
            query, 
            k=top_k, 
            filter={"document_id": {"$in": filter_document_ids}}
        )
    else:
        # Global search
        results = vector_store.similarity_search(query, k=top_k)
    return results
