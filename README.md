# pi-session-namer

An automatic session naming extension for [Pi](https://github.com/badlogic/pi-mono).

It names and periodically updates Pi sessions based on the current conversation, using the following format:

```text
MMDD｜Type｜Topic
```

The naming model uses the conversation's primary language for both the type and topic:

```text
0310｜Fix｜Handle OAuth callback errors
0310｜修复｜处理 OAuth 回调错误
```

[中文文档 / Chinese documentation](README.zh-CN.md)

## Features

- Automatically names a session after the first agent run settles.
- Re-evaluates the current task after compaction.
- Periodically checks for a substantial task change without calling the model every turn.
- Keeps the session creation date stable when the topic changes.
- Uses English for extension commands, status messages, warnings, and errors.
- Generates the type and topic in the conversation's primary language.
- Uses the operating system timezone by default, with IANA timezone overrides.
- Uses the current primary agent model by default, with an optional dedicated naming model.
- Inherits the primary agent's thinking level by default, with an optional fixed level.
- Treats a user-set `/name` as a manual name and locks automatic updates.
- Persists naming state and a short name history in the session.

## Installation

Install from the local repository while developing:

```bash
pi -e ./src/index.ts
```

Install as a Pi package from npm:

```bash
pi install npm:pi-session-namer
```

Install as a Pi package from Git:

```bash
pi install git:github.com/joshua-zyy/pi-session-namer
```

For a local package installation:

```bash
pi install D:/AI/agentBySelf/pi-extensions/pi-session-namer
```

Restart Pi or run `/reload` after installation or source changes.

## Commands

| Command | Behavior |
| --- | --- |
| `/session-name-refresh` | Analyze the current conversation and update the name when appropriate. Shows a start message and a result. Does not bypass a lock. |
| `/session-name-lock` | Lock the current name. Does not call a model. |
| `/session-name-unlock` | Unlock automatic naming. Does not call a model or refresh the name. Run `/session-name-refresh` separately when needed. |
| `/session-name-status` | Show the current name, lock state, and next periodic-check status. |

Automatic updates are skipped while a session is locked.

## Configuration

On first load, the extension creates this global configuration file if it does not already exist:

```text
~/.pi/agent/session-namer.json
```

It never overwrites an existing file. The default configuration is:

```json
{
  "model": "inherit",
  "thinkingLevel": "inherit",
  "timeZone": "auto",
  "checkEveryTurns": 4
}
```

A complete example is available in [`session-namer.example.json`](session-namer.example.json).

### Configuration options

| Option | Default | Description |
| --- | --- | --- |
| `model` | `inherit` | Use the primary agent model, or specify `provider/modelId`. If the configured model is unavailable, the primary model is used as a fallback. |
| `thinkingLevel` | `inherit` | Follow the primary agent's current thinking level, or set a fixed level such as `low`, `medium`, or `high`. |
| `timeZone` | `auto` | Use the operating system timezone, or specify an IANA timezone such as `America/New_York`. |
| `checkEveryTurns` | `4` | Check every N settled agent runs. Set to `0` to disable periodic checks while keeping initial, compaction, and manual refresh behavior. |

Configuration is loaded when the extension starts. Run `/reload` after editing the file.

### Thinking levels

Supported configuration values are:

```text
off, minimal, low, medium, high, xhigh, max, inherit
```

`inherit` reads the primary agent's current level when naming is triggered. The extension uses Pi's model metadata and known provider formats where available; unsupported levels are reduced to the nearest supported level, and unsupported provider-specific parameters are omitted rather than fabricated.

## Naming behavior

The naming model may return only one of:

```text
KEEP
SKIP
Type｜Topic
```

- `KEEP` keeps the current name.
- `SKIP` leaves an unnamed session unnamed, or leaves the current name unchanged.
- `Type｜Topic` is combined with the program-generated session date.

The semantic type categories are Feature, Design, Fix, Optimization, Release, Exploration, Documentation, and Research. The model translates or expresses the selected category in the conversation's primary language instead of forcing English labels.

The prompt asks the model to keep the same name for ordinary progress and only rename when the main task changes substantially.

Naming context is limited to current session text, compaction summaries, and tool names. Tool arguments and tool results are not sent. The extension does not perform additional sensitive-data redaction; choose a provider according to your privacy requirements.

## Development

Install development dependencies and run the checks:

```bash
npm install
npm test
npx tsc --noEmit
```

Unit tests do not call a real provider or require an API key.

## License

MIT. See [LICENSE](LICENSE).
