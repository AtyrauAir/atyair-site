/* =============================================================================
   atyair — логика фронтенда
   Карта Leaflet + загрузка данных с /api/*
   v20260422a — техдолг закрыт: убраны дублирующиеся функции
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

// =============================================================================
// Вспомогательные функции
// =============================================================================

function pollutantLevel(value, thresholds) {
    if (value === null || value === undefined) return null;
    if (value <= thresholds[0]) return { code: 'good',     label: 'норма',         color: '#16a34a' };
    if (value <= thresholds[1]) return { code: 'moderate', label: 'чуть повышено', color: '#ca8a04' };
    if (value <= thresholds[2]) return { code: 'high',     label: 'повышено',      color: '#ea580c' };
    return                             { code: 'hazard',   label: 'опасно',         color: '#dc2626' };
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
    return `<div class="pollutant" data-tooltip="${tooltip.replace(/"/g, '&quot;')}">
        <div class="pollutant__name">${info.name}</div>
        <div class="pollutant__tech">${info.tech}</div>
        <div class="pollutant__value">${valDisplay} <span class="pollutant__unit">мкг/м³</span></div>
        ${levelBlock}
    </div>`;
}

function aqiColor(category) {
    return AQI_COLORS[category] || '#9ca3af';
}

function aqiLabel(category) {
    return AQI_LABELS[category] || 'Нет данных';
}

function aqiCategoryFromValue(aqi) {
    if (aqi === null || aqi === undefined) return null;
    if (aqi <= 50)  return 'good';
    if (aqi <= 100) return 'moderate';
    if (aqi <= 150) return 'unhealthy_sensitive';
    if (aqi <= 200) return 'unhealthy';
    if (aqi <= 300) return 'very_unhealthy';
    return 'hazardous';
}

function avgDefined(values) {
    const arr = values.filter(v => v !== null && v !== undefined && !Number.isNaN(Number(v)));
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + Number(b), 0) / arr.length;
}

function formatTime(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const now = new Date();
    const diffMin = Math.max(0, Math.round((now - d) / 60000));

    if (diffMin < 1)  return 'только что';
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

// =============================================================================
// Карта Leaflet
// =============================================================================

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

// =============================================================================
// Сайдбар — детали станции
// =============================================================================

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

// =============================================================================
// Сайдбар — сводка по городу (показывается до выбора точки)
// =============================================================================

function showCitySummary(stations) {
    const content = document.getElementById('sidebar-content');
    const header = document.querySelector('.sidebar__header');

    if (!content || !header || !stations || !stations.length) return;

    const avgAQI = avgDefined(stations.map(s => s.aqi_us));
    const avgPM25 = avgDefined(stations.map(s => s.pm25));
    const avgPM10 = avgDefined(stations.map(s => s.pm10));
    const avgCO   = avgDefined(stations.map(s => s.co));
    const avgNO2  = avgDefined(stations.map(s => s.no2));
    const avgSO2  = avgDefined(stations.map(s => s.so2));
    const avgO3   = avgDefined(stations.map(s => s.o3));

    const latest = stations
        .map(s => s.latest_time)
        .filter(Boolean)
        .sort()
        .pop();

    const freshness = getFreshnessInfo(latest);
    const category = aqiCategoryFromValue(avgAQI);
    const color = aqiColor(category);
    const label = aqiLabel(category);

    header.innerHTML = `
        <h2 class="sidebar__title">Среднее по Атырау</h2>
        <p class="sidebar__subtitle">
            ${stations.length} точек · общий фон загрязнения по городу
        </p>
    `;

    content.innerHTML = `
        <div class="station-details">
            <div class="station-details__time ${freshness.className}">
                Обновлено: ${formatTime(latest)} · ${freshness.text}
            </div>

            <div class="aqi-box" style="background:${color}">
                <div class="aqi-box__value">${avgAQI !== null ? Math.round(avgAQI) : '—'}</div>
                <div class="aqi-box__label">${label}</div>
            </div>

            <div class="pollutant-grid">
                ${pollutantCard('pm25', avgPM25)}
                ${pollutantCard('pm10', avgPM10)}
                ${pollutantCard('co', avgCO)}
                ${pollutantCard('no2', avgNO2)}
                ${pollutantCard('so2', avgSO2)}
                ${pollutantCard('o3', avgO3)}
            </div>
        </div>
    `;
}

// =============================================================================
// Загрузка данных со станций
// =============================================================================

async function loadStations() {
    try {
        const response = await fetch(`${API_BASE}/stations`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const stations = await response.json();

        // Средний AQI по городу — шапка
        const aqiValues = stations
            .map(s => s.aqi_us)
            .filter(v => v !== null && v !== undefined);

        if (aqiValues.length) {
            const avgAQI = Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length);
            const el = document.getElementById('aqi-summary');
            if (el) el.textContent = `AQI: ${avgAQI}`;
        }

        // Обновляем маркеры на карте
        const seenIds = new Set();

        stations.forEach(station => {
            seenIds.add(String(station.id));
            stationsById[station.id] = station;
            upsertMarker(station);
        });

        // Удаляем маркеры исчезнувших станций
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

        // Обновляем футер
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

        // Сайдбар: детали выбранной станции или сводка по городу
        if (selectedStationId !== null && stationsById[selectedStationId]) {
            showStationDetails(stationsById[selectedStationId]);
        } else {
            showCitySummary(stations);
        }

        console.log(`atyair: загружено ${stations.length} станций`);
    } catch (error) {
        console.error('atyair: ошибка загрузки станций', error);
        const updateEl = document.getElementById('last-update');
        if (updateEl) {
            updateEl.className = 'footer__update status--stale';
            updateEl.textContent = 'Ошибка загрузки данных';
        }
    }
}

loadStations();
setInterval(loadStations, REFRESH_INTERVAL_MS);


// =============================================================================
// WIND — слой потока ветра (leaflet-velocity) + плашка на карте
// =============================================================================

let windVelocityLayer = null;

// Шкала цветов: плавный градиент от штиля к шторму.
// Порядок стопов — равномерно от minVelocity до maxVelocity внутри leaflet-velocity,
// библиотека сама интерполирует цвета между ними.
//   0 м/с — бледно-голубой (штиль виден на любой подложке)
//   5 м/с — зелёный
//   9 м/с — розовый
//  14 м/с — красный
const WIND_COLOR_SCALE = [
    'rgba(208,232,255,0.92)',  // 0 м/с — бледно-голубой
    'rgba(0,230,118,0.95)',    // ~5 м/с — зелёный
    'rgba(255,79,163,0.95)',   // ~9 м/с — розовый
    'rgba(255,23,68,0.98)',    // 14+ м/с — красный
];

function windRegime(speed) {
    if (speed === null || speed === undefined) return { label: '—', color: '#9ca3af' };
    if (speed < 2) return { label: 'штиль',   color: '#7cc4f0' };
    if (speed < 5) return { label: 'лёгкий',  color: '#34d399' };
    if (speed < 9) return { label: 'свежий',  color: '#f472b6' };
    return                  { label: 'сильный', color: '#f87171' };
}

function windDirLabel(deg) {
    if (deg === null || deg === undefined) return '';
    const labels = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return labels[Math.round(deg / 45) % 8];
}

// Плашка ветра — Leaflet control в правом нижнем углу карты
const WindBadgeControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function() {
        const d = L.DomUtil.create('div', 'atyair-wind-badge');
        d.innerHTML = `
            <svg class="atyair-wind-arrow" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2 L16 10 L12 8 L8 10 Z" fill="currentColor"/>
            </svg>
            <span class="atyair-wind-text">—</span>
        `;
        this._el = d;
        return d;
    },
    update: function(speed, direction) {
        if (!this._el) return;
        const text = this._el.querySelector('.atyair-wind-text');
        const arrow = this._el.querySelector('.atyair-wind-arrow');
        if (speed === null || speed === undefined) {
            text.textContent = 'нет данных';
            arrow.style.display = 'none';
            return;
        }
        const dirName = windDirLabel(direction);
        const regime = windRegime(speed);
        text.textContent = `${speed.toFixed(1)} м/с · ${dirName}`;
        arrow.style.display = '';
        // Стрелка указывает КУДА дует: направление движения = direction + 180.
        // В SVG острый конец смотрит вверх (0°), поэтому поворот = (direction + 180).
        const rot = ((direction ?? 0) + 180) % 360;
        arrow.style.transform = `rotate(${rot}deg)`;
        this._el.style.borderColor = regime.color;
    }
});

const windBadge = new WindBadgeControl();
windBadge.addTo(map);

async function loadWindField() {
    try {
        const r = await fetch('/api/wind-field', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!Array.isArray(data) || data.length < 2) {
            console.warn('atyair: пустая сетка ветра, слой не обновляется');
            return;
        }

        if (windVelocityLayer) {
            map.removeLayer(windVelocityLayer);
        }
        windVelocityLayer = L.velocityLayer({
            displayValues: false,
            data: data,
            maxVelocity: 14,
            minVelocity: 0,
            velocityScale: 0.008,
            particleAge: 90,
            lineWidth: 1.4,
            particleMultiplier: 0.014,
            colorScale: WIND_COLOR_SCALE,
        });
        windVelocityLayer.addTo(map);
    } catch (e) {
        console.error('atyair: не удалось загрузить поле ветра', e);
    }
}

async function loadWind() {
    try {
        const r = await fetch('/api/wind', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        windBadge.update(data.speed, data.direction);
    } catch (e) {
        console.error('atyair: ошибка загрузки скорости ветра', e);
    }
}

loadWind();
loadWindField();
setInterval(loadWind, 5 * 60 * 1000);
setInterval(loadWindField, 30 * 60 * 1000);

// =============================================================================
// ADD SENSOR BUTTON
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('add-sensor-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        window.open('https://t.me/AtyAir', '_blank');
    });
});
