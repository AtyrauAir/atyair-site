import asyncio
import httpx
import structlog
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from app.config import settings
from app.db import get_pool

logger = structlog.get_logger(__name__)

PM25_BP = [
    (0.0, 12.0, 0, 50), (12.1, 35.4, 51, 100),
    (35.5, 55.4, 101, 150), (55.5, 150.4, 151, 200),
    (150.5, 250.4, 201, 300), (250.5, 500.4, 301, 500),
]
PM10_BP = [
    (0, 54, 0, 50), (55, 154, 51, 100),
    (155, 254, 101, 150), (255, 354, 151, 200),
    (355, 424, 201, 300), (425, 604, 301, 500),
]


def _aqi_sub(c, bp):
    if c is None or c < 0:
        return None
    for cl, ch, il, ih in bp:
        if cl <= c <= ch:
            return round((ih - il) / (ch - cl) * (c - cl) + il)
    return 500 if c > bp[-1][1] else None


def calculate_us_aqi(pm25, pm10):
    vals = [v for v in [_aqi_sub(pm25, PM25_BP), _aqi_sub(pm10, PM10_BP)] if v is not None]
    return max(vals) if vals else None


async def fetch_open_meteo(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    params = {
        "latitude": lat, "longitude": lon,
        "current": "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(settings.OPEN_METEO_BASE_URL, params=params)
            r.raise_for_status()
            data = r.json()
        cur = data.get("current", {})
        if not cur:
            return None
        return {
            "time": cur.get("time"),
            "pm25": cur.get("pm2_5"),
            "pm10": cur.get("pm10"),
            "co": cur.get("carbon_monoxide"),
            "no2": cur.get("nitrogen_dioxide"),
            "so2": cur.get("sulphur_dioxide"),
            "o3": cur.get("ozone"),
        }
    except Exception as e:
        logger.error("fetch_error", lat=lat, lon=lon, error=str(e))
        return None


async def save_measurement(station_id: int, data: Dict[str, Any]) -> bool:
    pool = get_pool()
    aqi = calculate_us_aqi(data.get("pm25"), data.get("pm10"))
    t = data.get("time")
    if t:
        try:
            ts = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
        except ValueError:
            ts = datetime.now(timezone.utc)
    else:
        ts = datetime.now(timezone.utc)

    sql = (
        "INSERT INTO measurements"
        " (time, station_id, pm25, pm10, co, no2, so2, o3, aqi_us)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
        " ON CONFLICT (time, station_id) DO UPDATE SET"
        " pm25=EXCLUDED.pm25, pm10=EXCLUDED.pm10,"
        " co=EXCLUDED.co, no2=EXCLUDED.no2,"
        " so2=EXCLUDED.so2, o3=EXCLUDED.o3,"
        " aqi_us=EXCLUDED.aqi_us"
    )
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                sql, ts, station_id,
                data.get("pm25"), data.get("pm10"),
                data.get("co"), data.get("no2"),
                data.get("so2"), data.get("o3"), aqi,
            )
        return True
    except Exception as e:
        logger.error("save_error", station_id=station_id, error=str(e))
        return False


async def fetch_all_stations() -> None:
    pool = get_pool()
    sql = (
        "SELECT id, name, latitude, longitude"
        " FROM stations"
        " WHERE source = 'open-meteo' AND is_active = TRUE"
        " ORDER BY id"
    )
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql)
    if not rows:
        logger.warning("no_active_stations")
        return
    logger.info("fetch_cycle_started", stations_count=len(rows))
    tasks = [fetch_open_meteo(r["latitude"], r["longitude"]) for r in rows]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    saved = failed = 0
    for row, result in zip(rows, results):
        if isinstance(result, Exception) or result is None:
            failed += 1
            continue
        ok = await save_measurement(row["id"], result)
        if ok:
            saved += 1
        else:
            failed += 1
    logger.info("fetch_cycle_completed", saved=saved, failed=failed, total=len(rows))
