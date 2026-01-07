# 使用官方Python运行时作为基础镜像
FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制整个应用目录
COPY app/ ./app/

# 暴露端口
EXPOSE 23237

# 设置环境变量默认值
ENV PORT=23237
ENV APP_PASSWORD=
ENV MUSIC_LIBRARY_PATH=/app/Music
ENV LOG_PATH=/app/app.log

CMD ["python", "app/server/app.py"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT} || exit 1