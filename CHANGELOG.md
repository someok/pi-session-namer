# Changelog

pi 会读取这个文件，在包更新后的下次启动里显示「Extension Updates」。

## [0.4.1] - 2026-11-04

### Changed

- 对齐 pi 1.5.0 的扩展契约：`@earendil-works/pi-ai` 与 `pi-coding-agent` 的 `devDependencies` 从 0.84.4 升到 1.5.0，类型检查对齐当前运行版本。
- 启用扩展更新日志：新增本文件，并在 `package.json` 里声明 `pi.changelogPath`。
- `session_info_changed`、`agent_settled`、`ctx.modelRegistry.complete()` 等用到的 API 在 1.5.0 均未变更。

## [0.4.0] - 2026-10-28

### Added

- 按当前对话自动为会话命名，支持 `Feature` / `Design` / `Fix` 等类型前缀。
- `/session-name-refresh` 手动刷新名称，可用 `force` 重新评估类型与主题。
- `/session-name-lock` / `/session-name-unlock` 手动锁定或恢复自动命名。
- `/session-name-status` 查看当前名称、锁定状态与下次检查时机。
- 按轮次或压缩事件触发更新，可配置命名模型与检查频率。
