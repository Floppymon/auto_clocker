//

// --- HELPER: Change the Toolbar Icon ---
function updateExtensionIcon(isActive) {
  const state = isActive ? 'active' : 'inactive';
  
  // REQUIRED: Ensure you have icon-active-16.png (Green) and icon-inactive-16.png (Red) in your folder
  chrome.action.setIcon({
      path: {
          "16": `icons/icon-${state}-16.png`,
          "48": `icons/icon-${state}-48.png`,
          "128": `icons/icon-${state}-128.png`
      }
  }, () => {
      // Ignore errors if icons are missing, just log warning
      if (chrome.runtime.lastError) {
          console.warn("Icon update failed (images might be missing):", chrome.runtime.lastError.message);
      }
  });
}

// --- LISTENER: Watch for State Changes (Fixes Icon Switching) ---
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.isActive) {
      updateExtensionIcon(changes.isActive.newValue);
  }
});

// --- INITIALIZATION ---
chrome.storage.sync.get(['isActive'], (result) => {
  updateExtensionIcon(result.isActive);
});

// 1. LISTEN FOR MESSAGES FROM CONTENT SCRIPT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.type === "TASK_COMPLETED") {
    
    // *** FIX 1: Send a receipt immediately to prevent "Context Invalidated" error ***
    sendResponse({ status: "received" }); 
    // ******************************************************************************

    // *** FIX 2: Set Icon to Inactive ***
    chrome.storage.sync.set({ isActive: false }, () => {
        console.log("Background: Task completed signal received. State set to Inactive.");
    });

    // --- Notification Logic ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      
      if (topic) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

        let notifTitle = "";
        let notifBody = "";
        let notifTags = "";

        if (request.checked === true) {
            notifTitle = "Clocked in! (IN)"; 
            notifBody = `You have been clocked in at ${timeStr}`;
            notifTags = "white_check_mark"; 
        } else {
            notifTitle = "Clocked out! (OUT)"; 
            notifBody = `You have been clocked out at ${timeStr}`;
            notifTags = "x"; 
        }

        console.log(`Sending notification to ntfy.sh/${topic}: ${notifTitle}`);
        
        fetch(`https://ntfy.sh/${topic}`, {
          method: 'POST',
          body: notifBody,
          headers: {
              'Title': notifTitle,
              'Priority': 'high',
              'Tags': notifTags
          }
        }).catch(err => console.error("Notification Fetch Error:", err));
      }
    });

  } else if (request.type === "TASK_FAILED") {
      // Acknowledge failure message too
      sendResponse({ status: "fail_received" });
      chrome.storage.sync.set({ isActive: false });
  }
  
  // Important: If we were doing async work before sendResponse, we would need 'return true;' here.
  // But since we called sendResponse synchronously at the top, we don't strictly need it, but it's good practice.
  return true; 
});