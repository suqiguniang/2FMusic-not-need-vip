## 快速定位（给 AI 代码助手）

- 入口与运行
  - 服务入口: `app/server/app.py`（这是主要的单体 Flask 服务）。
  - 本地启动（仓库 README 中示例）:
    - 在类 Unix: `python3 app/server/app.py --music-library-path ./Music --log-path ./app.log --port 23237 --password 123456`
    - 在 Windows PowerShell 下同样运行 `python app/server/app.py ...`（注意 Python 可执行名）。

- 部署与容器
  - 提供 `docker-compose.yml` 示例，容器内把当前目录挂载到 `/app/data`，端口映射默认 23237。

- 代码布局要点
  - `app/server/app.py`: 单体服务实现，包含路由、静态资源版本控制（`static_url`、`ensure_static_version`）、文件监听、数据库路径等。
  - `app/server/lib/`: vendored/打包依赖（源码模式下通过 sys.path 加载），不要移除直接依赖，修改之前优先查 `requirements.txt`。
  - `app/server/mod/`: 项目内部模块（例如 `mod.search_all` 在测试中被直接调用）。
  - 前端资源: `www/templates/`（Jinja 模板）和 `www/static/`（JS/CSS/图片）。静态文件使用 MD5 查询参数版本化，Service Worker 管理图片和 manifest。

- 数据与运行时约定
  - SQLite 数据库位于: `MUSIC_LIBRARY_PATH/data.db`（由运行参数或环境变量 `MUSIC_LIBRARY_PATH` 控制）。
  - 环境变量/命令行优先级: `--port` / `--music-library-path` 等参数会覆盖对应的环境变量（例如 `PORT`, `APP_PASSWORD`, `APP_SECRET_KEY`）。
  - 打包模式 vs 源码模式: 代码通过 `getattr(sys,'frozen',False)` 判断运行上下文；当打包为单个二进制时，BASE_DIR 基于可执行文件位置，且不会再插入 `lib` 到 sys.path。

- 集成点与外部依赖
  - NetEase API: 代码中 `NETEASE_API_BASE_DEFAULT = 'http://localhost:23236'`，默认期望本地运行的 NetEase 服务（需要单独启动或在容器中配置）。
  - 主要 Python 依赖见 `app/server/requirements.txt`（Flask, mutagen, requests, watchdog, aiohttp 等）。

- 运行时行为与约定（能帮助改动或调试）
  - 文件监听: 使用 `watchdog` 的 `Observer` + `MusicFileEventHandler`；监听目录由 DB 中 `mount_points` 决定，变更会触发 `index_single_file`。
  - 静态资源版本: `get_file_md5()` 用于组合前端版本戳，`ensure_static_version()` 会在无 `v` 参数时重定向到带 MD5 的 URL；画像/manifest/Service Worker 被视为例外。
  - 日志: 默认写入命令行指定或环境变量指定的 `log_path`（示例: `--log-path ./app.log`）。

- 测试与开发习惯
  - 仓库包含简单的验证脚本而非 pytest 框架（例如 `app/server/test_search_all.py`, `test_kugou_search.py` 等）。这些是直接运行的脚本，用来手工验证 `mod` 中的搜索功能。
  - 本地测试步骤推荐：创建并激活虚拟环境，然后 `pip install -r app/server/requirements.txt`，再 `python app/server/test_search_all.py`。

- 编辑与变更注意事项（针对 AI 代码修改）
  - 修改依赖：如果改动依赖（更新/新增包），同时更新 `app/server/requirements.txt`。不要仅编辑 `app/server/lib/` 下的 vendored 包，除非确实需要临时补丁，并在 PR 描述中说明。
  - 前端资源更改：修改 `www/static/` 的 JS/CSS 后，ensure_static_version 的 MD5 机制会影响缓存；如需强制刷新，更新文件内容或清理缓存参数。
  - 数据变动：对索引/扫描逻辑做改动时，注意 `SCAN_STATUS` 全局结构与 `LIBRARY_VERSION` 的更新（前端依赖版本戳来刷新视图）。

- 快速示例引用（可直接跳转查看）
  - 路由与静态版本：`app/server/app.py` 中的 `static_url`、`ensure_static_version`。
  - 文件监听与索引：`MusicFileEventHandler`、`init_watchdog()`、`refresh_watchdog_paths()`（同文件）。
  - 依赖声明：`app/server/requirements.txt`。
  - 测试脚本示例：`app/server/test_search_all.py`（直接调用 `mod.search_all`）。

如果有希望我补充的部分（例如：添加典型 PR 模板、列出常见调试命令、或把测试迁移到 pytest 的建议与改动），告诉我要重点完善的方向，我会据此迭代此说明文档。
