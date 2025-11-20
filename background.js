// 1. LISTEN FOR MESSAGES FROM CONTENT SCRIPT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TASK_COMPLETED") {
    
    // *** FIX: Ensure isActive is set to false in the persistent background script upon success ***
    chrome.storage.sync.set({ isActive: false }, () => {
        console.log("Background: Task completed signal received. State set to Inactive.");
    });
    // ************************************************************************************

    // --- Handle TASK_COMPLETED (Success) logic (Notification part) ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';

      // FIX: Check for a valid topic string before proceeding
      if (topic) {
        // 1. Get Current Time for the message
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // 2. Determine Message based on Checkbox State
        let notifTitle = "";
        let notifBody = "";
        let notifTags = "";

        if (request.checked === true) {
            // CLOCKED IN (Using safe ASCII)
            notifTitle = "Clocked in! (IN)"; 
            notifBody = `You have been clocked in at ${timeStr}`;
            notifTags = "white_check_mark"; 
        } else {
            // CLOCKED OUT (Using safe ASCII)
            notifTitle = "Clocked out! (OUT)"; 
            notifBody = `You have been clocked out at ${timeStr}`;
            notifTags = "x"; 
        }

        console.log(`Sending notification to ntfy.sh/${topic}: ${notifTitle}`);
        
        // 3. Send request to Ntfy.sh (Headers method)
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: notifBody,
          headers: {
              'Title': notifTitle,
              'Priority': 'high',
              'Tags': notifTags
          }
        })
        .then(response => {
            // FIX: Gracefully handle non-2xx HTTP status codes (e.g., invalid topic)
            if (!response.ok) {
                console.error(`Notification failed with status: ${response.status}. Check if topic '${topic}' is valid on ntfy.sh.`);
            } else {
                console.log("Notification sent successfully.");
            }
        })
        .catch(err => {
            // FIX: Handle network errors (offline, connection issues)
            console.error("Notification failed due to a network or fetch error:", err.message);
        });
      } else {
        console.warn("Ntfy Topic is not set or is invalid. Notification skipped.");
      }
    });
  } else if (request.type === "TASK_FAILED") {
    
    // --- Handle TASK_FAILED (Error) logic ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';

      // FIX: Check for a valid topic string before proceeding
      if (topic) {
        console.log(`Sending ERROR notification to ntfy.sh/${topic}`);
        
        // Send high-priority error notification
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: `ERROR: Auto Clocker failed to find the button! Please check the desk booking tab immediately.`,
          headers: {
              'Title': 'Auto Clocker FAILED!',
              'Priority': 'urgent', // Set to urgent for critical error
              'Tags': 'x,warning'
          }
        })
        .then(response => {
             // FIX: Gracefully handle non-2xx HTTP status codes
            if (!response.ok) {
                console.error(`Error notification failed with status: ${response.status}. Check if topic '${topic}' is valid on ntfy.sh.`);
            } else {
                console.log("Error notification sent successfully.");
            }
        })
        .catch(err => {
            // FIX: Handle network errors
            console.error("Error notification failed due to a network or fetch error:", err.message);
        });
      } else {
        console.warn("Ntfy Topic is not set or is invalid. Error notification skipped.");
      }
    });

    // Ensure the task is set to inactive if it failed to execute
    chrome.storage.sync.set({ isActive: false });
  }
});
// Icon path definitions (MUST match manifest.json)
const ACTIVE_ICON_PATH = { 
    "16": "icons/icon-active-16.png", 
    "48": "icons/icon-active-48.png", 
    "128": "icons/icon-active-128.png" 
};
const INACTIVE_ICON_PATH = { 
    "16": "icons/icon-inactive-16.png", 
    "48": "icons/icon-inactive-48.png", 
    "128": "icons/icon-inactive-128.png" 
};

// 2. ALARM & STORAGE LOGIC 
chrome.storage.onChanged.addListener((changes, namespace) => {
  // If Time changes, recreate alarm (only if active)
  if (changes.targetTime) {
     chrome.storage.sync.get(['isActive'], (res) => {
         if(res.isActive) createAlarm(changes.targetTime.newValue);
     });
  }
  
  // If Active Status changes (Handles Icon Switching)
  if (changes.isActive) {
    const newValue = changes.isActive.newValue;
    if (newValue === true) {
        chrome.storage.sync.get(['targetTime'], (res) => {
            if (res.targetTime) createAlarm(res.targetTime);
        });
        // Set icon to active using the map
        chrome.action.setIcon({ path: ACTIVE_ICON_PATH });
    } else {
        chrome.alarms.clear("bookingAlarm");
        console.log("Background: Timer cancelled by user.");
        // Set icon to inactive using the map
        chrome.action.setIcon({ path: INACTIVE_ICON_PATH });
    }
  }
});

// Check on startup (re-arm if needed and set initial icon)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get(['targetTime', 'isActive'], (result) => {
    if (result.targetTime && result.isActive) {
      createAlarm(result.targetTime);
      chrome.action.setIcon({ path: ACTIVE_ICON_PATH }); 
    } else {
      chrome.action.setIcon({ path: INACTIVE_ICON_PATH }); 
    }
  });
});

// Also set icon on extension install/update (or initial load)
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['isActive'], (result) => {
    if (result.isActive) {
      chrome.action.setIcon({ path: ACTIVE_ICON_PATH });
    } else {
      chrome.action.setIcon({ path: INACTIVE_ICON_PATH });
    }
  });
});


function createAlarm(timeString) {
  if (!timeString) return;
  chrome.alarms.clear("bookingAlarm");

  const now = new Date();
  const [h, m] = timeString.split(':');
  const target = new Date();
  target.setHours(h, m, 0, 0);

  // If time has passed today, schedule for tomorrow
  if (target <= now) target.setDate(target.getDate() + 1);

  chrome.alarms.create("bookingAlarm", { when: target.getTime() });
  console.log(`Background: Alarm set for ${target.toLocaleString()}`);
}

// Alarm Trigger
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bookingAlarm") {
    console.log("Background: Alarm fired! Opening tab...");
    
    // Mark as Inactive immediately
    chrome.storage.sync.set({ isActive: false }); // This will also trigger the icon change via onChanged listener

    const targetUrl = "https://desk-booking-system.bettercollective.rocks/";

    // Check if tab is already open
    chrome.tabs.query({url: targetUrl + "*"}, (tabs) => {
      if (tabs.length > 0) {
        // Reload existing tab
        chrome.tabs.reload(tabs[0].id);
        
        // FIX: This ensures the tab is reloaded but does NOT steal focus.
        chrome.tabs.update(tabs[0].id, { active: false }); 
      } else {
        // Open new tab
        // FIX: Explicitly setting active: false to prevent stealing focus.
        chrome.tabs.create({ url: targetUrl, active: false });
      }
    });
  }
});