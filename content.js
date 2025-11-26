//
let clickerTimeout;
const ELEMENT_SELECTOR = ".PrivateSwitchBase-input"; 

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

// --- ENTRY POINT ---
// Check storage immediately to see if we are in the middle of a "Verify after Reload" cycle
chrome.storage.local.get(['verificationPending', 'scheduledTasks', 'isActive', 'lastProcessed'], (data) => {
    if (data.verificationPending) {
        // We just reloaded and need to verify a previous action
        console.log("Page reloaded. Resuming verification...", data.verificationPending);
        handleVerification(data.verificationPending);
    } else {
        // Normal startup
        scheduleFromList(data.scheduledTasks, data.isActive, data.lastProcessed);
    }
});

function handleVerification(pendingTask) {
    waitForElement(ELEMENT_SELECTOR)
        .then(el => {
            const isChecked = el.checked;
            const expectedState = (pendingTask.action === 'IN'); // IN = true, OUT = false
            
            console.log(`Verification Check: Expected ${expectedState}, Got ${isChecked}`);

            if (isChecked === expectedState) {
                // SUCCESS
                console.log("Verification Successful!");
                chrome.storage.local.remove('verificationPending'); // Clear flag
                sendNotification("TASK_COMPLETED", pendingTask.action);
                
                // Resume normal schedule
                chrome.storage.sync.get(['scheduledTasks', 'isActive'], (res) => {
                     scheduleFromList(res.scheduledTasks, res.isActive, pendingTask.timestamp);
                });

            } else {
                // FAILED
                console.log("Verification Failed."); // Changed from warn
                
                if (pendingTask.attempt < 2) {
                    console.log("Attempting Retry (Click -> Wait 5s -> Reload -> Verify)...");
                    
                    // RETRY ACTION
                    el.click();
                    
                    // Update attempt count and reload again
                    const retryData = { ...pendingTask, attempt: 2 };
                    chrome.storage.local.set({ verificationPending: retryData }, () => {
                        // Wait 5 seconds before reloading for retry
                        setTimeout(() => location.reload(), 5000);
                    });

                } else {
                    // FINAL FAILURE
                    console.log("Retry also failed. Sending Alert."); // Changed from error
                    chrome.storage.local.remove('verificationPending'); // Clear flag to stop loop
                    sendNotification("TASK_RETRY_FAILED", pendingTask.action);
                    
                    // Resume normal schedule (skipping this broken task)
                    chrome.storage.sync.get(['scheduledTasks', 'isActive'], (res) => {
                         scheduleFromList(res.scheduledTasks, res.isActive, pendingTask.timestamp);
                    });
                }
            }
        })
        .catch(err => {
            console.log("Verification element not found", err); // Changed from error
            chrome.storage.local.remove('verificationPending');
        });
}

function scheduleFromList(tasks, isActive, lastRun = 0) {
    if (isActive === false) return;
    if (clickerTimeout) { clearTimeout(clickerTimeout); clickerTimeout = null; }
    if (!tasks || tasks.length === 0) return;

    const now = new Date();
    let nextTask = null;

    // Find the next task
    for (const task of tasks) {
        if (task.timestamp === lastRun) continue;
        const diff = task.timestamp - now.getTime();
        if (diff > -60000) { // Allow 1 min grace period
            nextTask = task;
            break; 
        }
    }

    if (!nextTask) {
        console.log("No future tasks found. Deactivating.");
        chrome.storage.sync.set({ isActive: false, scheduledTasks: [] });
        return;
    }

    const finalDiff = nextTask.timestamp - now.getTime();

    // Smart Refresh (Prevent Session Timeout if > 10 mins away)
    if (finalDiff > 600000) { 
        const reloadTime = finalDiff - 120000; 
        console.log(`Target is far away. Scheduling refresh in ${(reloadTime/60000).toFixed(1)} mins.`);
        clickerTimeout = setTimeout(() => location.reload(), reloadTime);
        return; 
    }

    // Execute
    if (finalDiff <= 0) {
        console.log(`Grace period active. Executing ${nextTask.action} immediately.`);
        executeTask(nextTask);
    } else {
        const dateDisplay = new Date(nextTask.timestamp).toLocaleString('en-GB');
        console.log(`Next Action: ${nextTask.action} at ${dateDisplay}`);
        clickerTimeout = setTimeout(() => executeTask(nextTask), finalDiff);
    }
}

function executeTask(task) {
    waitForElement(ELEMENT_SELECTOR).then(el => {
        const isChecked = el.checked; 
        const actionType = task.action;

        // 1. Check if action is needed
        if ((actionType === 'IN' && isChecked) || (actionType === 'OUT' && !isChecked)) {
            console.log(`Switch already in correct state (${actionType}). Skipping.`);
            // Update lastProcessed so we don't loop
            chrome.storage.local.set({ lastProcessed: task.timestamp });
            
            const msg = actionType === 'IN' ? "TASK_SKIPPED_ALREADY_ON" : "TASK_SKIPPED_ALREADY_OFF";
            sendNotification(msg, actionType);
            
            // Re-schedule
            chrome.storage.sync.get(['scheduledTasks', 'isActive'], (res) => {
                 scheduleFromList(res.scheduledTasks, res.isActive, task.timestamp);
            });
            return;
        }

        // 2. Perform Click
        console.log(`Clicking for ${actionType}...`);
        el.click();

        // 3. Mark processed & Set Verification Flag
        chrome.storage.local.set({ 
            lastProcessed: task.timestamp,
            verificationPending: { ...task, attempt: 1 }
        });

        // 4. Wait 5 seconds for network request, then Reload
        console.log("Action performed. Waiting 5 seconds before reloading for verification...");
        setTimeout(() => {
            console.log("Reloading now...");
            location.reload();
        }, 5000);

    }).catch(err => {
        if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: "TASK_FAILED" });
    });
}

function sendNotification(type, action) {
    if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: type, action: action }, () => { 
            if (chrome.runtime.lastError) return; 
        });
    }
}

// Watch for external updates (e.g. from Popup)
chrome.storage.onChanged.addListener((changes) => {
    if (changes.scheduledTasks || changes.isActive) {
        // Only re-schedule if we aren't currently verifying
        chrome.storage.local.get(['verificationPending'], (data) => {
            if (!data.verificationPending) {
                chrome.storage.sync.get(['scheduledTasks', 'isActive'], (result) => {
                    chrome.storage.local.get(['lastProcessed'], (local) => {
                        scheduleFromList(result.scheduledTasks, result.isActive, local.lastProcessed);
                    });
                });
            }
        });
    }
});