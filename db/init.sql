-- =============================================================================
-- atyair — схема базы данных
-- PostgreSQL 16 + TimescaleDB
-- =============================================================================

-- Включаем TimescaleDB для эффективного хранения временных рядов
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =============================================================================
-- Таблица: stations
-- Точки мониторинга: виртуальные (Open-Meteo по координатам),
-- физические датчики ESP32 (v1.5), возможно AQICN-станции (v1.5)
-- =============================================================================

CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL,  -- 'open-meteo' | 'esp32' | 'aqicn'
    external_id TEXT,       -- ID в API источника, если есть
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stations_name_source
    ON stations(name, source);

CREATE INDEX IF NOT EXISTS idx_stations_active
    ON stations(is_active) WHERE is_active = TRUE;

-- =============================================================================
-- Таблица: measurements
-- Все измерения качества воздуха с временными метками
-- Hypertable TimescaleDB — автоматически партиционируется по времени
-- =============================================================================

CREATE TABLE IF NOT EXISTS measurements (
    time TIMESTAMPTZ NOT NULL,
    station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    pm25 DOUBLE PRECISION,        -- мкг/м³
    pm10 DOUBLE PRECISION,        -- мкг/м³
    co DOUBLE PRECISION,          -- мкг/м³  (CO)
    no2 DOUBLE PRECISION,         -- мкг/м³  (NO₂)
    so2 DOUBLE PRECISION,         -- мкг/м³  (SO₂)
    o3 DOUBLE PRECISION,          -- мкг/м³  (O₃)
    aqi_us INTEGER,               -- рассчитанный US AQI
    temperature DOUBLE PRECISION, -- °C (если источник даёт)
    humidity DOUBLE PRECISION,    -- % (если источник даёт)
    PRIMARY KEY (time, station_id)
);

-- Превращаем в hypertable (партиции по 7 дней)
SELECT create_hypertable('measurements', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_measurements_station_time
    ON measurements(station_id, time DESC);

-- =============================================================================
-- Таблица: reports
-- Сообщения жителей о запахах/видимости/самочувствии (v2)
-- Пока пустая, структура готова заранее
-- =============================================================================

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_type TEXT NOT NULL,  -- 'smell' | 'visibility' | 'health' | 'other'
    smell_kind TEXT,             -- 'h2s' | 'burning' | 'chemical' | 'dust' | NULL
    intensity INTEGER CHECK (intensity BETWEEN 1 AND 5),
    district TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    comment TEXT,
    ip_hash TEXT,                -- хэш IP для защиты от спама, не сам IP
    is_verified BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_reports_created
    ON reports(created_at DESC) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_reports_type
    ON reports(report_type) WHERE is_deleted = FALSE;

-- =============================================================================
-- Таблица: emission_sources (v2 — после юрконсультации)
-- Крупные предприятия-эмитенты: АНПЗ, NCOC, котельные, факелы
-- Пока пустая — структура готова, данные добавим позже
-- =============================================================================

CREATE TABLE IF NOT EXISTS emission_sources (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT,  -- 'refinery' | 'flare' | 'power_plant' | 'other'
    operator TEXT,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    primary_emissions TEXT[],  -- ['PM10', 'SO2', 'NOx', ...]
    description TEXT,
    public_notes TEXT,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Начальные данные: вставляем точки мониторинга из .env
-- (fetcher.py будет использовать их при старте)
-- =============================================================================

-- Пустое начальное состояние — fetcher.py сам создаст станции
-- на основе MONITORING_POINTS из .env при первом запуске.

-- =============================================================================
-- Политика хранения: старые данные (>1 года) удалять автоматически
-- Экономия места на диске
-- =============================================================================

SELECT add_retention_policy('measurements', INTERVAL '365 days',
    if_not_exists => TRUE);

-- =============================================================================
-- Материализованные представления для быстрых агрегатов (v1.1)
-- Пока не создаём — добавим, когда появится реальная нагрузка
-- =============================================================================

-- Версия схемы (для будущих миграций)
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description TEXT
);

INSERT INTO schema_version (version, description)
VALUES (1, 'Initial schema: stations, measurements, reports, emission_sources')
ON CONFLICT DO NOTHING;
