// 1. LISTEN FOR MESSAGES FROM CONTENT SCRIPT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TASK_COMPLETED") {
    
    // --- Handle TASK_COMPLETED (Success) logic ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic;

      if (topic) {
        // 1. Get Current Time for the message
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // 2. Determine Message based on Checkbox State
        let notifTitle = "";
        let notifBody = "";
        let notifTags = "";

        if (request.checked === true) {
            // CLOCKED OUT
            notifTitle = "Clocked out!"; 
            notifBody = `You have been clocked out at ${timeStr}`;
            notifTags = "x"; 
        } else {
            // CLOCKED IN
            notifTitle = "Clocked in!"; 
            notifBody = `You have been clocked in at ${timeStr}`;
            notifTags = "white_check_mark"; 
        }

        console.log(`Sending notification to ntfy.sh/${topic}: ${notifTitle}`);
        
        // 3. Send request to Ntfy.sh (Headers method)
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: notifBody,
          headers: {
              // REMOVE encodeURIComponent()
              'Title': notifTitle, 
              'Priority': 'high',
              'Tags': notifTags
          }
        })
        .then(response => console.log("Notification sent:", response.status))
        .catch(err => console.error("Notification failed:", err));
      } else {
        console.warn("Ntfy Topic is not set. Notification skipped.");
      }
    });
  } else if (request.type === "TASK_FAILED") {
    
    // --- Handle TASK_FAILED (Error) logic ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic;

      if (topic) {
        console.log(`Sending ERROR notification to ntfy.sh/${topic}`);
        
       // ... (TASK_FAILED logic around line 59)
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: `❌ ERROR: Auto Clocker failed to find the button! Please check the desk booking tab immediately.`,
          headers: {
              'Title': encodeURIComponent('Auto Clocker FAILED!'), // Use encodeURIComponent
              'Priority': 'urgent',
              'Tags': encodeURIComponent('x,warning') // Use encodeURIComponent
          }
        })
        .then(response => console.log("Error notification sent:", response.status))
        .catch(err => console.error("Error notification failed:", err));
      } else {
        console.warn("Ntfy Topic is not set. Error notification skipped.");
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
        
        // *** CHANGE HERE: REMOVED { active: true } ***
        // This ensures the tab is reloaded but does NOT steal focus.
        chrome.tabs.update(tabs[0].id, { active: false }); 
      } else {
        // Open new tab
        // *** CHANGE HERE: Setting active: false (default is typically false, but explicit is better) ***
        chrome.tabs.create({ url: targetUrl, active: false });
      }
    });
  }
});