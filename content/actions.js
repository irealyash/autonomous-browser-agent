/**
 * Speedy AI Agent - Execution Engine
 * Runs AI-generated plans: GOTO, CLICK, TYPE, WAIT, ASK_USER, EXTRACT, etc.
 * Handles auto-recovery on failure and THINK_AND_REQUERY for visual analysis
 */

// Resume interrupted plan after page reload (e.g. post-GOTO)
let isExecuting = false;
let failureAttempts = {}; // Track retry attempts per step

chrome.storage.local.get(["activePlan", "currentStep"], (data) => {
    if (data.activePlan && !isExecuting) {
        isExecuting = true;
        console.log("[Agent] Resuming stored plan...");
        executePlan(data.activePlan, data.currentStep || 0).finally(() => {
            isExecuting = false;
            failureAttempts = {}; // Reset on new plan
        });
    }
});

// Execute plan steps sequentially; supports resume from startStep
async function executePlan(plan, startStep = 0) {
    console.log("[Agent] Executing plan:", plan);

    await chrome.storage.local.set({
        activePlan: plan,
        currentStep: startStep
    });

    for (let i = startStep; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        console.log(`[Agent] Step ${i}:`, step);

        await chrome.storage.local.set({ currentStep: i });

        switch (step.action) {

            case "GOTO": {
                // Auto-detect: if already on target URL, skip navigation
                if (window.location.href.includes(step.url)) {
                    console.log("[Agent] Already on target URL, skipping GOTO navigation");
                    break;
                }

                await chrome.storage.local.set({ currentStep: i + 1 }); // Move to next step before reload
                window.location.href = step.url;
                return;  // Page reload triggers auto-resume
            }

            case "CLICK": {
                // Add delay to allow dynamic elements to render
                await sleep(300);
                
                const success = await window.Agent.smartClick(step.text);
                if (!success) {
                    console.log(`[Agent] CLICK failed for "${step.text}"`);
                    
                    // Check if this is a redundant search click (already submitted via TYPE)
                    const isRedundantSearchClick = 
                        step.text?.toLowerCase().includes('search') &&
                        step.description?.toLowerCase().includes('search button');
                    
                    if (isRedundantSearchClick) {
                        console.log("[Agent] Skipping redundant search button click (already submitted via TYPE)");
                        await sleep(500);
                        break; // Just skip, don't trigger auto-recovery
                    }
                    
                    // For non-search clicks, trigger auto-recovery
                    await autoRequeryOnError(
                        `CLICK failed: Could not find element "${step.text}" on page`,
                        i,
                        plan
                    );
                    return;
                }
                
                console.log(`[Agent] CLICK succeeded for "${step.text}"`);
                // Wait for click to process
                await sleep(500);
                break;
            }

            case "TYPE": {
                let value = step.value;

                if (step.value_from) {  // Use value from ASK_USER_INPUT/store_as
                    const stored = await chrome.storage.local.get(`var_${step.value_from}`);
                    value = stored[`var_${step.value_from}`];
                }

                if (value == null) {
                    await autoRequeryOnError(
                        `TYPE failed: missing value for ${step.text}`,
                        i,
                        plan
                    );
                    return;
                }

                // Wait for DOM to be ready before finding input
                await sleep(500);

                const input = window.Agent.findInputByLabel(step.text);
                if (!input) {
                    console.log(`[Agent] TYPE failed, triggering auto-recovery...`);
                    await autoRequeryOnError(
                        `TYPE failed: input not found (${step.text})`,
                        i,
                        plan
                    );
                    return;
                }

                console.log(`[Agent] Found input for "${step.text}", clearing and typing...`);
                
                // Clear any existing value first
                input.value = '';
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                
                await sleep(100);
                
                input.focus();
                
                // Simulate realistic keyboard input character by character
                for (let j = 0; j < value.length; j++) {
                    const char = value[j];
                    input.value += char;
                    
                    // Dispatch all keyboard events in proper order
                    input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
                    
                    await sleep(50); // Slightly slower for better event handling
                }
                
                // Verify text actually got entered
                console.log(`[Agent] Current input value: "${input.value}"`);
                if (input.value !== value) {
                    console.warn(`[Agent] WARNING: Input value mismatch! Expected: "${value}", Got: "${input.value}"`);
                }
                
                console.log(`[Agent] Typed: "${value}"`);
                
                // Final events to confirm input
                input.dispatchEvent(new Event("change", { bubbles: true }));
                input.dispatchEvent(new Event("blur", { bubbles: true }));
                
                // Auto-submit for search boxes (YouTube, Google, etc.)
                const isSearchBox = step.text?.toLowerCase().includes('search') || 
                                    input.placeholder?.toLowerCase().includes('search') ||
                                    input.type === 'search';
                
                if (isSearchBox) {
                    console.log("[Agent] Detected search box, waiting for submission...");
                    
                    await sleep(400); // Wait for input to settle and suggestions to load
                    
                    // Simply press Enter - most reliable method for search boxes
                    console.log("[Agent] Pressing Enter to submit search...");
                    input.focus();
                    const enterEvent = new KeyboardEvent("keydown", { 
                        key: "Enter", 
                        code: "Enter", 
                        bubbles: true, 
                        keyCode: 13,
                        which: 13,
                        cancelable: true
                    });
                    input.dispatchEvent(enterEvent);
                    await sleep(100);
                    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
                    
                    console.log("[Agent] Search submitted via Enter key");
                    await sleep(1000);
                }
                
                // Wait for page to process input/search
                await sleep(2500);
                
                // If next step is a redundant CLICK on the same search element, skip it
                if (i + 1 < plan.steps.length) {
                    const nextStep = plan.steps[i + 1];
                    const isRedundantClickNext = 
                        nextStep.action === "CLICK" &&
                        nextStep.text?.toLowerCase().includes('search') &&
                        isSearchBox;
                    
                    if (isRedundantClickNext) {
                        console.log("[Agent] Skipping next step (redundant search click already submitted)");
                        i++; // Skip the next CLICK step
                    }
                }
                
                break;
            }

            case "WAIT":
                await sleep(step.seconds * 1000);
                break;

            case "ASK_USER": {
                const choice = await showHudSelection(
                    step.question,
                    step.options || []
                );

                if (step.store_as) {
                    await chrome.storage.local.set({
                        [`var_${step.store_as}`]: choice
                    });
                }
                break;
            }

            case "ASK_USER_INPUT": {
                const value = await Promise.race([
                    showHudTextInput(
                        step.question,
                        step.placeholder || ""
                    ),
                    // 30 second timeout - if no input, auto-requery
                    new Promise((_, reject) =>  // 30s timeout triggers auto-recovery
                        setTimeout(() => reject(new Error("Input timeout - user did not respond")), 30000)
                    )
                ]).catch(async (err) => {
                    console.log(`[Agent] Input step timed out: ${err.message}`);
                    
                    // Auto-recovery: requery with screenshot
                    await autoRequeryOnError(
                        `ASK_USER_INPUT timeout: User may not need to provide input (already logged in or page state changed)`,
                        i,
                        plan
                    );
                    return null;
                });

                if (value === null) return;

                if (!step.store_as) {
                    await autoRequeryOnError(
                        "ASK_USER_INPUT missing store_as",
                        i,
                        plan
                    );
                    return;
                }

                await chrome.storage.local.set({
                    [`var_${step.store_as}`]: value
                });
                break;
            }

            case "EXTRACT": {
                try {
                    const value = window.Agent.extract(step.instruction);
                    if (!value) {
                        console.log(`[Agent] EXTRACT failed, triggering auto-recovery...`);
                        await autoRequeryOnError(
                            `EXTRACT failed: Could not extract data for "${step.instruction}"`,
                            i,
                            plan
                        );
                        return;
                    }
                    await chrome.storage.local.set({
                        [`extract_${step.variable_name}`]: value
                    });
                } catch (err) {
                    console.log(`[Agent] EXTRACT error, triggering auto-recovery...`);
                    await autoRequeryOnError(
                        `EXTRACT error: ${err.message}`,
                        i,
                        plan
                    );
                    return;
                }
                break;
            }

            case "THINK_AND_REQUERY": {
                try {
                    console.log("[Agent] THINK_AND_REQUERY: Capturing screenshot...");
                    const screenshot = await window.Agent.captureScreenshot();
                    
                    console.log("[Agent] THINK_AND_REQUERY: Screenshot captured, sending to AI...");

                    await requeryAI({
                        type: "THINK_AND_REQUERY",
                        reason: step.reason,
                        instruction: step.instruction,
                        completedSteps: plan.steps.slice(0, i),
                        currentStep: i,
                        screenshot: screenshot
                    });
                    
                    console.log("[Agent] THINK_AND_REQUERY: Request sent to AI");
                } catch (err) {
                    console.error("[Agent] THINK_AND_REQUERY error:", err);
                    await autoRequeryOnError(
                        `THINK_AND_REQUERY failed: Failed to capture screenshot - ${err.message}`,
                        i,
                        plan
                    );
                }
                return;  // Stops execution; AI returns new plan
            }

            case "FINAL_ANSWER": {
                let answer = step.answer;
                
                // Replace all {variable_name} placeholders with their stored values
                const variablePlaceholders = answer.match(/\{(\w+)\}/g) || [];
                
                for (const placeholder of variablePlaceholders) {
                    const variableName = placeholder.slice(1, -1); // Remove { }
                    const stored = await chrome.storage.local.get(`var_${variableName}`);
                    const value = stored[`var_${variableName}`] || placeholder; // Fallback to placeholder if not found
                    
                    console.log(`[Agent] Replacing {${variableName}} with: ${value}`);
                    answer = answer.replace(placeholder, value);
                }
                
                console.log(`[Agent] Final answer: ${answer}`);
                window.HUD.show(answer);
                completePlan();
                return;
            }

            default:
                failPlan(`Unknown action: ${step.action}`);
                return;
        }
    }

    completePlan();
}

