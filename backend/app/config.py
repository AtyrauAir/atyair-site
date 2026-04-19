"""
atyair — конфигурация приложения.
Все настройки загружаются из переменных окружения (.env).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List


class MonitoringPoint:
    """Точка мониторинга: имя + координаты."""
    def __init__(self, name: str, lat: float, lon: float):
        self.name = name
        self.latitude = lat
        self.longitude = lon

    def __repr__(self):
        return f"MonitoringPoint({self.name}, {self.latitude}, {self.longitude})"


class Settings(BaseSettings):
    """
    Настройки приложения.
    Читаются из переменных окружения (которые Docker Compose передаёт из .env).
    """

    # ---------- PostgreSQL ----------
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432

    # ---------- FastAPI Backend ----------
    BACKEND_SECRET_KEY: str
    BACKEND_LOG_LEVEL: str = "INFO"
    ALLOWED_ORIGINS: str = "https://atyair.org,https://www.atyair.org"

    # ---------- Open-Meteo ----------
    OPEN_METEO_BASE_URL: str = "https://air-quality-api.open-meteo.com/v1/air-quality"
    FETCH_INTERVAL_MINUTES: int = 60

    # ---------- AQICN (v1.5) ----------
    AQICN_TOKEN: str = ""

    # ---------- Точки мониторинга ----------
    MONITORING_POINTS: str

    # ---------- Общее ----------
    DOMAIN: str = "atyair.org"
    EMAIL_FOR_LETSENCRYPT: str = ""
    TZ: str = "Asia/Atyrau"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def database_url(self) -> str:
        """Строка подключения к PostgreSQL."""
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def allowed_origins_list(self) -> List[str]:
        """Список разрешённых origin для CORS."""
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def monitoring_points_list(self) -> List[MonitoringPoint]:
        """
        Парсит MONITORING_POINTS из .env в список объектов.
        Формат строки: 'Имя|lat|lon,Имя2|lat2|lon2,...'
        """
        points = []
        for entry in self.MONITORING_POINTS.split(","):
            parts = entry.strip().split("|")
            if len(parts) != 3:
                continue
            try:
                name = parts[0].strip()
                lat = float(parts[1].strip())
                lon = float(parts[2].strip())
                points.append(MonitoringPoint(name, lat, lon))
            except (ValueError, IndexError):
                continue
        return points


# Глобальный экземпляр настроек
settings = Settings()
