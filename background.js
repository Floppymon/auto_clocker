// 1. LISTEN FOR MESSAGES FROM CONTENT SCRIPT
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TASK_COMPLETED") {
    
    // *** CRITICAL FIX: Ensure isActive is set to false in the persistent background script ***
    chrome.storage.sync.set({ isActive: false }, () => {
        console.log("Background: Task completed signal received. State set to Inactive.");
    });
    // ************************************************************************************

    // --- Handle TASK_COMPLETED (Success) logic (Notification part) ---
    chrome.storage.sync.get(['ntfyTopic'], (result) => {
      const topic = result.ntfyTopic ? result.ntfyTopic.trim() : '';
      
      // ... (rest of the notification logic remains here) ...
      
      // ... (The rest of the successful notification logic you implemented)
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
            notifTitle = "Clocked in! (IN)"; // Using safe ASCII
            notifBody = `You have been clocked in at ${timeStr}`;
            notifTags = "white_check_mark"; 
        } else {
            // CLOCKED OUT
            notifTitle = "Clocked out! (OUT)"; // Using safe ASCII
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
            if (!response.ok) {
                console.error(`Notification failed with status: ${response.status}. Check if topic '${topic}' is valid on ntfy.sh.`);
            } else {
                console.log("Notification sent successfully.");
            }
        })
        .catch(err => {
            console.error("Notification failed due to a network or fetch error:", err.message);
        });
      } else {
        console.warn("Ntfy Topic is not set or is invalid. Notification skipped.");
      }
    });
  } 
  // ... (The rest of the listener for TASK_FAILED, etc., remains the same) ...
});