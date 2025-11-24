//

// 1. SETUP ALARM FOR POLLING (Every 1 minute)
chrome.alarms.create("ntfyPoll", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ntfyPoll") {
        checkForRemoteCommands();
    }
});

function checkForRemoteCommands() {
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
        const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
        if (!topic) return;

        fetch(`https://ntfy.sh/${topic}/json?since=1m&poll=1`)
            .then(response => response.text())
            .then(text => {
                const lines = text.trim().split('\n');
                lines.forEach(line => {
                    try {
                        if (!line) return;
                        const msg = JSON.parse(line);
                        
                        if (msg.message && msg.message.includes("REMOTE_UPDATE")) {
                            const command = JSON.parse(msg.message);
                            if (command.type === "REMOTE_UPDATE") {
                                applyRemoteSchedule(command);
                            }
                        }
                    } catch (e) {}
                });
            })
            .catch(err => console.log("Poll Error:", err));
    });
}

function applyRemoteSchedule(cmd) {
    console.log("Received Remote Command:", cmd);

    const tasks = [];
    const now = new Date();
    // Retrieve the randomization flag sent from the phone
    const isRandom = cmd.isRandomized || false;
    
    cmd.dates.forEach(dateStr => {
        const [y, mo, d] = dateStr.split('-');

        const addTask = (timeStr, type) => {
            if (!timeStr) return;
            const [h, m] = timeStr.split(':');
            const baseDate = new Date(y, mo - 1, d, h, m, 0, 0);
            
            let targetDate = new Date(baseDate);

            // *** APPLY RANDOMIZATION IF REQUESTED ***
            if (isRandom) {
                const offsetMinutes = Math.floor(Math.random() * 11) - 5; // -5 to +5
                targetDate.setMinutes(targetDate.getMinutes() + offsetMinutes);
            }

            // Only add if in future (grace 1 min)
            if (targetDate - now > -60000) {
                tasks.push({
                    timestamp: targetDate.getTime(),
                    action: type,
                    dateStr: dateStr
                });
            }
        };

        addTask(cmd.clockIn, 'IN');
        addTask(cmd.clockOut, 'OUT');
    });

    if (tasks.length > 0) {
        tasks.sort((a, b) => a.timestamp - b.timestamp);
        
        // Save to storage -> Triggers content.js AND updates popup UI state
        chrome.storage.sync.set({
            clockInTime: cmd.clockIn,
            clockOutTime: cmd.clockOut,
            targetDates: cmd.dates,
            isRandomized: isRandom, // Save setting so popup toggle updates too!
            scheduledTasks: tasks,
            isActive: true
        }, () => {
            console.log("Remote Schedule Applied Successfully.");
            updateExtensionIcon(true);
        });
    }
}

// --- STANDARD EXTENSION LOGIC BELOW ---

function updateExtensionIcon(isActive) {
  const state = isActive ? 'active' : 'inactive';
  chrome.action.setIcon({
      path: { "16": `icons/icon-${state}-16.png`, "48": `icons/icon-${state}-48.png`, "128": `icons/icon-${state}-128.png` }
  }, () => { if (chrome.runtime.lastError) console.warn("Icon error"); });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.isActive) updateExtensionIcon(changes.isActive.newValue);
});
chrome.storage.sync.get(['isActive'], (result) => updateExtensionIcon(result.isActive));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.type === "TASK_COMPLETED" || request.type === "TASK_SKIPPED_ALREADY_ON" || request.type === "TASK_SKIPPED_ALREADY_OFF") {
    
    sendResponse({ status: "received" });

    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      if (!topic) return;

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      
      let notifTitle = "";
      let notifBody = "";
      let notifTags = "";

      if (request.type === "TASK_COMPLETED") {
          if (request.action === 'IN') {
              notifTitle = "Clocked In!";
              notifBody = `Successfully clocked in at ${timeStr}`;
              notifTags = "white_check_mark";
          } else {
              notifTitle = "Clocked Out!";
              notifBody = `Successfully clocked out at ${timeStr}`;
              notifTags = "x";
          }
      } 
      else if (request.type === "TASK_SKIPPED_ALREADY_ON") {
          notifTitle = "Skipped (Already In)";
          notifBody = `Attempted to Clock In at ${timeStr}, but switch was already ON.`;
          notifTags = "warning";
      }
      else if (request.type === "TASK_SKIPPED_ALREADY_OFF") {
          notifTitle = "Skipped (Already Out)";
          notifBody = `Attempted to Clock Out at ${timeStr}, but switch was already OFF.`;
          notifTags = "warning";
      }

      console.log(`Notify: ${notifTitle}`);
      
      fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        body: notifBody,
        headers: { 'Title': notifTitle, 'Priority': 'high', 'Tags': notifTags }
      }).catch(err => console.error("Notify Error:", err));
    });

  } else if (request.type === "TASK_FAILED") {
      sendResponse({ status: "fail_received" });
      chrome.storage.sync.set({ isActive: false });
  }
  return true; 
});