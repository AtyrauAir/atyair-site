"""
atyair — главный файл FastAPI приложения.
Точка входа для uvicorn.
"""

import asyncio
import structlog
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings
from app.db import (
    init_db_pool,
    close_db_pool,
    get_pool,
    check_db_health,
    ensure_stations_exist,
)
from app.fetcher import fetch_all_stations
from app.models import (
    StationWithLatest,
    StationHistory,
    StationBase,
    Measurement,
    HealthResponse,
    aqi_to_category,
    aqi_to_label,
    CitySummary,
    CitySummaryPoint,
    CityPollutants,
)


# =============================================================================
# Логирование — structlog + стандартный logging
# =============================================================================

logging.basicConfig(
    format="%(message)s",
    stream=sys.stdout,
    level=getattr(logging, settings.BACKEND_LOG_LEVEL, logging.INFO),
)

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.dict_tracebacks,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.BACKEND_LOG_LEVEL, logging.INFO)
    ),
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)


# =============================================================================
# Планировщик фоновых задач
# =============================================================================

scheduler = AsyncIOScheduler(timezone="UTC")


# =============================================================================
# Lifespan: инициализация и очистка при старте/остановке
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Запуск при старте, завершение при остановке."""
    logger.info("atyair_starting")

    # 1. Подключение к БД
    await init_db_pool()

    # 2. Проверка, что БД живая
    healthy = await check_db_health()
    if not healthy:
        logger.error("db_not_healthy_at_startup")
        raise RuntimeError("Database is not healthy")

    # 3. Создание станций в БД (идемпотентно)
    await ensure_stations_exist()

    # 4. Первый опрос Open-Meteo при старте
    try:
        await fetch_all_stations()
    except Exception as e:
        logger.error("initial_fetch_failed", error=str(e))

    # 5. Планировщик — опрос каждые N минут
    scheduler.add_job(
        fetch_all_stations,
        trigger=IntervalTrigger(minutes=settings.FETCH_INTERVAL_MINUTES, timezone="UTC"),
        id="fetch_open_meteo",
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    logger.info("scheduler_started", interval_minutes=settings.FETCH_INTERVAL_MINUTES)

    yield

    # Остановка
    logger.info("atyair_stopping")
    scheduler.shutdown(wait=False)
    await close_db_pool()
    logger.info("atyair_stopped")


# =============================================================================
# Создание FastAPI приложения
# =============================================================================

app = FastAPI(
    title="atyair API",
    description="Независимый мониторинг качества воздуха в Атырау",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# =============================================================================
# API endpoints
# =============================================================================

@app.get("/api/health", response_model=HealthResponse)
async def health():
    """Проверка живости сервиса."""
    db_healthy = await check_db_health()
    return HealthResponse(
        status="ok" if db_healthy else "degraded",
        database="up" if db_healthy else "down",
        timestamp=datetime.now(timezone.utc),
    )


@app.get("/api/stations", response_model=List[StationWithLatest])
async def get_stations():
    """
    Возвращает список станций с последним измерением.
    Используется картой на фронтенде.
    """
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (s.id)
                s.id, s.name, s.latitude, s.longitude, s.source,
                m.time AS latest_time,
                m.pm25, m.pm10, m.co, m.no2, m.so2, m.o3, m.aqi_us
            FROM stations s
            LEFT JOIN measurements m ON m.station_id = s.id
            WHERE s.is_active = TRUE
            ORDER BY s.id, m.time DESC NULLS LAST
            """
        )

    return [
        StationWithLatest(
            id=row["id"],
            name=row["name"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            source=row["source"],
            latest_time=row["latest_time"],
            pm25=row["pm25"],
            pm10=row["pm10"],
            co=row["co"],
            no2=row["no2"],
            so2=row["so2"],
            o3=row["o3"],
            aqi_us=row["aqi_us"],
            aqi_category=aqi_to_category(row["aqi_us"]),
        )
        for row in rows
    ]


@app.get("/api/history/{station_id}", response_model=StationHistory)
async def get_history(
    station_id: int,
    hours: int = Query(default=24, ge=1, le=720),
):
    """
    История измерений по одной станции за последние N часов.
    По умолчанию: 24 часа. Максимум: 720 часов (30 дней).
    """
    pool = get_pool()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    async with pool.acquire() as conn:
        station_row = await conn.fetchrow(
            "SELECT id, name, latitude, longitude, source FROM stations WHERE id = $1",
            station_id,
        )
        if not station_row:
            raise HTTPException(status_code=404, detail="Station not found")

        measurement_rows = await conn.fetch(
            """
            SELECT time, pm25, pm10, co, no2, so2, o3, aqi_us
            FROM measurements
            WHERE station_id = $1 AND time >= $2
            ORDER BY time ASC
            """,
            station_id,
            since,
        )

    return StationHistory(
        station=StationBase(
            id=station_row["id"],
            name=station_row["name"],
            latitude=station_row["latitude"],
            longitude=station_row["longitude"],
            source=station_row["source"],
        ),
        measurements=[Measurement(**dict(row)) for row in measurement_rows],
        total_count=len(measurement_rows),
    )


@app.get("/api/summary", response_model=CitySummary)
async def get_summary():
    """
    Сводка по городу: средний / макс / мин AQI по всем активным станциям.
    Используется в сайдбаре до выбора конкретной точки.
    Переиспользует get_stations(), чтобы данные на карте и в сводке совпадали.
    """
    stations = await get_stations()

    # Только станции с валидным AQI (есть данные за последний час)
    valid = [s for s in stations if s.aqi_us is not None]

    if not valid:
        return CitySummary(
            points_total=len(stations),
            points_valid=0,
        )

    avg_aqi = round(sum(s.aqi_us for s in valid) / len(valid))
    max_st = max(valid, key=lambda s: s.aqi_us)
    min_st = min(valid, key=lambda s: s.aqi_us)

    # Самая свежая метка времени среди всех станций
    times = [s.latest_time for s in valid if s.latest_time]
    latest = max(times) if times else None

    def avg_of(attr):
        vals = [getattr(s, attr) for s in valid if getattr(s, attr) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    return CitySummary(
        avg_aqi=avg_aqi,
        avg_category=aqi_to_category(avg_aqi),
        avg_label=aqi_to_label(avg_aqi),
        max_station=CitySummaryPoint(name=max_st.name, aqi=max_st.aqi_us),
        min_station=CitySummaryPoint(name=min_st.name, aqi=min_st.aqi_us),
        updated_at=latest,
        points_total=len(stations),
        points_valid=len(valid),
        pollutants=CityPollutants(
            pm25=avg_of("pm25"),
            pm10=avg_of("pm10"),
            co=avg_of("co"),
            no2=avg_of("no2"),
            so2=avg_of("so2"),
            o3=avg_of("o3"),
        ),
    )


@app.get("/api/info")
async def info():
    """Информация о сервисе для админа."""
    return {
        "name": "atyair",
        "version": "0.1.0",
        "timezone": settings.TZ,
        "monitoring_points": len(settings.monitoring_points_list),
        "fetch_interval_minutes": settings.FETCH_INTERVAL_MINUTES,
    }


# =============================================================================
# Обработчик ошибок
# =============================================================================

@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    logger.error("unhandled_exception", error=str(exc), path=str(request.url.path))
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": "See logs"},
    )
