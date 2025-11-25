//

// 1. ALARMS: Poll for commands (1 min)
chrome.alarms.create("ntfyPoll", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ntfyPoll") {
        checkForRemoteCommands();
    }
});

// --- BROADCAST STATUS (PC -> PHONE) ---
// Only used when you click "Refresh" on the phone
function broadcastScheduleToRemote(topic, tasks, isActive) {
    if (!topic) return;
    
    const payload = {
        type: "PC_STATUS_SYNC",
        tasks: tasks || [],
        isActive: isActive,
        lastUpdate: Date.now()
    };

    fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Title': 'System_Data', 'Priority': '1', 'Tags': 'satellite' }
    }).catch(err => console.log("Broadcast Error:", err));
}

// --- COMMAND LISTENER (PHONE -> PC) ---
function checkForRemoteCommands() {
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
        const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
        if (!topic) return;

        fetch(`https://ntfy.sh/${topic}/json?since=2m&poll=1`)
            .then(response => response.text())
            .then(text => {
                const lines = text.trim().split('\n');
                lines.forEach(line => {
                    try {
                        if (!line) return;
                        const msg = JSON.parse(line);
                        if (msg.message) {
                            const command = JSON.parse(msg.message);
                            
                            // 1. Update Schedule
                            if (command.type === "REMOTE_UPDATE") {
                                applyRemoteSchedule(command, topic);
                            }
                            // 2. Refresh Request (This is the ONLY time we broadcast data now)
                            else if (command.type === "REQUEST_SYNC") {
                                chrome.storage.sync.get(['scheduledTasks', 'isActive'], (res) => {
                                    broadcastScheduleToRemote(topic, res.scheduledTasks, res.isActive);
                                });
                            }
                            // 3. Stop Request
                            else if (command.type === "REMOTE_STOP") {
                                chrome.storage.sync.set({ isActive: false, scheduledTasks: [] }, () => {
                                    updateExtensionIcon(false);
                                });
                            }
                        }
                    } catch (e) {}
                });
            })
            .catch(err => console.log("Poll Error:", err));
    });
}

function applyRemoteSchedule(cmd, topic) {
    console.log("Received Remote Command:", cmd);
    const tasks = [];
    const now = new Date();
    const isRandom = cmd.isRandomized || false;
    
    cmd.dates.forEach(dateStr => {
        const [y, mo, d] = dateStr.split('-');
        const addTask = (timeStr, type) => {
            if (!timeStr) return;
            const [h, m] = timeStr.split(':');
            const baseDate = new Date(y, mo - 1, d, h, m, 0, 0);
            let targetDate = new Date(baseDate);

            if (isRandom) {
                const offsetMinutes = Math.floor(Math.random() * 11) - 5; 
                targetDate.setMinutes(targetDate.getMinutes() + offsetMinutes);
            }

            if (targetDate - now > -60000) {
                tasks.push({ timestamp: targetDate.getTime(), action: type, dateStr: dateStr });
            }
        };
        addTask(cmd.clockIn, 'IN');
        addTask(cmd.clockOut, 'OUT');
    });

    if (tasks.length > 0) {
        tasks.sort((a, b) => a.timestamp - b.timestamp);
        
        chrome.storage.sync.set({
            clockInTime: cmd.clockIn,
            clockOutTime: cmd.clockOut,
            targetDates: cmd.dates,
            isRandomized: isRandom,
            scheduledTasks: tasks,
            isActive: true
        }, () => {
            updateExtensionIcon(true);
            
            const count = cmd.dates.length;
            const msg = `Active for ${count} day${count > 1 ? 's' : ''}.\nIN: ${cmd.clockIn} | OUT: ${cmd.clockOut}`;
            
            // Send Human Readable Confirmation ONLY
            fetch(`https://ntfy.sh/${topic}`, {
                method: 'POST',
                body: msg,
                headers: { 'Title': 'PC Updated Successfully', 'Priority': '3', 'Tags': 'white_check_mark' }
            });
        });
    }
}

// --- STANDARD LOGIC ---
function updateExtensionIcon(isActive) {
  const state = isActive ? 'active' : 'inactive';
  chrome.action.setIcon({
      path: { "16": `icons/icon-${state}-16.png`, "48": `icons/icon-${state}-48.png`, "128": `icons/icon-${state}-128.png` }
  }, () => {});
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.isActive) updateExtensionIcon(changes.isActive.newValue);
});

chrome.storage.sync.get(['isActive'], (result) => updateExtensionIcon(result.isActive));

// --- MESSAGE HANDLER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.type === "TASK_COMPLETED" || request.type.includes("TASK_SKIPPED") || request.type === "TASK_VERIFICATION_FAILED") {
    
    sendResponse({ status: "received" });
    
    // *** REMOVED THE BROADCAST HERE ***
    // We no longer send the data packet automatically.
    // The phone list will update only when you click "Refresh".

    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      if (!topic) return;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      let notifTitle = "", notifBody = "", notifTags = "", priority = "high";

      if (request.type === "TASK_COMPLETED") {
          if (request.action === 'IN') { notifTitle = "Clocked In!"; notifBody = `Verified ON at ${timeStr}`; notifTags = "white_check_mark"; } 
          else { notifTitle = "Clocked Out!"; notifBody = `Verified OFF at ${timeStr}`; notifTags = "x"; }
      } 
      else if (request.type === "TASK_VERIFICATION_FAILED") {
          notifTitle = "Action FAILED!";
          notifBody = `Tried to ${request.action} but switch state is ${request.current ? 'ON' : 'OFF'}!`;
          notifTags = "rotating_light";
          priority = "max";
      }
      else if (request.type.includes("SKIPPED")) {
          notifTitle = "Action Skipped"; notifBody = `Switch already correct at ${timeStr}`; notifTags = "warning";
      }

      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: notifBody,
        headers: { 'Title': notifTitle, 'Priority': priority, 'Tags': notifTags }
      });
    });
  } else if (request.type === "TASK_FAILED") {
      sendResponse({ status: "fail_received" });
      chrome.storage.sync.set({ isActive: false });
  }
  return true; 
});