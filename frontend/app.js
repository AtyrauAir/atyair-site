/* =============================================================================
   atyair — логика фронтенда
   Карта Leaflet + загрузка данных с /api/*
   ============================================================================= */

'use strict';

// --------- Константы ---------

const API_BASE = '/api';
const MAP_CENTER = [47.1067, 51.9233];  // Атырау, центр города
const MAP_ZOOM = 12;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;  // 5 минут

// Цвета AQI по категориям (EPA US)
const AQI_COLORS = {
    good: '#00e400',
    moderate: '#ffff00',
    unhealthy_sensitive: '#ff7e00',
    unhealthy: '#ff0000',
    very_unhealthy: '#8f3f97',
    hazardous: '#7e0023',
};

const AQI_LABELS = {
    good: 'Хорошо',
    moderate: 'Умеренно',
    unhealthy_sensitive: 'Вредно для чувствительных',
    unhealthy: 'Вредно',
    very_unhealthy: 'Очень вредно',
    hazardous: 'Опасно',
};

// --------- Инициализация карты ---------

const map = L.map('map', {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: true,
    attributionControl: true,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
}).addTo(map);

// Хранилище маркеров: station_id -> L.Marker
const markers = {};

// --------- Утилиты ---------

function formatTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diffMin = Math.round((now - d) / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин назад`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ч назад`;
    return d.toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatNum(v, digits = 1) {
    if (v === null || v === undefined) return '—';
    return Number(v).toFixed(digits);
}

function aqiColor(category) {
    return AQI_COLORS[category] || '#9ca3af';
}

function aqiLabel(category) {
    return AQI_LABELS[category] || 'Нет данных';
}

// --------- Создание маркера ---------

function createMarker(station) {
    const hasData = station.aqi_us !== null && station.aqi_us !== undefined;
    const color = hasData ? aqiColor(station.aqi_category) : '#9ca3af';
    const text = hasData ? String(station.aqi_us) : '—';

    const icon = L.divIcon({
        className: 'aqi-marker-wrapper',
        html: `<div class="aqi-marker" style="background:${color}">${text}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });

    const marker = L.marker([station.latitude, station.longitude], { icon })
        .addTo(map)
        .bindTooltip(station.name, { direction: 'top', offset: [0, -10] });

    marker.on('click', () => showStationDetails(station));

    return marker;
}

// --------- Сайдбар: детали станции ---------

async function showStationDetails(station) {
    const content = document.getElementById('sidebar-content');
    const header = document.querySelector('.sidebar__header');

    header.innerHTML = `
        <h2 class="sidebar__title">${station.name}</h2>
        <p class="sidebar__subtitle">
            ${station.latitude.toFixed(4)}, ${station.longitude.toFixed(4)} · Источник: ${station.source}
        </p>
    `;

    if (station.aqi_us === null || station.aqi_us === undefined) {
        content.innerHTML = `
            <div class="sidebar__hint">
                <p><strong>Данных пока нет.</strong></p>
                <p>Данные появятся после первого опроса Open-Meteo (обычно в течение часа после запуска).</p>
            </div>
        `;
        return;
    }

    const color = aqiColor(station.aqi_category);
    const label = aqiLabel(station.aqi_category);

    content.innerHTML = `
        <div class="station-details">
            <div class="station-details__time">Обновлено: ${formatTime(station.latest_time)}</div>

            <div class="aqi-box" style="background:${color}">
                <div class="aqi-box__value">${station.aqi_us}</div>
                <div class="aqi-box__label">${label}</div>
            </div>

            <div class="pollutant-grid">
                <div class="pollutant">
                    <div class="pollutant__name">PM2.5</div>
                    <div class="pollutant__value">${formatNum(station.pm25)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
                <div class="pollutant">
                    <div class="pollutant__name">PM10</div>
                    <div class="pollutant__value">${formatNum(station.pm10)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
                <div class="pollutant">
                    <div class="pollutant__name">CO</div>
                    <div class="pollutant__value">${formatNum(station.co, 0)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
                <div class="pollutant">
                    <div class="pollutant__name">NO₂</div>
                    <div class="pollutant__value">${formatNum(station.no2)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
                <div class="pollutant">
                    <div class="pollutant__name">SO₂</div>
                    <div class="pollutant__value">${formatNum(station.so2)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
                <div class="pollutant">
                    <div class="pollutant__name">O₃</div>
                    <div class="pollutant__value">${formatNum(station.o3)} <span class="pollutant__unit">мкг/м³</span></div>
                </div>
            </div>
        </div>
    `;
}

// --------- Загрузка станций с API ---------

async function loadStations() {
    try {
        const response = await fetch(`${API_BASE}/stations`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const stations = await response.json();

        // Обновляем или создаём маркеры
        stations.forEach(station => {
            if (markers[station.id]) {
                // Обновить существующий маркер
                map.removeLayer(markers[station.id]);
            }
            markers[station.id] = createMarker(station);
        });

        // Обновляем время последнего обновления в футере
        const latest = stations
            .map(s => s.latest_time)
            .filter(Boolean)
            .sort()
            .pop();

        const updateEl = document.getElementById('last-update');
        if (updateEl) {
            updateEl.textContent = latest
                ? `Последнее измерение: ${formatTime(latest)}`
                : 'Ждём первых данных…';
        }

        console.log(`atyair: loaded ${stations.length} stations`);
    } catch (error) {
        console.error('atyair: failed to load stations', error);
        const updateEl = document.getElementById('last-update');
        if (updateEl) {
            updateEl.textContent = 'Ошибка загрузки данных';
        }
    }
}

// --------- Старт приложения ---------

loadStations();
setInterval(loadStations, REFRESH_INTERVAL_MS);
