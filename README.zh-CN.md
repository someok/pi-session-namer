# pi-session-namer

[Pi](https://github.com/badlogic/pi-mono) 的自动会话命名扩展。

插件会根据当前对话内容，为 Pi session 自动生成并定期更新名称，格式为：

```text
MMDD｜类型｜主题
```

命名模型会根据对话的主要语言决定类型和主题所使用的语言：

```text
0310｜修复｜处理 OAuth 回调错误
0310｜Fix｜Handle OAuth callback errors
```

[English documentation / 英文文档](README.md)

## 功能

- 首轮 agent 运行结束后自动命名。
- session 压缩后重新判断当前任务。
- 不在每轮调用模型，按配置周期检查任务是否发生明显变化。
- 插件命令说明、状态提示、警告和错误统一使用英文。
- session 的类型和主题使用当前对话的主要语言。
- 主题变化时保持 session 创建日期不变。
- 默认使用操作系统时区，也支持配置 IANA 时区。
- 默认使用当前主 agent 模型，也支持配置独立的命名模型。
- 默认继承主 agent 的思考强度，也支持配置固定思考强度。
- 用户通过 `/name` 设置名称后，自动命名会被锁定。
- 将命名状态和有限的名称历史持久化到 session 中。

## 安装

在仓库中本地测试：

```bash
pi -e ./src/index.ts
```

从 Git 安装为 Pi package：

```bash
pi install git:<用户名>/pi-session-namer
```

从本地目录安装：

```bash
pi install D:/AI/agentBySelf/pi-extensions/pi-session-namer
```

安装或修改源码后，重新启动 Pi，或执行：

```text
/reload
```

## 命令

| 命令 | 行为 |
| --- | --- |
| `/session-name-refresh` | 分析当前对话，并在适当时更新名称。会显示开始提示和完成结果，不会绕过锁定。 |
| `/session-name-lock` | 锁定当前名称，不调用模型。 |
| `/session-name-unlock` | 解除自动命名锁定，不调用模型，也不会自动刷新名称；需要时再执行 `/session-name-refresh`。 |
| `/session-name-status` | 显示当前名称、锁定状态和下一次周期检查状态。 |

session 被锁定后，所有自动更新都会跳过。

## 配置

插件首次加载时，如果全局配置文件不存在，会自动创建：

```text
~/.pi/agent/session-namer.json
```

插件不会覆盖已有配置文件。默认内容为：

```json
{
  "model": "inherit",
  "thinkingLevel": "inherit",
  "timeZone": "auto",
  "checkEveryTurns": 4
}
```

完整示例见 [`session-namer.example.json`](session-namer.example.json)。

### 配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `model` | `inherit` | 使用主 agent 模型，也可以指定 `provider/modelId`。指定模型不可用时回退到主 agent 模型。 |
| `thinkingLevel` | `inherit` | 继承主 agent 当前思考强度，也可以设置 `low`、`medium`、`high` 等固定等级。 |
| `timeZone` | `auto` | 使用操作系统时区，也可以指定 `America/New_York` 等 IANA 时区。 |
| `checkEveryTurns` | `4` | 每 N 次 settled 的 agent 运行检查一次。设置为 `0` 可关闭普通周期检查，但保留首次命名、压缩后检查和手动刷新。 |

配置在插件启动时读取。修改配置后执行：

```text
/reload
```

### 思考强度

支持以下配置值：

```text
off, minimal, low, medium, high, xhigh, max, inherit
```

`inherit` 会在触发命名时读取主 agent 的当前思考等级。插件会根据 Pi 的模型元数据和已知 provider 格式处理思考参数；不支持的等级会降级到最近的可用等级，不支持 provider-specific 参数时不会伪造请求字段。

## 命名行为

命名模型只允许返回以下结果之一：

```text
KEEP
SKIP
类型｜主题
```

- `KEEP`：保留当前名称。
- `SKIP`：未命名 session 继续保持未命名；已有名称保持不变。
- `类型｜主题`：插件会为其补充程序确定的 session 日期。

语义类型包括：功能、设计、修复、优化、发布、探索、文档和研究。模型会将选定类型表达为当前对话使用的主要语言，不会强制使用中文或英文标签。

提示词要求模型在普通进展时保持原名称，只有主要任务发生明显变化时才更新名称。

命名上下文仅包含当前 session 文本、压缩摘要和工具名称，不发送工具参数和工具结果。插件不做额外敏感信息脱敏，请根据隐私要求选择 provider。

## 开发

安装开发依赖并执行检查：

```bash
npm install
npm test
npx tsc --noEmit
```

单元测试不会调用真实 provider，也不需要 API key。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
