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

function scheduleFromList(tasks, isActive, isReCheck = false) {
    if (isActive === false) return;
    if (clickerTimeout) { clearTimeout(clickerTimeout); clickerTimeout = null; }
    if (!tasks || tasks.length === 0) return;

    chrome.storage.local.get(['lastProcessed'], (localData) => {
        const lastRun = localData.lastProcessed || 0;
        const now = new Date();
        
        let nextTask = null;

        // Find the first task in the future that we haven't run yet
        for (const task of tasks) {
            // Ignore if we just ran this specific timestamp
            if (task.timestamp === lastRun) continue;

            const diff = task.timestamp - now.getTime();
            const timeBuffer = isReCheck ? 1000 : -60000; 

            if (diff > timeBuffer) {
                nextTask = task;
                break; // Tasks are sorted
            }
        }

        // Auto-Stop if list finished
        if (!nextTask) {
            console.log("Scheduled Clicker: No future tasks found. Deactivating.");
            chrome.storage.sync.set({ isActive: false, scheduledTasks: [] });
            return;
        }

        const finalDiff = nextTask.timestamp - now.getTime();
        
        // --- NEW: SMART REFRESH LOGIC ---
        // If the task is more than 10 minutes away, don't just wait.
        // Schedule a page reload for 2 minutes BEFORE the task.
        // This prevents session timeouts and keeps the tab active.
        if (finalDiff > 600000) { // 600,000ms = 10 minutes
            const reloadTime = finalDiff - 120000; // Reload 2 mins before target
            console.log(`Target is far away. Scheduling a page refresh in ${(reloadTime/60000).toFixed(1)} minutes to keep session alive.`);
            
            clickerTimeout = setTimeout(() => {
                console.log("Refreshing page to ensure fresh session...");
                location.reload();
            }, reloadTime);
            return; // Stop here. The reload will restart the script.
        }
        // --------------------------------

        // Execute (If we are close enough, < 10 mins)
        if (finalDiff <= 0 && finalDiff > -60000 && !isReCheck) {
            console.log(`Grace period active. Doing: ${nextTask.action} immediately.`);
            executeTask(nextTask);
            return;
        }

        const dateDisplay = new Date(nextTask.timestamp).toLocaleString('en-GB');
        console.log(`Next Action: ${nextTask.action} at ${dateDisplay}`);

        clickerTimeout = setTimeout(() => {
            console.log("Time reached. Performing action...");
            executeTask(nextTask);
        }, finalDiff);
    });
}

function executeTask(task) {
    waitForElement(ELEMENT_SELECTOR)
        .then(el => performAction(el, task))
        .catch(err => { if (chrome.runtime?.id) chrome.runtime.sendMessage({ type: "TASK_FAILED" }); });
}

function performAction(el, task) {
    if (!chrome.runtime?.id) return;

    try {
        const isChecked = el.checked; 
        let didClick = false;
        let messageType = "TASK_COMPLETED"; 
        const actionType = task.action;
        
        if (actionType === 'IN') {
            if (isChecked) {
                console.log("Action IN requested, but Switch is ALREADY ON. Skipping.");
                messageType = "TASK_SKIPPED_ALREADY_ON";
            } else {
                el.click();
                didClick = true;
            }
        } else if (actionType === 'OUT') {
            if (!isChecked) {
                console.log("Action OUT requested, but Switch is ALREADY OFF. Skipping.");
                messageType = "TASK_SKIPPED_ALREADY_OFF";
            } else {
                el.click();
                didClick = true;
            }
        }

        // Save progress using the unique timestamp
        chrome.storage.local.set({ lastProcessed: task.timestamp });

        const delay = didClick ? 1000 : 100;

        setTimeout(() => {
            if (!chrome.runtime?.id) return;
            
            chrome.runtime.sendMessage({ type: messageType, action: actionType }, () => { 
                if (chrome.runtime.lastError) return; 
            });

            // Re-schedule
            chrome.storage.sync.get(['scheduledTasks', 'isActive'], (result) => {
                 scheduleFromList(result.scheduledTasks, result.isActive, true);
            });
        }, delay);

    } catch(error) {
        console.error("Error.", error);
        chrome.storage.sync.set({ isActive: false });
    }
}

// --- INITIALIZATION ---
chrome.storage.sync.get(['scheduledTasks', 'isActive'], (result) => {
    scheduleFromList(result.scheduledTasks, result.isActive, false);
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.scheduledTasks || changes.isActive) {
        chrome.storage.sync.get(['scheduledTasks', 'isActive'], (result) => {
             scheduleFromList(result.scheduledTasks, result.isActive, false);
        });
    }
});