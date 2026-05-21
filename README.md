# pi-tmux-history

**Pi extension** that captures tmux pane scrollback and injects it as context into the current conversation.

No more copy-pasting terminal output or re-explaining what happened in a previous session. Just `/tmux-history` and the agent sees what you see.

## Install

```bash
pi install git:github.com/metodn/pi-tmux-history
```

## Usage

| Command                               | Description                            |
| ------------------------------------- | -------------------------------------- |
| `/tmux-history`                       | Capture current pane's full scrollback |
| `/tmux-history %5`                    | Capture specific pane by ID            |
| `/tmux-history -n 200`                | Capture last 200 lines                 |
| `/tmux-history -p "error\|fail"`      | Capture and grep for pattern           |
| `/tmux-history -B 3 -A 10 -p "panic"` | Grep with context lines                |
| `/tmux-history --list`                | List all tmux panes                    |

### How it works

1. Uses `tmux capture-pane` to dump the pane scrollback
2. Optionally filters with `grep -E -B -A` if you specify a pattern
3. Injects the captured text as a custom message into the current pi conversation
4. The LLM agent now has that terminal context and can act on it

### Example workflow

```
You: I was debugging an issue in another terminal, can you help?

> /tmux-history %3 -p "error" -B 2 -A 5

Agent: [sees the captured error output from pane %3]
       The issue is a missing environment variable...
```

## Requirements

- [pi](https://pi.dev) coding agent
- tmux (running)

## License

MIT
