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

// --- STARTUP LOGIC ---
chrome.storage.local.get(['verification'], (data) => {
    if (data.verification) {
        verifyLastAction(data.verification);
    } else {
        initNormalSchedule();
    }
});

function verifyLastAction(verifyData) {
    const attemptNum = verifyData.attempt || 1;
    console.log(`Verifying previous action (Attempt ${attemptNum}):`, verifyData);
    
    waitForElement(ELEMENT_SELECTOR).then(el => {
        const isChecked = el.checked; 
        const expectedState = verifyData.expectIn; 
        
        // 1. SUCCESS CASE
        if (isChecked === expectedState) {
            console.log("Verification Successful! State matches.");
            
            chrome.storage.local.remove('verification');
            
            chrome.runtime.sendMessage({ 
                type: "TASK_COMPLETED", 
                action: verifyData.action 
            });
            
            initNormalSchedule();
        } 
        // 2. FAILURE CASE
        else {
            console.log(`Verification Failed. State is ${isChecked?"ON":"OFF"}, expected ${expectedState?"ON":"OFF"}.`);

            // *** RETRY LOGIC ***
            if (attemptNum < 2) {
                console.log("Attempt 1 failed. Retrying action now...");
                
                el.click();
                
                verifyData.attempt = 2;
                
                chrome.storage.local.set({ verification: verifyData }, () => {
                    console.log("Waiting 10s for retry reload...");
                    setTimeout(() => {
                        location.reload();
                    }, 10000);
                });
            } 
            // *** GIVE UP LOGIC (2nd Failure) ***
            else {
                // CHANGED: No longer console.error
                console.log("Verification failed twice. Giving up and sending alert.");
                
                chrome.storage.local.remove('verification');

                chrome.runtime.sendMessage({ 
                    type: "TASK_VERIFICATION_FAILED", 
                    action: verifyData.action,
                    current: isChecked
                });
                
                initNormalSchedule();
            }
        }
        
    }).catch(err => {
        console.log("Verification check failed: Element not found.");
        chrome.runtime.sendMessage({ type: "TASK_FAILED" });
        initNormalSchedule();
    });
}

function initNormalSchedule() {
    chrome.storage.sync.get(['scheduledTasks', 'isActive'], (result) => {
        scheduleFromList(result.scheduledTasks, result.isActive, false);
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

        for (const task of tasks) {
            if (task.timestamp === lastRun) continue;

            const diff = task.timestamp - now.getTime();
            const timeBuffer = isReCheck ? 1000 : -60000; 

            if (diff > timeBuffer) {
                nextTask = task;
                break; 
            }
        }

        if (!nextTask) {
            console.log("Scheduled Clicker: No future tasks found. Deactivating.");
            chrome.storage.sync.set({ isActive: false, scheduledTasks: [] });
            return;
        }

        const finalDiff = nextTask.timestamp - now.getTime();
        
        if (finalDiff > 600000) { 
            const reloadTime = finalDiff - 120000;
            console.log(`Target is far away. Refreshing in ${(reloadTime/60000).toFixed(1)} mins.`);
            clickerTimeout = setTimeout(() => location.reload(), reloadTime);
            return;
        }

        if (finalDiff <= 0 && finalDiff > -60000 && !isReCheck) {
            console.log(`Grace period active. Doing: ${nextTask.action} immediately.`);
            executeTask(nextTask);
            return;
        }

        const dateDisplay = new Date(nextTask.timestamp).toLocaleString('en-GB');
        console.log(`Next Action: ${nextTask.action} at ${dateDisplay}`);

        clickerTimeout = setTimeout(() => {
            console.log("Time reached. Executing...");
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
        const actionType = task.action;
        let actionNeeded = false;

        if (actionType === 'IN') {
            if (isChecked) {
                console.log("Action IN requested, but ALREADY ON. Skipping.");
                chrome.runtime.sendMessage({ type: "TASK_SKIPPED_ALREADY_ON", action: 'IN' });
                chrome.storage.local.set({ lastProcessed: task.timestamp });
                initNormalSchedule(); 
                return; 
            } else {
                actionNeeded = true;
            }
        } else if (actionType === 'OUT') {
            if (!isChecked) {
                console.log("Action OUT requested, but ALREADY OFF. Skipping.");
                chrome.runtime.sendMessage({ type: "TASK_SKIPPED_ALREADY_OFF", action: 'OUT' });
                chrome.storage.local.set({ lastProcessed: task.timestamp });
                initNormalSchedule(); 
                return;
            } else {
                actionNeeded = true;
            }
        }

        if (actionNeeded) {
            el.click();
            console.log(`Action ${actionType} clicked. Waiting 10s to refresh and verify...`);

            chrome.storage.local.set({ 
                lastProcessed: task.timestamp,
                verification: {
                    action: actionType,
                    expectIn: (actionType === 'IN'),
                    attempt: 1 
                }
            }, () => {
                setTimeout(() => {
                    console.log("Reloading page now...");
                    location.reload();
                }, 10000);
            });
        }

    } catch(error) {
        console.error("Error.", error);
        chrome.storage.sync.set({ isActive: false });
    }
}

chrome.storage.onChanged.addListener((changes) => {
    if (changes.scheduledTasks || changes.isActive) {
        initNormalSchedule();
    }
});