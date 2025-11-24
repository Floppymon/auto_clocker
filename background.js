//

// --- HELPER: Change the Toolbar Icon ---
function updateExtensionIcon(isActive) {
  const state = isActive ? 'active' : 'inactive';
  
  // This assumes you have icon-active-16.png, icon-active-48.png, etc.
  // If you haven't created the green icons yet, you must do so!
  chrome.action.setIcon({
      path: {
          "16": `icons/icon-${state}-16.png`,
          "48": `icons/icon-${state}-48.png`,
          "128": `icons/icon-${state}-128.png`
      }
  }, () => {
      if (chrome.runtime.lastError) {
          console.warn("Could not set icon (images might be missing):", chrome.runtime.lastError.message);
      }
  });
}

// --- LISTENER: Watch for State Changes ---
// This handles BOTH the Popup button clicks AND the automatic reset when a task finishes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.isActive) {
      updateExtensionIcon(changes.isActive.newValue);
  }
});

// --- INITIALIZATION ---
// Ensure icon is correct when browser starts
chrome.storage.sync.get(['isActive'], (result) => {
  updateExtensionIcon(result.isActive);
});

// 1. LISTEN FOR MESSAGES FROM CONTENT SCRIPT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TASK_COMPLETED") {
    
    // *** CRITICAL FIX: Ensure isActive is set to false in the persistent background script ***
    chrome.storage.sync.set({ isActive: false }, () => {
        console.log("Background: Task completed signal received. State set to Inactive.");
        // Note: The storage.onChanged listener above will catch this and turn the icon Red automatically
    });
    // ************************************************************************************

    // --- Handle TASK_COMPLETED (Success) logic (Notification part) ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      
      if (topic) {
        // 1. Get Current Time for the message
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        // 2. Determine Message based on Checkbox State
        let notifTitle = "";
        let notifBody = "";
        let notifTags = "";

        if (request.checked === true) {
            // CLOCKED IN
            notifTitle = "Clocked in! (IN)"; 
            notifBody = `You have been clocked in at ${timeStr}`;
            notifTags = "white_check_mark"; 
        } else {
            // CLOCKED OUT
            notifTitle = "Clocked out! (OUT)"; 
            notifBody = `You have been clocked out at ${timeStr}`;
            notifTags = "x"; 
        }

        console.log(`Sending notification to ntfy.sh/${topic}: ${notifTitle}`);
        
        // 3. Send request to Ntfy.sh
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
            if (!response.ok) {
                console.error(`Notification failed with status: ${response.status}.`);
            } else {
                console.log("Notification sent successfully.");
            }
        })
        .catch(err => {
            console.error("Notification failed due to a network error:", err.message);
        });
      } else {
        console.warn("Ntfy Topic is not set or is invalid. Notification skipped.");
      }
    });
  } else if (request.type === "TASK_FAILED") {
      // Ensure icon resets on failure too
      chrome.storage.sync.set({ isActive: false });
  }
});