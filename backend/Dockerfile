# =============================================================================
# atyair backend — Docker образ
# =============================================================================

# Базовый образ: Python 3.12 на тонком Debian (slim)
# ~ 50 МБ базовый размер, быстро пересобирается
FROM python:3.12-slim

# Переменные окружения для Python
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Системные пакеты, нужные для сборки зависимостей и работы
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем рабочую директорию внутри контейнера
WORKDIR /app

# Копируем только requirements.txt и устанавливаем зависимости
# Это делается отдельным слоем для кеширования — если код меняется,
# но зависимости те же, Docker не пересобирает этот слой
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Копируем код приложения
COPY ./app ./app

# Создаём непривилегированного пользователя для безопасности
# (если контейнер взломают — не получат root на хосте)
RUN useradd --create-home --shell /bin/bash atyair && \
    chown -R atyair:atyair /app
USER atyair

# Порт, на котором будет слушать FastAPI внутри контейнера
EXPOSE 8000

# Команда запуска:
# uvicorn запускает FastAPI-приложение app.main:app на всех интерфейсах
# --workers 2 — два параллельных рабочих процесса (для 8 ГБ RAM и 2 CPU)
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--log-level", "info", \
     "--access-log", \
     "--proxy-headers", \
     "--forwarded-allow-ips", "*"]
