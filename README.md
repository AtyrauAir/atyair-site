# atyair — независимый мониторинг качества воздуха в Атырау

Сайт: https://atyair.org

Независимый некоммерческий проект мониторинга качества воздуха в городе Атырау, Казахстан.

## Что делает проект

- Отображает карту Атырау с 8 точками мониторинга
- Показывает PM2.5, PM10, CO, NO2, SO2, O3 и US AQI
- Данные обновляются каждый час
- Источник данных: Open-Meteo Air Quality API (Copernicus CAMS)

## Технологии

- Backend: Python, FastAPI, PostgreSQL + TimescaleDB
- Frontend: HTML, CSS, JavaScript, Leaflet.js
- Infrastructure: Docker, Nginx, Let's Encrypt
- Hosting: VPS Ubuntu 24.04

## Запуск

1. Скопируй `.env.example` в `.env` и заполни секреты
2. `docker compose up -d`

## Лицензия

Copyright (c) 2026 AtyrauAir Project. All rights reserved.