// On step failure: capture screenshot, send to AI, execute recovery plan (max 3 retries/step)
async function autoRequeryOnError(errorReason, stepIndex, currentPlan) {
    console.log(`[Agent] Auto-requery triggered at step ${stepIndex}: ${errorReason}`);
    
    // Track retry attempts to prevent infinite loops
    const stepKey = `step_${stepIndex}`;
    failureAttempts[stepKey] = (failureAttempts[stepKey] || 0) + 1;
    
    if (failureAttempts[stepKey] > 3) {
        console.error(`[Agent] Step ${stepIndex} failed 3+ times, giving up`);
        window.HUD.show(`❌ Step ${stepIndex} failed repeatedly. Giving up.`);
        completePlan();
        return;
    }
    
    console.log(`[Agent] Retry attempt ${failureAttempts[stepKey]} for step ${stepIndex}`);
    
    try {
        const screenshot = await window.Agent.captureScreenshot();
        
        const stored = await chrome.storage.local.get("originalUserInput");
        
        await chrome.storage.local.remove(["activePlan", "currentStep"]);
        
        // Build context about the failure
        const failureContext = {
            type: "AUTO_RECOVERY",
            failedAtStep: stepIndex,
            failureReason: errorReason,
            retryAttempt: failureAttempts[stepKey],
            completedSteps: currentPlan.steps.slice(0, stepIndex),
            attemptedStep: currentPlan.steps[stepIndex],
            screenshot: screenshot
        };
        
        console.log("[Agent] Sending auto-recovery request to AI...");
        window.HUD.show(`Recovering from error... (attempt ${failureAttempts[stepKey]})`);
        
        // Send message and wait for response
        chrome.runtime.sendMessage({
            type: "GET_AI_PLAN",
            input: stored.originalUserInput || "Continue previous task",
            url: window.location.href,
            context: failureContext
        }, (response) => {
            console.log("[Agent] Auto-recovery AI response:", response);
            
            if (response?.error) {
                console.error("[Agent] Recovery error:", response.error);
                window.HUD.show(`❌ Recovery failed: ${response.error}`);
                return;
            }
            
            if (response?.plan) {
                console.log("[Agent] Executing recovery plan...");
                window.HUD.show("Executing recovery plan...");
                
                // Reset attempts for new plan
                failureAttempts = {};
                
                // Execute the recovery plan
                executePlan(response.plan, 0);
            } else {
                console.error("[Agent] No recovery plan generated");
                window.HUD.show("❌ Recovery plan failed");
            }
        });
    } catch (err) {
        console.error("[Agent] Auto-requery failed:", err);
        failPlan(`Auto-recovery failed: ${err.message}`);
    }
}

