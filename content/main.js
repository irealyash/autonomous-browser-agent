/**
 * Speedy AI Agent - Main Input Handler
 * Activates command mode via P-key hold, captures typing, sends requests to AI
 */

let buffer = "";              // User's typed command
let isCommandMode = false;    // True when HUD is active and accepting input
let ignorePUntilRelease = false;  // Prevents P from being typed into buffer
let pHoldTimer = null;
const P_HOLD_DURATION = 350;  // ms to hold P before activating

// Toggle cursor blink animation in HUD
const setCursorBlinking = (isBlinking) => {
    const cursor = document.querySelector('.cursor');
    if (cursor) {
        if (isBlinking) cursor.classList.add('blinking');
        else cursor.classList.remove('blinking');
    }
};

let blinkTimer;

// Blink cursor after user stops typing for 150ms
const resetTimer = () => {
    clearTimeout(blinkTimer);

    // Start cursor blinking after user stops typing
    blinkTimer = setTimeout(() => {
        setCursorBlinking(true);
    }, 150);
};


// P-key hold detector - activates command mode after 350ms
document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "p" && !isCommandMode) {
        if (pHoldTimer) return;  // Ignore auto-repeat

        console.log("[Main] P key held, starting command mode...");
        pHoldTimer = setTimeout(() => {
            ignorePUntilRelease = true;
            isCommandMode = true;
            buffer = "";
            window.HUD.show("");
            setCursorBlinking(true);
            console.log("[Main] Command mode ACTIVATED");
        }, P_HOLD_DURATION);
    }
}, true);

document.addEventListener("keyup", (e) => {
    if (e.key.toLowerCase() === "p") {
        clearTimeout(pHoldTimer);
        pHoldTimer = null;

        ignorePUntilRelease = false;
    }
}, true);

// Append or remove character from buffer, update HUD
const handleTyping = (key) => {
    console.log("[Main] Typing:", key, "Buffer:", buffer);
    resetTimer()
    // Stop blinking immediately when a key is hit
    setCursorBlinking(false);

    if (key === "Backspace") {
        buffer = buffer.slice(0, -1);
    } else {
        buffer += key;
    }

    window.HUD.show(buffer);
};


// Capture-phase key handler - hijacks keystrokes when in command mode
document.addEventListener('keydown', (e) => {

    // Escape closes HUD and exits command mode
    if (e.key === "Escape") {
        buffer = "";
        window.HUD.hide();
        clearTimeout(pHoldTimer);
        pHoldTimer = null;
        isCommandMode = false;

        return;
    }

    if (!isCommandMode) return;

    // Hijack alphanumeric, Backspace, Space (skip P while ignorePUntilRelease)
    if (e.key.length === 1 || e.key === "Backspace" || e.key === " ") {
        if (
            (e.key.length === 1 || e.key === "Backspace" || e.key === " ") &&
            !(e.key.toLowerCase() === "p" && ignorePUntilRelease)
        ) {
            e.preventDefault();
            console.log("[Main] Key captured - isCommandMode:", isCommandMode, "Key:", e.key);
            handleTyping(e.key);
        }

    }

    // Enter submits command - sends to AI and executes plan
    if (e.key === "Enter" && buffer.length > 0 && isCommandMode) {
        e.preventDefault();
        const originalBuffer = buffer;

        buffer = "";
        isCommandMode = false;
        setCursorBlinking(false);

        window.HUD.show("Working...");

        console.log("input sent:", originalBuffer);

        chrome.storage.local.set({ originalUserInput: originalBuffer });
        chrome.runtime.sendMessage({
            type: "GET_AI_PLAN",
            input: originalBuffer,
            url: window.location.href
        }, (response) => {
            console.log("[Main] AI Response:", response);
            if (response?.plan) {
                console.log("[Main] Executing plan...");
                executePlan(response.plan);
            } else {
                console.error("[Main] Error:", response?.error);
                window.HUD.show("Error: " + (response?.error || "Unknown error"));
            }
        });

        return;
    }



}, true);  // Capture phase - runs before page scripts

// Ensure page can receive keyboard focus
window.onload = () => {
    document.body.focus();
};

// Also trigger focus if the user clicks anywhere
document.addEventListener('click', () => {
    document.body.focus();
});

// ASK_USER: Show choice buttons in HUD, return selected option
window.showHudSelection = (question, options) => {
    return new Promise((resolve) => {
        const hud = document.getElementById('speedy-hud');
        hud.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 10px; min-width: 300px;">
                <div style="font-weight: bold;">${question}</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${options.map(opt => `
                        <button class="hud-choice-btn">
                            ${opt}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
        
        hud.classList.add('active');
        hud.querySelectorAll('.hud-choice-btn').forEach((btn, index) => {
            btn.onclick = () => {
                hud.innerHTML = '';
                hud.classList.remove('active');
                resolve(options[index]);
            };
        });
    });
};

// ASK_USER_INPUT: Show text field in HUD, return value on Enter
window.showHudTextInput = (question, placeholder) => {
    return new Promise((resolve) => {
        const hud = document.getElementById('speedy-hud');
        hud.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 10px; min-width: 300px;">
                <div style="font-weight: bold;">${question}</div>
                <input type="text" id="hud-user-input" placeholder="${placeholder}" 
                       style="width: 100%; padding: 8px; box-sizing: border-box;">
            </div>
        `;
        hud.classList.add('active');
        const input = document.getElementById('hud-user-input');
        input.focus();
        input.onkeydown = (e) => {
            if (e.key === "Enter") {
                const val = input.value;
                hud.innerHTML = '';
                hud.classList.remove('active');
                resolve(val);
            }
        };
    });
};



