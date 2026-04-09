import sys
sys.path.insert(0, '.')
from app.services.image_service import _get_image_vector_store, _COLLECTION_USER
from app.db.session import SessionLocal
from app.models.user import User

db = SessionLocal()
user = db.query(User).first()
uid = user.id
print(f'user_id: {uid}')
db.close()

store = _get_image_vector_store(_COLLECTION_USER)

try:
    count = store._collection.count()
    print(f'Total vectors in images_user: {count}')
except Exception as e:
    print(f'count error: {e}')

queries = [
    '刚体平动和定轴转动对比示意图',
    '角速度角加速度',
    '定轴转动',
    '转动',
]

for q in queries:
    print(f'\nQuery: {q}')
    # Without filter
    results = store.similarity_search_with_relevance_scores(q, k=3)
    for doc, score in results:
        fname = doc.metadata.get('filename', '')[:25]
        iid = doc.metadata.get('image_id', '')
        print(f'  (no filter) score={score:.4f} img={iid} file={fname}')
    # With user filter
    try:
        results2 = store.similarity_search_with_relevance_scores(q, k=3, filter={'user_id': uid})
        for doc, score in results2:
            fname = doc.metadata.get('filename', '')[:25]
            iid = doc.metadata.get('image_id', '')
            print(f'  (filtered)  score={score:.4f} img={iid} file={fname}')
    except Exception as e:
        print(f'  filter error: {e}')
