import sys; sys.path.insert(0,'.')
from app.services.image_service import search_image_by_query

uid = 'u_133f3d0b'
queries = ['刚体平动和定轴转动对比示意图', '角速度角加速度示意图', '定轴转动核心物理量']
for q in queries:
    r = search_image_by_query(q, uid)
    print('Q:', q[:25])
    if r:
        print('  MATCH: img=' + r['image_id'] + ' score=' + str(r['similarity']))
    else:
        print('  NO MATCH')
