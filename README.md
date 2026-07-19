# 🤖 Autonomous AI Browser Agent

<div align="center">
  
  ![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)
  ![Chrome](https://img.shields.io/badge/platform-Chrome_Manifest_V3-34A853.svg)
  ![Gemini](https://img.shields.io/badge/AI-Google_Gemini-4285F4.svg)

  *An AI-powered automation assistant that turns your browser into an agent.*

  <br>

  <a href="https://youtu.be/j1oFcvMeUs8?si=25S0Y7nhc0VpQaIg" target="_blank">
    <img src="./assets/thumbnail.png" alt="Watch the demo" width="600px">
  </a>
  
  <p><i>Click the thumbnail above to watch the demo</i></p>
</div>

---

## 🚀 Features

- **HUD Command Interface:** Hold `P` to invoke the HUD. No more context switching.
- **Agentic Planning:** Uses Google Gemini to map natural language to specific `GOTO`, `CLICK`, and `TYPE` actions.
- **Self-Healing Loop:** Implements a 3-retry error recovery strategy with screenshot re-analysis.
- **Deep Reasoning:** `THINK_AND_REQUERY` allows the agent to visually re-evaluate the page mid-task.
- **Secure by Design:** API keys are stored in encrypted `chrome.storage.sync`.
- **Persistent State:** Plans persist through reloads, ensuring continuity for multi-step workflows.

## 🛠 Tech Stack

| Layer | Tech |
|-------|------|
| Extension platform | Chrome Manifest V3 |
| AI | Google Gemini API (gemini-2.5-flash) |
| Storage | chrome.storage.local (plans, variables), chrome.storage.sync (API key) |
| UI | Vanilla JS, inline CSS, HUD overlay |
| Permissions | storage, history, tabCapture, \<all_urls\> |

## ⚡ Quick Start

1. Clone or download this repo
2. Open `chrome://extensions/` → Enable **Developer mode** → **Load unpacked**
3. Select the project folder (the one containing `manifest.json`)
4. Right-click the extension icon → **Options** → paste your [Gemini API key](https://aistudio.google.com/app/apikey)

## Usage

1. Go to any webpage
2. **Hold P** for ~350ms until the HUD appears at the top
3. Type your request (e.g. *"search YouTube for piano tutorials"*, *"open Gmail"*, *"what is the capital of Canada"*)
4. Press **Enter**
5. The extension executes the plan and shows the result in the HUD

Press **Escape** anytime to close the HUD.

## 🏗 Project Architecture

```
├── manifest.json          # Extension config
├── settings.html          # Options page (API key)
├── assets/
│   └── style.css          # HUD styles
└── content/
    ├── background.js      # Service worker: AI calls, screenshots
    ├── ui.js              # HUD DOM + show/hide
    ├── main.js            # P-key activation, input capture, message to background
    └── actions.js         # Plan executor (GOTO, CLICK, TYPE, etc.)
```

## Available AI Actions

- `GOTO` — Navigate to URL  
- `CLICK` — Click element by text  
- `TYPE` — Fill input, supports `value_from` (from ASK_USER_INPUT)  
- `WAIT` — Delay in seconds  
- `ASK_USER` — Multiple choice prompt  
- `ASK_USER_INPUT` — Text input prompt  
- `EXTRACT` — Pull data from page  
- `THINK_AND_REQUERY` — Pause, screenshot, get new plan from AI  
- `FINAL_ANSWER` — Show result and end  
