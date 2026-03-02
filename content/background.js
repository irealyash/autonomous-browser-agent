/**
 * Speedy AI Agent - Background Service Worker
 * Handles GET_AI_PLAN (AI plan generation) and CAPTURE_TAB (screenshots)
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Background] Message received:", message.type, message);
    
    if (message.type === "GET_AI_PLAN") {
        chrome.history.search({ text: '', maxResults: 15 }, (historyItems) => {
            const historyContext = historyItems
                .map(item => `Title: "${item.title}" (URL: ${item.url})`)
                .join("\n");
            getPlanFromAI(message.input, message.url, historyContext, message.context)
                .then(plan => {
                    console.log("[Background] AI Plan received:", plan);
                    sendResponse({ plan: plan });
                })
                .catch(err => {
                    console.error("[Background] AI Error:", err);
                    sendResponse({ error: err.message });
                });
        });

        return true;  // Async response
    }
    
    if (message.type === "CAPTURE_TAB") {
        chrome.tabs.captureVisibleTab({ format: 'png' }, (screenshotUrl) => {
            if (chrome.runtime.lastError) {
                console.error("[Background] Screenshot capture error:", chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                console.log("[Background] Screenshot captured successfully");
                sendResponse({ dataUrl: screenshotUrl });
            }
        });
        return true;
    }
});


async function getPlanFromAI(userInput, currentUrl, historyContext, context = null) {
    const { geminiApiKey: apiKey } = await chrome.storage.sync.get("geminiApiKey");
    if (!apiKey) {
        throw new Error("No API key. Right-click extension → Options → add your Gemini API key.");
    }
    
    // Build prompt with optional context (THINK_AND_REQUERY, AUTO_RECOVERY)
    let promptPrefix = `You are an Autonomous Browser Automation & Information Agent.

CONTEXT:
- CURRENT_URL: ${currentUrl}
- USER_HISTORY: ${historyContext}`;

    if (context && context.type === "THINK_AND_REQUERY") {
        promptPrefix += `
- REASON FOR ANALYSIS: ${context.reason}
- ANALYSIS INSTRUCTION: ${context.instruction}
- COMPLETED_STEPS: ${context.completedSteps?.length || 0} steps completed
- CURRENT_STEP: Step ${context.currentStep}
- [Page screenshot captured and analyzed]
- PREVIOUS_ACTIONS: Task was interrupted for visual analysis`;
    }
    
    if (context && context.type === "AUTO_RECOVERY") {
        promptPrefix += `
- ERROR_AT_STEP: ${context.failedAtStep} (${context.attemptedStep?.action})
- ERROR_REASON: ${context.failureReason}
- COMPLETED_STEPS: ${context.completedSteps?.length || 0} steps completed
- COMPLETED_ACTIONS: ${context.completedSteps?.map(s => s.action).join(', ') || 'None'}
- [Screenshot of current page state captured - ERROR STATE]
- INSTRUCTION: Fix the failed step and continue from step ${context.failedAtStep}`;
    }

    promptPrefix += `
- USER_GOAL: "${userInput}"`;

    const prompt = promptPrefix + `

OBJECTIVE:
Determine whether the USER_GOAL requires:
A) Browser automation & navigation
B) Information extraction from the web
C) A direct factual answer without browsing

Then respond accordingly.

NAVIGATION RULES:
- If user says "open [X] page", "go to [X]", "navigate to [X]", or "find [X] course/page":
  → ALWAYS first GOTO the appropriate URL (Canvas, YouTube, UBC site, etc.)
  → DO NOT just search on Google - understand the context and navigate directly
  → Example: "Open PHY131 course" → GOTO https://canvas.ubc.ca (or appropriate Canvas URL)
  → Example: "Search for PHY131" on YouTube → GOTO YouTube first, then CLICK search, TYPE query

- If user mentions a known platform (Canvas, YouTube, Gmail, etc.), go to that platform FIRST
- Only use Google search for general questions that explicitly say "search for"

CORE MODES:
1. EXECUTION PLAN MODE  
   Convert the USER_GOAL into a JSON EXECUTION PLAN that a browser extension can execute.

2. DIRECT ANSWER MODE  
   If the USER_GOAL is a simple factual query that does NOT require browsing (e.g., "What is the capital of India"), return the final answer directly.

3. SCRAPE & EXTRACT MODE  
   If the USER_GOAL requires retrieving data from a website, navigate, extract the required information, and return it using EXTRACT or FINAL_ANSWER.

CORE BEHAVIOR:
1. If the task is SIMPLE and fully predictable, output ALL required steps in one response.
2. If the task is COMPLEX, VISUAL, or requires DECISION-MAKING:
   - Output only the obvious initial steps.
   - Insert a THINK_AND_REQUERY step to pause and re-analyze.
3. Never hallucinate page content.
4. If browsing is unnecessary, do NOT create an execution plan.

VARIABLE SYNCHRONIZATION:
- If you need information from the user, use ASK_USER_INPUT and set "store_as" to a unique key (e.g., "ask1").
- To use that stored value later in a TYPE action, use "value_from" with the EXACT same key (e.g., "ask1").
- This allows you to request data and use it in forms within the same plan.

EXECUTION BATCHING RULES:
- Steps must be executable in order.
- The plan may intentionally end early to allow another AI call.

AVAILABLE ACTIONS:

1. GOTO  
{ "action": "GOTO", "url": "https://..." }

2. CLICK  
{ "action": "CLICK", "text": "visible text", "description": "what this clicks" }

3. TYPE  
{ "action": "TYPE", "text": "input label or placeholder", "value": "text to type" }

4. WAIT  
{ "action": "WAIT", "seconds": 2 }

5. ASK_USER (CHOICE)  
{ 
  "action": "ASK_USER",
  "question": "clarifying question",
  "options": ["Option A", "Option B", "Option C", "Option D"]
}

6. ASK_USER_INPUT (TEXT)  
{
  "action": "ASK_USER_INPUT",
  "question": "What should the user type?",
  "placeholder": "Example input"
}

7. EXTRACT  
{
  "action": "EXTRACT",
  "variable_name": "result",
  "instruction": "What data to extract from the page"
}

8. THINK_AND_REQUERY  
{
  "action": "THINK_AND_REQUERY",
  "reason": "Why visual/contextual analysis is required",
  "instruction": "What the next AI call should analyze"
}

9. FINAL_ANSWER  
{
  "action": "FINAL_ANSWER",
  "answer": "The final response to the user"
}

DECISION RULES:
- If the request is ambiguous → use ASK_USER or ASK_USER_INPUT.
- Always start with GOTO unless already on the correct page.
- Use THINK_AND_REQUERY when:
  - A screenshot is required
  - A math or reasoning step is visible on the page
  - The next action depends on page content
  - The task requires interpretation or judgment
- Use FINAL_ANSWER when no further automation is required.

OUTPUT FORMAT RULES (STRICT):
- Return ONLY valid JSON
- No markdown
- No explanations
- Exactly ONE of the following top-level structures:

EXECUTION PLAN:
{
  "steps": [
    { ... },
    { ... }
  ]
}

DIRECT ANSWER MODE  

If the USER_GOAL is a simple factual query that does NOT require browsing,
you MUST still return an EXECUTION PLAN.

That plan MUST contain exactly ONE step:

{
  "steps": [
    {"action": "FINAL_ANSWER",
    "answer": "..."}
           ]
}



FAILURE AVOIDANCE:
- Do NOT guess answers.
- Do NOT complete reasoning-heavy tasks without re-querying.
- Prefer pausing early over making incorrect assumptions.

`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    const data = await response.json();

    // Safety: Gemini may return empty candidates
    if (!data.candidates || data.candidates.length === 0) {
        console.error("Gemini API Error Response:", data);
        throw new Error(data.error?.message || "Gemini returned no results. Check your API quota/safety settings.");
    }

    const jsonText = data.candidates[0].content.parts[0].text;
    const cleanJson = jsonText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleanJson);
}