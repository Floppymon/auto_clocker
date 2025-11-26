//

// 1. ALARMS: Poll (1 min) & Broadcast (30 mins)
chrome.alarms.create("ntfyPoll", { periodInMinutes: 1 });
chrome.alarms.create("ntfyBroadcast", { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ntfyPoll") {
        checkForRemoteCommands();
    } else if (alarm.name === "ntfyBroadcast") {
        chrome.storage.sync.get(['scheduledTasks', 'isActive', 'ntfyTopic'], (res) => {
            if (res.isActive && res.ntfyTopic) broadcastScheduleToRemote(res.ntfyTopic, res.scheduledTasks, res.isActive);
        });
    }
});

// --- BROADCAST STATUS (PC -> PHONE) ---
// Sends JSON data to the hidden '_control' topic
function broadcastScheduleToRemote(topic, tasks, isActive) {
    if (!topic) return;
    
    const payload = {
        type: "PC_STATUS_SYNC",
        tasks: tasks || [],
        isActive: isActive,
        lastUpdate: Date.now()
    };

    // Send to HIDDEN topic
    fetch(`https://ntfy.sh/${topic}_control`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Title': 'System_Data', 'Priority': '1', 'Tags': 'satellite' }
    }).catch(err => console.log("Broadcast Error:", err));
}

// --- COMMAND LISTENER (PHONE -> PC) ---
// Listens on the hidden '_control' topic
function checkForRemoteCommands() {
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
        const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
        if (!topic) return;

        // Poll the HIDDEN topic
        fetch(`https://ntfy.sh/${topic}_control/json?since=2m&poll=1`)
            .then(response => response.text())
            .then(text => {
                const lines = text.trim().split('\n');
                lines.forEach(line => {
                    try {
                        if (!line) return;
                        const msg = JSON.parse(line);
                        if (msg.message) {
                            const command = JSON.parse(msg.message);
                            
                            // 1. Handle Schedule Update
                            if (command.type === "REMOTE_UPDATE") {
                                applyRemoteSchedule(command, topic);
                            }
                            // 2. Handle "View Status" Request
                            else if (command.type === "REQUEST_SYNC") {
                                chrome.storage.sync.get(['scheduledTasks', 'isActive'], (res) => {
                                    broadcastScheduleToRemote(topic, res.scheduledTasks, res.isActive);
                                });
                            }
                            // 3. Handle Deactivation
                            else if (command.type === "REMOTE_STOP") {
                                console.log("Received Remote Stop Command");
                                chrome.storage.sync.set({ isActive: false, scheduledTasks: [] }, () => {
                                    updateExtensionIcon(false);
                                    
                                    // Update hidden data state
                                    broadcastScheduleToRemote(topic, [], false);

                                    // Send HUMAN visible notification
                                    fetch(`https://ntfy.sh/${topic}`, {
                                        method: 'POST',
                                        body: "Schedule deactivated remotely.",
                                        headers: { 'Title': 'Stopped', 'Priority': '3', 'Tags': 'stop_button' }
                                    });
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
            
            // Send HUMAN visible confirmation
            const count = cmd.dates.length;
            const msg = `Active for ${count} day${count > 1 ? 's' : ''}.\nIN: ${cmd.clockIn} | OUT: ${cmd.clockOut}`;
            
            fetch(`https://ntfy.sh/${topic}`, {
                method: 'POST',
                body: msg,
                headers: { 'Title': 'PC Updated Successfully', 'Priority': '3', 'Tags': 'white_check_mark' }
            });
            
            // Send HIDDEN data payload
            broadcastScheduleToRemote(topic, tasks, true);
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
  // Broadcast local changes to HIDDEN topic
  if (changes.scheduledTasks || changes.isActive) {
      chrome.storage.sync.get(['scheduledTasks', 'isActive', 'ntfyTopic'], (res) => {
          if(res.ntfyTopic) broadcastScheduleToRemote(res.ntfyTopic, res.scheduledTasks, res.isActive);
      });
  }
});

chrome.storage.sync.get(['isActive'], (result) => updateExtensionIcon(result.isActive));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Handle Successful or Skipped Tasks
  if (request.type === "TASK_COMPLETED" || request.type.includes("TASK_SKIPPED")) {
    sendResponse({ status: "received" });
    
    // Broadcast data update (Hidden)
    chrome.storage.sync.get(['scheduledTasks', 'isActive', 'ntfyTopic'], (res) => {
        if(res.ntfyTopic) broadcastScheduleToRemote(res.ntfyTopic, res.scheduledTasks, res.isActive);
    });

    // Send HUMAN visible notification
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      if (!topic) return;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      let notifTitle = "", notifBody = "", notifTags = "";

      if (request.type === "TASK_COMPLETED") {
          if (request.action === 'IN') { notifTitle = "Clocked In!"; notifBody = `Clocked in at ${timeStr}`; notifTags = "white_check_mark"; } 
          else { notifTitle = "Clocked Out!"; notifBody = `Clocked out at ${timeStr}`; notifTags = "x"; }
      } else if (request.type.includes("SKIPPED")) {
          notifTitle = "Action Skipped"; notifBody = `Switch already in correct state at ${timeStr}`; notifTags = "warning";
      }

      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: notifBody,
        headers: { 'Title': notifTitle, 'Priority': 'high', 'Tags': notifTags }
      });
    });
  } 
  
  // 2. Handle Retry Failures (WARNING)
  else if (request.type === "TASK_RETRY_FAILED") {
      sendResponse({ status: "received" });
      
      // Send HIGH PRIORITY Warning to Visible Topic
      chrome.storage.sync.get(['ntfyTopic'], (result) => {
          const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
          if (!topic) return;
          
          fetch(`https://ntfy.sh/${topic}`, {
            method: 'POST',
            body: `Failed to ${request.action} even after retry. Please check PC.`,
            headers: { 'Title': 'ACTION FAILED', 'Priority': 'urgent', 'Tags': 'red_circle, rotating_light' }
          });
      });
  }

  // 3. Handle System Fails
  else if (request.type === "TASK_FAILED") {
      sendResponse({ status: "fail_received" });
      chrome.storage.sync.set({ isActive: false });
  }
  return true; 
});