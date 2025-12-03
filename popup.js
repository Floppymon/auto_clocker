document.addEventListener('DOMContentLoaded', () => {
  
  // DOM Elements
  const scheduleView = document.getElementById('scheduleView');
  const settingsView = document.getElementById('settingsView');
  const settingsIcon = document.getElementById('settings-icon');
  const backIcon = document.getElementById('back-icon');
  const actionButton = document.getElementById('actionBtn');
  const saveTopicButton = document.getElementById('saveTopicBtn');
  const timeInput = document.getElementById('timeInput');
  const ntfyTopicInput = document.getElementById('ntfyTopicInput');
  const settingsStatus = document.getElementById('settingsStatus');

  // --- Helper Functions ---

  // Helper function to get the ordinal suffix (st, nd, rd, th)
  function getOrdinalSuffix(day) {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  // Helper function to toggle Button and Badge UI
  function updateUI(isActive) {
    const badge = document.getElementById('status-badge');
    
    if (!badge || !actionButton) return;

    if (isActive) {
      // State: ACTIVE
      badge.textContent = "Active";
      badge.className = "active-badge"; 
      actionButton.textContent = "Deactivate";
      actionButton.className = "deactivate-btn"; 
    } else {
      // State: INACTIVE
      badge.textContent = "Inactive";
      badge.className = "inactive-badge"; 
      actionButton.textContent = "Activate";
      actionButton.className = ""; 
    }
  }
  
  // Function to switch views
  function showView(viewId) {
    scheduleView.classList.add('hidden');
    settingsView.classList.add('hidden');
    
    if (viewId === 'schedule') {
        scheduleView.classList.remove('hidden');
    } else if (viewId === 'settings') {
        settingsView.classList.remove('hidden');
    }
  }

  // --- INITIALIZATION ---

  // 1. Load saved settings (Time, Active state, and Ntfy Topic)
  chrome.storage.sync.get(['targetTime', 'isActive', 'ntfyTopic'], (result) => {
    // Load Time
    if (result.targetTime) {
      timeInput.value = result.targetTime;
    }
    // Load Ntfy Topic
    if (result.ntfyTopic) {
      ntfyTopicInput.value = result.ntfyTopic;
    }
    // Set initial UI state
    updateUI(result.isActive);
  });
  
  // --- VIEW HANDLERS ---
  
  settingsIcon.addEventListener('click', () => {
      showView('settings');
      settingsStatus.textContent = ''; // Clear status when opening settings
  });

  backIcon.addEventListener('click', () => {
      showView('schedule');
  });

  // --- SETTINGS LOGIC (Save Topic) ---
  
  saveTopicButton.addEventListener('click', () => {
      const topic = ntfyTopicInput.value.trim();
      
      if (!topic) {
          settingsStatus.textContent = "Please enter a valid topic name.";
          settingsStatus.style.color = '#ff4757'; // Red error color
          return;
      }
      
      chrome.storage.sync.set({ ntfyTopic: topic }, () => {
          settingsStatus.textContent = "Topic saved successfully!";
          settingsStatus.style.color = '#2ed573'; // Green success color
      });
  });

  // --- SCHEDULE LOGIC (Activate / Deactivate) ---
  
  if (actionButton) {
      actionButton.addEventListener('click', () => {
        const isCurrentlyActive = actionButton.textContent === "Deactivate";
        const statusEl = document.getElementById('status');
        
        // Clear previous status message
        statusEl.classList.remove('show');
        statusEl.className = ''; 

        if (isCurrentlyActive) {
            // --- DEACTIVATE LOGIC ---
            chrome.storage.sync.set({ isActive: false }, () => {
                
                // Show Error Class (Red Box)
                statusEl.className = 'status-error show';
                statusEl.textContent = "Timer Cancelled.";
                
                updateUI(false);
            });

        } else {
            // --- ACTIVATE LOGIC ---
            const timeValue = timeInput.value;
            
            if (!timeValue) {
                // Show Error Class (Red Box)
                statusEl.className = 'status-error show';
                statusEl.textContent = "Please enter a time.";
                return;
            }

            // Calculate details for confirmation message
            const now = new Date();
            const [h, m] = timeValue.split(':');
            const target = new Date();
            target.setHours(h, m, 0, 0);
            
            // If time has passed today, schedule for tomorrow
            if (target <= now) target.setDate(target.getDate() + 1);

            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            
            // Apply ordinal suffix (e.g., '20th')
            const dayOfMonth = target.getDate();
            const dayWithSuffix = dayOfMonth + getOrdinalSuffix(dayOfMonth);
            
            // Format: "Wednesday - 20th November 2025"
            const datePart = `${days[target.getDay()]} - ${dayWithSuffix} ${months[target.getMonth()]} ${target.getFullYear()}`;
            
            // Save & Set Active
            chrome.storage.sync.set({ 
                targetTime: timeValue,
                isActive: true 
            }, () => {
                
                // Apply Success Class (Green Box)
                statusEl.className = 'status-success show';
                
                // Set Content (Date on top, large time on bottom)
                statusEl.innerHTML = `
                    <div style="font-weight: 600; letter-spacing: 0.5px;">${datePart}</div>
                    <div style="font-size: 14px; font-weight: 700; margin-top: 4px;">${timeValue}</div>
                `;
                
                updateUI(true);
            });
        }
      });
  }
  
  // --- KEYPRESS HANDLER (Allows 'Enter' to activate) ---
  if (timeInput && actionButton) {
      timeInput.addEventListener('keydown', (event) => {
          // Check if the key pressed is the Enter key
          if (event.key === 'Enter') {
              // Prevent the default browser action (like form submission)
              event.preventDefault(); 
              
              // Programmatically click the Activate/Deactivate button
              actionButton.click();
          }
      });
  }
});