// THINK_AND_REQUERY handler - sends screenshot + context to AI for new plan
async function requeryAI(payload) {
    console.log("[Agent] Re-querying AI:", payload);

    // Get the original user input from storage before clearing
    const stored = await chrome.storage.local.get("originalUserInput");
    
    await chrome.storage.local.remove(["activePlan", "currentStep"]);

    // Show status in HUD
    window.HUD.show("Re-analyzing with AI...");

    // Send message and wait for response
    chrome.runtime.sendMessage({
        type: "GET_AI_PLAN",
        input: stored.originalUserInput || "Continue previous task",
        url: window.location.href,
        context: payload
    }, (response) => {
        console.log("[Agent] AI Response received:", response);
        
        if (response?.error) {
            console.error("[Agent] AI Error:", response.error);
            window.HUD.show(`❌ AI Error: ${response.error}`);
            return;
        }
        
        if (response?.plan) {
            console.log("[Agent] Executing new plan from THINK_AND_REQUERY...");
            window.HUD.show("Executing new plan...");
            
            // Execute the new plan from the beginning
            executePlan(response.plan, 0);
        } else {
            console.error("[Agent] No plan in response");
            window.HUD.show("❌ No plan generated");
        }
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function completePlan() {
    chrome.storage.local.remove(["activePlan", "currentStep"]);
}

function failPlan(reason) {
    console.error("[Agent] Plan failed:", reason);
    chrome.storage.local.remove(["activePlan", "currentStep"]);
    window.HUD.show(`❌ ${reason}`);
}

// DOM helpers: find inputs, click elements, extract text, capture screenshots
window.Agent = {
    findInputByLabel: (text) => {
        // Try multiple strategies to find the input
        const inputs = document.querySelectorAll('input, textarea');
        
        for (let input of inputs) {
            if (input.placeholder?.toLowerCase().includes(text.toLowerCase())) return input;
            if (input.getAttribute('aria-label')?.toLowerCase().includes(text.toLowerCase())) return input;
            if (input.name?.toLowerCase().includes(text.toLowerCase())) return input;
            
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label?.innerText?.toLowerCase().includes(text.toLowerCase())) return input;
        }
        
        return null;
    },
    
    smartClick: async (text) => {
        try {
            const searchText = text.toLowerCase().trim();
            console.log(`[Agent] smartClick searching for: "${searchText}"`);
            
            // Get all potentially clickable elements
            const allElements = document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], [class*="btn"], [class*="button"]');
            
            console.log(`[Agent] Found ${allElements.length} clickable elements on page`);
            
            const keywords = searchText.split(' ').filter(k => k.length > 0);
            
            // Strategy 1: Try each word individually (for "UBC CWL Login" try "UBC", "CWL", "Login")
            for (let keyword of keywords) {
                if (keyword.length < 2) continue; // Skip very short words
                
                for (let el of allElements) {
                    const elText = (el.innerText || el.value || el.textContent || '').toLowerCase();
                    const elTitle = (el.title || '').toLowerCase();
                    const elLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                    const elPlaceholder = (el.getAttribute('placeholder') || '').toLowerCase();
                    
                    // Check if this element contains the keyword
                    if (elText.includes(keyword) || elTitle.includes(keyword) || elLabel.includes(keyword) || elPlaceholder.includes(keyword)) {
                        console.log(`[Agent] Found element with keyword "${keyword}": ${elText.substring(0, 50)}`);
                        
                        // Try to scroll into view first
                        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
                        
                        // Small delay to allow scroll
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        // Try clicking
                        el.click();
                        
                        // If it's a button, also try mousedown/mouseup
                        if (el.tagName === 'BUTTON' || el.hasAttribute('onclick')) {
                            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 300));
                        return true;
                    }
                }
            }
            
            // Strategy 2: Try matching word count - if searching for 3-word phrase, find elements with similar word count
            const searchWordCount = keywords.length;
            for (let el of allElements) {
                const elText = (el.innerText || el.value || el.textContent || '').toLowerCase().trim();
                if (elText.length === 0) continue;
                
                const elWordCount = elText.split(/\s+/).length;
                
                // If similar word count and contains at least one keyword
                if (Math.abs(elWordCount - searchWordCount) <= 1 && keywords.some(k => elText.includes(k))) {
                    console.log(`[Agent] Found element with similar structure: ${elText.substring(0, 50)}`);
                    
                    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    el.click();
                    if (el.tagName === 'BUTTON' || el.hasAttribute('onclick')) {
                        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 300));
                    return true;
                }
            }
            
            // Strategy 3: Try any button that's visible and clickable
            for (let el of allElements) {
                // Check if element is visible
                const rect = el.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0;
                
                if (isVisible) {
                    const elText = (el.innerText || el.value || '').toLowerCase().trim();
                    
                    // Prefer buttons with meaningful text
                    if (elText.length > 0) {
                        console.log(`[Agent] Clicking visible button: ${elText.substring(0, 50)}`);
                        
                        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        el.click();
                        if (el.tagName === 'BUTTON' || el.hasAttribute('onclick')) {
                            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 300));
                        return true;
                    }
                }
            }
            
            console.warn(`[Agent] smartClick: Could not find clickable element for "${text}" after all strategies`);
            return false;
        } catch (err) {
            console.error("[Agent] smartClick error:", err);
            return false;
        }
    },
    
    extract: (instruction) => {
        try {
            // Simple text extraction from visible content
            const bodyText = document.body.innerText;
            
            // If instruction asks for specific patterns, try to extract them
            if (instruction.toLowerCase().includes('price')) {
                const priceMatch = bodyText.match(/\$[\d,]+\.?\d*/);
                return priceMatch ? priceMatch[0] : bodyText.substring(0, 500);
            }
            
            if (instruction.toLowerCase().includes('email')) {
                const emailMatch = bodyText.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
                return emailMatch ? emailMatch[0] : null;
            }
            
            if (instruction.toLowerCase().includes('phone')) {
                const phoneMatch = bodyText.match(/[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}/);
                return phoneMatch ? phoneMatch[0] : null;
            }
            
            // Default: return first 500 chars of visible text
            return bodyText.substring(0, 500);
        } catch (err) {
            console.error("[Agent] extract error:", err);
            return null;
        }
    },
    
    captureScreenshot: () => {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type: "CAPTURE_TAB" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("[Agent] captureScreenshot error:", chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response?.error) {
                        reject(new Error(response.error));
                    } else if (response?.dataUrl) {
                        resolve(response.dataUrl);
                    } else {
                        reject(new Error("No screenshot data received"));
                    }
                });
            } catch (err) {
                console.error("[Agent] captureScreenshot error:", err);
                reject(err);
            }
        });
    }
};