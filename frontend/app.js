/* =============================================================================
   atyair — логика фронтенда
   Карта Leaflet + загрузка данных с /api/*
   ============================================================================= */

'use strict';

const API_BASE = '/api';
const MAP_CENTER = [47.1067, 51.9233];
const MAP_ZOOM = 12;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

const POLLUTANTS_INFO = {
    pm25: {
        name: 'Мелкая пыль',
        tech: 'PM2.5',
        desc: 'Частицы меньше 2.5 микрометра. Попадают глубоко в лёгкие и кровь. Главный враг здоровья.',
        sources: 'Автомобили, заводы, пыльные бури, пожары, сжигание угля.',
        thresholds: [15, 35, 55, 150],
        digits: 1,
    },
    pm10: {
        name: 'Крупная пыль',
        tech: 'PM10',
        desc: 'Частицы до 10 микрометров — обычная пыль в воздухе. Оседает в верхних дыхательных путях.',
        sources: 'Дороги, строительство, ветер, промышленная пыль.',
        thresholds: [45, 100, 200, 400],
        digits: 1,
    },
    co: {
        name: 'Угарный газ',
        tech: 'CO',
        desc: 'Без цвета и запаха. Связывается с кровью вместо кислорода. В больших дозах смертелен.',
        sources: 'Выхлопы автомобилей, плохое горение, пожары, печи.',
        thresholds: [4000, 10000, 30000, 60000],
        digits: 0,
    },
    no2: {
        name: 'Выхлопы машин',
        tech: 'NO₂',
        desc: 'Бурый газ с острым запахом. Раздражает дыхательные пути, усиливает астму.',
        sources: 'Автомобили, грузовики, ТЭЦ, нефтехимия.',
        thresholds: [25, 100, 200, 400],
        digits: 1,
    },
    so2: {
        name: 'Сернистый газ',
        tech: 'SO₂',
        desc: 'Острый удушливый запах. Главный показатель выбросов нефтепереработки и ТЭЦ.',
        sources: 'НПЗ, ТЭЦ на угле/мазуте, металлургия.',
        thresholds: [40, 125, 350, 500],
        digits: 1,
    },
    o3: {
        name: 'Озон у земли',
        tech: 'O₃',
        desc: 'Не путать с озоном в стратосфере! У земли — вреден. Образуется от солнца и выхлопов летом.',
        sources: 'Реакция солнечного света с выхлопами. Летом больше.',
        thresholds: [100, 160, 240, 400],
        digits: 1,
    },
};

function pollutantLevel(value, thresholds) {
    if (value === null || value === undefined) return null;
    if (value <= thresholds[0]) return { code: 'good', label: 'норма', color: '#16a34a' };
    if (value <= thresholds[1]) return { code: 'moderate', label: 'чуть повышено', color: '#ca8a04' };
    if (value <= thresholds[2]) return { code: 'high', label: 'повышено', color: '#ea580c' };
    return { code: 'hazard', label: 'опасно', color: '#dc2626' };
}

function pollutantCard(key, value) {
    const info = POLLUTANTS_INFO[key];
    if (!info) return '';
    const valDisplay = (value === null || value === undefined) ? '—' : Number(value).toFixed(info.digits);
    const level = pollutantLevel(value, info.thresholds);
    const levelBlock = level
        ? `<div class="pollutant__level" style="color:${level.color}">${level.label}</div>`
        : '<div class="pollutant__level" style="color:#9ca3af">нет данных</div>';
    const tooltip = `${info.name} (${info.tech}). ${info.desc} Источники: ${info.sources}`;
    return `<div class="pollutant" title="${tooltip.replace(/"/g, '&quot;')}">
        <div class="pollutant__name">${info.name}</div>
        <div class="pollutant__tech">${info.tech}</div>
        <div class="pollutant__value">${valDisplay} <span class="pollutant__unit">мкг/м³</span></div>
        ${levelBlock}
    </div>`;
}

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

const markers = {};
let stationsById = {};
let selectedStationId = null;

function formatTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diffMin = Math.max(0, Math.round((now - d) / 60000));

    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `${diffMin} мин назад`;

    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ч назад`;

    return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
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

function getFreshnessInfo(isoString) {
    if (!isoString) {
        return {
            className: 'status--stale',
            text: 'данные отсутствуют',
            footerText: 'Данные отсутствуют',
        };
    }

    const d = new Date(isoString);
    const now = new Date();
    const diffMin = Math.max(0, Math.round((now - d) / 60000));

    if (diffMin <= 90) {
        return {
            className: 'status--ok',
            text: 'актуально',
            footerText: `Последнее измерение: ${formatTime(isoString)}`,
        };
    }

    if (diffMin <= 180) {
        return {
            className: 'status--warn',
            text: 'обновление задерживается',
            footerText: `Последнее измерение: ${formatTime(isoString)} · обновление задерживается`,
        };
    }

    return {
        className: 'status--stale',
        text: 'данные устарели',
        footerText: `Последнее измерение: ${formatTime(isoString)} · данные устарели`,
    };
}

function buildMarkerIcon(station) {
    const hasData = station.aqi_us !== null && station.aqi_us !== undefined;
    const color = hasData ? aqiColor(station.aqi_category) : '#9ca3af';
    const text = hasData ? String(station.aqi_us) : '—';

    return L.divIcon({
        className: 'aqi-marker-wrapper',
        html: `<div class="aqi-marker" style="background:${color}">${text}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });
}

function upsertMarker(station) {
    const icon = buildMarkerIcon(station);

    if (markers[station.id]) {
        markers[station.id].setLatLng([station.latitude, station.longitude]);
        markers[station.id].setIcon(icon);

        if (markers[station.id].getTooltip()) {
            markers[station.id].setTooltipContent(station.name);
        }

        markers[station.id].off('click');
        markers[station.id].on('click', () => showStationDetails(stationsById[station.id]));
        return;
    }

    const marker = L.marker([station.latitude, station.longitude], { icon })
        .addTo(map)
        .bindTooltip(station.name, { direction: 'top', offset: [0, -10] });

    marker.on('click', () => showStationDetails(stationsById[station.id]));
    markers[station.id] = marker;
}

function showStationDetails(station) {
    selectedStationId = station.id;

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
                <p>Данные появятся после первого опроса Open-Meteo.</p>
            </div>
        `;
        return;
    }

    const color = aqiColor(station.aqi_category);
    const label = aqiLabel(station.aqi_category);
    const freshness = getFreshnessInfo(station.latest_time);

    content.innerHTML = `
        <div class="station-details">
            <div class="station-details__time ${freshness.className}">
                Обновлено: ${formatTime(station.latest_time)} · ${freshness.text}
            </div>

            <div class="aqi-box" style="background:${color}">
                <div class="aqi-box__value">${station.aqi_us}</div>
                <div class="aqi-box__label">${label}</div>
            </div>

            <div class="pollutant-grid">
                ${pollutantCard('pm25', station.pm25)}
                ${pollutantCard('pm10', station.pm10)}
                ${pollutantCard('co', station.co)}
                ${pollutantCard('no2', station.no2)}
                ${pollutantCard('so2', station.so2)}
                ${pollutantCard('o3', station.o3)}
            </div>
        </div>
    `;
}

async function loadStations() {
    try {
        const response = await fetch(`${API_BASE}/stations`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const stations = await response.json();
        const seenIds = new Set();

        stations.forEach(station => {
            seenIds.add(String(station.id));
            stationsById[station.id] = station;
            upsertMarker(station);
        });

        Object.keys(markers).forEach(id => {
            if (!seenIds.has(String(id))) {
                map.removeLayer(markers[id]);
                delete markers[id];
                delete stationsById[id];
                if (selectedStationId === Number(id)) {
                    selectedStationId = null;
                }
            }
        });

        const latest = stations
            .map(s => s.latest_time)
            .filter(Boolean)
            .sort()
            .pop();

        const updateEl = document.getElementById('last-update');
        if (updateEl) {
            const freshness = getFreshnessInfo(latest);
            updateEl.className = `footer__update ${freshness.className}`;
            updateEl.textContent = freshness.footerText;
        }

        if (selectedStationId !== null && stationsById[selectedStationId]) {
            showStationDetails(stationsById[selectedStationId]);
        }

        console.log(`atyair: loaded ${stations.length} stations`);
    } catch (error) {
        console.error('atyair: failed to load stations', error);
        const updateEl = document.getElementById('last-update');
        if (updateEl) {
            updateEl.className = 'footer__update status--stale';
            updateEl.textContent = 'Ошибка загрузки данных';
        }
    }
}

loadStations();
setInterval(loadStations, REFRESH_INTERVAL_MS);
