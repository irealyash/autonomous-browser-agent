/**
 * Speedy AI Agent - HUD (Heads-Up Display) UI Module
 * Creates and manages the floating command bar overlay
 */

// HUD API - show/hide the overlay with custom content
window.HUD = {
    show: (text) => {
        const textEl = document.getElementById('hud-text');
        const hudEl = document.getElementById('speedy-hud');
        if (textEl) textEl.innerText = text;
        if (hudEl) hudEl.classList.add('active');
    },
    hide: () => {
        const hudEl = document.getElementById('speedy-hud');
        if (hudEl) hudEl.classList.remove('active');
    }
};

// Inject HUD DOM into page - runs at document_start for immediate availability
const initHUD = () => {
    if (document.getElementById('speedy-hud')) return;

    const hud = document.createElement('div');
    hud.id = 'speedy-hud';
    // Search icon SVG + text area with blinking cursor
    hud.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 20 20" fill="none" style="flex-shrink:0; margin-top: 2px;">
            <circle cx="9" cy="9" r="6" stroke="white" stroke-width="1.5" opacity="0.5"/>
            <line x1="13.5" y1="13.5" x2="17" y2="17" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
        </svg>
        <div style="display: flex; align-items: center; margin-left: 15px;">
            <span id="hud-text"></span>
            <div class="cursor"></div> 
        </div>
    `;
    document.body.appendChild(hud);
};

// Init as soon as DOM allows (content script runs at document_start)
if (document.body) initHUD();
else document.addEventListener('DOMContentLoaded', initHUD);