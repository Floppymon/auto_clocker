let clickerTimeout;
const ELEMENT_SELECTOR = ".PrivateSwitchBase-input"; // Target element selector

// Function to wait until the element appears on the page before performing the action
function waitForElement(selector, timeout = 10000, interval = 500) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(check);
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(check);
                reject(new Error(`Element not found after ${timeout / 1000} seconds: ${selector}`));
            }
        }, interval);
    });
}

function scheduleClick(targetTime, isActive) {
    // *** FIX: If the task is inactive, do not proceed with scheduling or grace period ***
    // We only proceed if isActive is explicitly true, or if it is undefined (on first load)
    if (isActive === false) {
        console.log("Scheduled Clicker: Task is inactive. Skipping scheduling.");
        return;
    }
    
    // Clear any existing timer
    if (clickerTimeout) {
        clearTimeout(clickerTimeout);
        clickerTimeout = null;
    }

    if (!targetTime) return;

    const now = new Date(), target = new Date();
    const [h, m] = targetTime.split(':');

    target.setHours(h, m, 0, 0); 

    const diff = target - now;

    // Grace Period: If opened within 60 seconds of target (page load latency)
    if (diff <= 0 && diff > -60000) {
        console.log("Scheduled Clicker: Grace period active. Checking for element immediately!");
        
        // Use the new waiting function to ensure element is loaded
        waitForElement(ELEMENT_SELECTOR)
            .then(el => {
                performClick(el);
            })
            .catch(error => {
                console.error("Scheduled Clicker: Immediate click failed.", error);
                // Send failure message to background script
                chrome.runtime.sendMessage({ type: "TASK_FAILED" });
            });
        return;
    }

    // Schedule for today or tomorrow
    if (target <= now) target.setDate(target.getDate() + 1);

    const timeUntilTarget = target - now;
    console.log(`Scheduled Clicker: Waiting for: ${target.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}`);

    clickerTimeout = setTimeout(() => {
        console.log("Scheduled Clicker: Time reached. Waiting for element...");
        
        // When time hits, wait for the element to appear
        waitForElement(ELEMENT_SELECTOR)
            .then(el => {
                performClick(el);
            })
            .catch(error => {
                console.error("Scheduled Clicker: Timed click failed.", error);
                // Send failure message to background script
                chrome.runtime.sendMessage({ type: "TASK_FAILED" });
            });

    }, timeUntilTarget);
}
function performClick(el) {
    try {
        el.click();
        console.log("Scheduled Clicker: Click successful!");
        
        // Set state to Inactive immediately after the click execution for reliability
        chrome.storage.sync.set({ isActive: false }, () => {
            // Added check for context invalidated before console log (optional but safer)
            if (chrome.runtime.lastError) return;
            console.log("Scheduled Clicker: Task completed. State set to Inactive.");
        });
        
        // Wait 500ms for state update before checking
        setTimeout(() => {
            const isChecked = el.checked; // true = Clocked In, false = Clocked Out
            console.log("Scheduled Clicker: Switch State after click:", isChecked ? "IN" : "OUT");
            
            // Send success message (with state) to background script
            chrome.runtime.sendMessage({ 
                type: "TASK_COMPLETED", 
                checked: isChecked 
            }, () => {
                // *** CRITICAL FIX: Check for error after message attempt ***
                if (chrome.runtime.lastError) {
                    console.warn("Scheduled Clicker: Failed to send success message (Context invalidated).");
                }
            });
        }, 500);

    } catch(error) {
        console.error("Scheduled Clicker: Error during click execution.", error);
        
        // Attempt to send failure message, but gracefully handle context invalidation
        chrome.runtime.sendMessage({ type: "TASK_FAILED" }, () => {
             // *** CRITICAL FIX: Check for error after message attempt ***
             if (chrome.runtime.lastError) {
                console.warn("Scheduled Clicker: Failed to send failure message (Context invalidated).");
            }
        });
        
        // Also set inactive on click failure
        chrome.storage.sync.set({ isActive: false });
    }
}

// --- INITIALIZATION & Storage Listeners ---

// Get initial time and isActive state on page load
chrome.storage.sync.get(['targetTime', 'isActive'], (result) => {
    // Pass isActive status to prevent Grace Period from running on manual refresh if alarm fired
    scheduleClick(result.targetTime, result.isActive);
});

// Listen for time changes from the popup (real-time update)
chrome.storage.onChanged.addListener((changes, namespace) => {
    // If target time changes, re-schedule (assuming activation)
    if (changes.targetTime && changes.targetTime.newValue) {
        // Assume activation is intended when time changes
        scheduleClick(changes.targetTime.newValue, true); 
    } else if (changes.isActive && changes.isActive.newValue === false) {
        // Clear timeout if deactivated via popup while on this page
        if (clickerTimeout) {
            clearTimeout(clickerTimeout);
            clickerTimeout = null;
            console.log("Scheduled Clicker: Local timer cleared due to Deactivation.");
        }
    }
});