"""
atyair — подключение к PostgreSQL через asyncpg.
"""

import asyncpg
import structlog
from typing import Optional

from app.config import settings

logger = structlog.get_logger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def init_db_pool() -> None:
    """Инициализация пула подключений к PostgreSQL."""
    global _pool
    if _pool is not None:
        logger.warning("db_pool_already_initialized")
        return

    logger.info("db_pool_initializing",
                host=settings.POSTGRES_HOST,
                port=settings.POSTGRES_PORT,
                database=settings.POSTGRES_DB)

    try:
        _pool = await asyncpg.create_pool(
            user=settings.POSTGRES_USER,
            password=settings.POSTGRES_PASSWORD,
            database=settings.POSTGRES_DB,
            host=settings.POSTGRES_HOST,
            port=settings.POSTGRES_PORT,
            min_size=2,
            max_size=10,
            timeout=30,
            command_timeout=60,
        )
        logger.info("db_pool_initialized")
    except Exception as e:
        logger.error("db_pool_init_failed", error=str(e))
        raise


async def close_db_pool() -> None:
    """Закрытие пула соединений."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("db_pool_closed")


def get_pool() -> asyncpg.Pool:
    """Возвращает текущий пул соединений."""
    if _pool is None:
        raise RuntimeError("Database pool is not initialized")
    return _pool


async def check_db_health() -> bool:
    """Проверяет соединение с БД простым запросом."""
    try:
        pool = get_pool()
        async with pool.acquire() as conn:
            result = await conn.fetchval("SELECT 1")
            return result == 1
    except Exception as e:
        logger.error("db_health_check_failed", error=str(e))
        return False


async def ensure_stations_exist() -> None:
    """
    Создаёт записи stations для всех точек мониторинга из .env.
    Идемпотентно: повторные запуски ничего не делают.
    """
    pool = get_pool()
    points = settings.monitoring_points_list

    if not points:
        logger.warning("no_monitoring_points_configured")
        return

    async with pool.acquire() as conn:
        async with conn.transaction():
            for point in points:
                await conn.execute(
                    """
                    INSERT INTO stations (name, latitude, longitude, source, description, is_active)
                    VALUES ($1, $2, $3, 'open-meteo', $4, TRUE)
                    ON CONFLICT (name, source) DO NOTHING
                    """,
                    point.name,
                    point.latitude,
                    point.longitude,
                    f"Виртуальная точка: {point.name}",
                )

    logger.info("stations_ensured", count=len(points))
