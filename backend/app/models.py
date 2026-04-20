"""
atyair — Pydantic-модели данных.
Описывают структуру объектов, которые API возвращает клиенту.
"""

from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


# =============================================================================
# Станции (точки мониторинга)
# =============================================================================

class StationBase(BaseModel):
    """Базовая информация о точке мониторинга."""
    id: int
    name: str
    latitude: float
    longitude: float
    source: str  # 'open-meteo' | 'esp32' | 'aqicn'


class StationWithLatest(StationBase):
    """Станция с последним измерением (для карты)."""
    latest_time: Optional[datetime] = None
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    co: Optional[float] = None
    no2: Optional[float] = None
    so2: Optional[float] = None
    o3: Optional[float] = None
    aqi_us: Optional[int] = None
    aqi_category: Optional[str] = None  # 'good' | 'moderate' | 'unhealthy' | ...


# =============================================================================
# Измерения
# =============================================================================

class Measurement(BaseModel):
    """Одно измерение качества воздуха."""
    time: datetime
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    co: Optional[float] = None
    no2: Optional[float] = None
    so2: Optional[float] = None
    o3: Optional[float] = None
    aqi_us: Optional[int] = None


class StationHistory(BaseModel):
    """История измерений для одной станции."""
    station: StationBase
    measurements: List[Measurement]
    total_count: int


# =============================================================================
# Сообщения жителей (v2)
# =============================================================================

class ReportCreate(BaseModel):
    """Новое сообщение от жителя."""
    report_type: str = Field(..., pattern="^(smell|visibility|health|other)$")
    smell_kind: Optional[str] = Field(None, pattern="^(h2s|burning|chemical|dust)$")
    intensity: int = Field(..., ge=1, le=5)
    district: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    comment: Optional[str] = Field(None, max_length=500)


class Report(ReportCreate):
    """Сообщение в БД (с ID и временем)."""
    id: int
    created_at: datetime
    is_verified: bool = False


# =============================================================================
# Общие ответы API
# =============================================================================

class HealthResponse(BaseModel):
    """Ответ эндпоинта /api/health."""
    status: str
    database: str
    timestamp: datetime


class ErrorResponse(BaseModel):
    """Стандартный формат ошибки."""
    error: str
    detail: Optional[str] = None


# =============================================================================
# AQI категории (US стандарт EPA)
# =============================================================================

AQI_CATEGORIES = [
    (0, 50, "good", "Хорошо"),
    (51, 100, "moderate", "Умеренно"),
    (101, 150, "unhealthy_sensitive", "Вредно для чувствительных"),
    (151, 200, "unhealthy", "Вредно"),
    (201, 300, "very_unhealthy", "Очень вредно"),
    (301, 500, "hazardous", "Опасно"),
]


def aqi_to_category(aqi: Optional[int]) -> Optional[str]:
    """Преобразует числовой AQI в категорию."""
    if aqi is None:
        return None
    for low, high, code, _label in AQI_CATEGORIES:
        if low <= aqi <= high:
            return code
    return "hazardous" if aqi > 500 else None


def aqi_to_label(aqi: Optional[int]) -> Optional[str]:
    """Преобразует числовой AQI в человекочитаемую метку."""
    if aqi is None:
        return None
    for low, high, _code, label in AQI_CATEGORIES:
        if low <= aqi <= high:
            return label
    return "Опасно" if aqi > 500 else None


# ---------- Сводка по городу (для сайдбара) ----------
class CitySummaryPoint(BaseModel):
    """Точка-экстремум (самая чистая/грязная)."""
    name: str
    aqi: int


class CityPollutants(BaseModel):
    """Средние значения загрязнителей по городу."""
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    co: Optional[float] = None
    no2: Optional[float] = None
    so2: Optional[float] = None
    o3: Optional[float] = None


class CitySummary(BaseModel):
    """Агрегированная сводка по всем активным станциям."""
    avg_aqi: Optional[int] = None
    avg_category: Optional[str] = None   # good / moderate / unhealthy ...
    avg_label: Optional[str] = None      # человеческая метка на русском
    max_station: Optional[CitySummaryPoint] = None
    min_station: Optional[CitySummaryPoint] = None
    updated_at: Optional[datetime] = None
    points_total: int = 0
    points_valid: int = 0
    pollutants: CityPollutants = CityPollutants()
