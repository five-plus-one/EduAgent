from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool, StaticPool
from app.core.config import settings

_is_sqlite = "sqlite" in settings.SQLALCHEMY_DATABASE_URI

# SQLite 文件数据库 → NullPool：每次请求建新连接、用完即关，彻底消除池耗尽
# （SQLite 不能从连接池受益：写操作序列化、并发连接无意义）
# 内存数据库例外 → StaticPool（单连接保持状态）
_engine_kwargs: dict = {}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
    if ":memory:" in settings.SQLALCHEMY_DATABASE_URI:
        _engine_kwargs["poolclass"] = StaticPool
    else:
        _engine_kwargs["poolclass"] = NullPool

engine = create_engine(settings.SQLALCHEMY_DATABASE_URI, **_engine_kwargs)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _):
        """
        WAL 模式：允许多读单写并发，写入时读请求不被阻塞。
        NORMAL sync：写入性能提升，崩溃安全性仍可接受。
        """
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
