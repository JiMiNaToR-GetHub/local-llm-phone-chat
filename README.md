![Local LLM Phone Chat Banner](./banner.png)

# 📱 Local LLM Phone Chat

A mobile-first, agentic web UI for local LLMs (LM Studio). Built for accessing your local models securely from your phone over Tailscale, with a sleek Xiaomi HyperOS-inspired design.

## ✨ Features

- **Mobile-First Design**: HyperOS dark theme, Material 3 icons, glassmorphism, and squircle corners.
- **Agentic Tool Calling**: Run models (like Gemma 4 or Qwen 3) with a full toolset to read, write, and edit files, execute PowerShell commands, and search the web.
- **Safety First**: 
  - Strict path sandboxing.
  - Syntax validation and atomic backups before file writes.
  - Confirmation modals (Allow / Cancel / Allow All) for risky commands.
- **Live Status & Metrics**: A wake/ready indicator, real-time agent status (Reasoning, Writing, Running tool), and a live CPU/GPU/VRAM bar during generation.
- **NCM Planning**: Experimental Next-Concept Modeling toggle for coarse-to-fine reasoning.
- **Remote Power Control**: Hibernate the PC remotely, and get a handy reminder to use your Termux:Widget for Wake-on-LAN.
- **Rich UI**: Markdown rendering, syntax-highlighted code blocks with copy buttons, multi-file attachments, and smart auto-scrolling.
- **Live Metrics**: Displays CPU, GPU compute, and VRAM usage while the model is generating.
- **Secure**: Designed to run behind Tailscale with automatic HTTPS certificates.

## 🛠️ Architecture

```text
 Phone (PWA)                        PC (Local Server)
 ┌──────────────────┐   Tailscale   ┌─────────────────────────────┐
 │  Browser / App   │ ────────────► │ node server.js (HTTPS :8080)│
 │                  │   encrypted   │   ├─► LM Studio API (:1235) │
 └──────────────────┘               │   └─► File System Sandbox   │
                                    └─────────────────────────────┘
```

### Codebase Structure
```text
├── server.js               # Entry point (HTTPS server, proxy, static files)
├── lib/
│   └── utils.js            # Logging, path validation, proxy logic
├── routes/
│   └── api.js              # All /api/* endpoints (tools, projects, metrics)
├── index.html              # UI structure
├── styles.css              # HyperOS design system
├── app.js                  # Frontend logic (agent loop, UI, tools)
├── marked.min.js           # Local Markdown parser
├── metrics.ps1             # PowerShell script for system metrics
├── manifest.json / sw.js   # PWA configuration
└── config.json             # Local configuration (gitignored)
```

## 🚀 Setup

### Prerequisites
- **Node.js** (v18+)
- **LM Studio** running a local server on port `1235`
- (Optional) **Tailscale** for secure remote access

### 1. Clone the repository
```bash
git clone https://github.com/JiMiNaToR-GetHub/local-llm-phone-chat.git
cd local-llm-phone-chat
```

### 2. Configure
Copy `config.example.json` to `config.json` and adjust the paths:
```json
{
  "port": 8080,
  "apiHost": "127.0.0.1",
  "apiPort": 1235,
  "workspaceRoot": "G:\\Local_LLM_Storage",
  "certPath": "./cert",
  "bionicInternalPath": "C:\\Users\\YOUR_USER\\.lmstudio\\apps\\bionic\\.internal"
}
```

### 3. HTTPS Certificates
The server expects TLS certificates for HTTPS (required for Wake Lock, Clipboard, and PWA features). 
If you use Tailscale, generate them with:
```bash
tailscale cert your-machine.tailnet.ts.net
```
Then set `"certPath": "./your-machine.tailnet.ts.net"` in `config.json`.

### 4. Start the server
```bash
node server.js
```

Open `https://your-machine.tailnet.ts.net:8080` on your phone.

## ⚠️ Security Disclaimer

This project is designed to give an LLM **direct access to your file system and shell**. 
- Always run it behind a secure network (like Tailscale). Do not expose it to the public internet.
- The `run_command` and `delete_file` tools are protected by confirmation prompts, but you should still review the model's actions.
- The author is not responsible for any damage caused by autonomous agents.

## 📄 License

MIT License. See `LICENSE` for details.
