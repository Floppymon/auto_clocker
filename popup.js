//
document.addEventListener('DOMContentLoaded', () => {
  
  // Elements
  const scheduleView = document.getElementById('scheduleView');
  const settingsView = document.getElementById('settingsView');
  const activeScheduleView = document.getElementById('activeScheduleView'); 
  
  const settingsIcon = document.getElementById('settings-icon');
  const listIcon = document.getElementById('list-icon'); 
  const notificationDot = document.getElementById('notification-dot'); 

  const backIconSettings = document.getElementById('back-icon-settings');
  const backIconList = document.getElementById('back-icon-list');
  
  const actionButton = document.getElementById('actionBtn');
  const saveTopicButton = document.getElementById('saveTopicBtn');
  const clockInInput = document.getElementById('clockInTime');
  const clockOutInput = document.getElementById('clockOutTime');
  const randomizeToggle = document.getElementById('randomizeToggle');
  const ntfyTopicInput = document.getElementById('ntfyTopicInput');
  const settingsStatus = document.getElementById('settingsStatus');
  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const currentMonthLabel = document.getElementById('currentMonthLabel');
  const calendarGrid = document.getElementById('calendarGrid');
  const scheduleListContainer = document.getElementById('scheduleListContainer');
  const statusEl = document.getElementById('status');

  let currentDate = new Date(); 
  let selectedDates = []; 

  // --- CALENDAR LOGIC ---
  function renderCalendar(date) {
    calendarGrid.innerHTML = "";
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    currentMonthLabel.textContent = `${monthNames[month]} ${year}`;

    const firstDayIndex = new Date(year, month, 1).getDay(); 
    const lastDay = new Date(year, month + 1, 0).getDate();
    const todayDate = new Date(); todayDate.setHours(0,0,0,0);

    for (let i = 0; i < firstDayIndex; i++) {
        const emptyDiv = document.createElement("div");
        emptyDiv.classList.add("cal-day", "empty");
        calendarGrid.appendChild(emptyDiv);
    }
    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 1; i <= lastDay; i++) {
        const dayDiv = document.createElement("div");
        dayDiv.textContent = i;
        dayDiv.classList.add("cal-day");
        
        const checkDate = new Date(year, month, i);
        const y = checkDate.getFullYear();
        const m = String(checkDate.getMonth() + 1).padStart(2, '0');
        const d = String(checkDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        if (checkDate < todayDate) dayDiv.classList.add("past");
        else {
            dayDiv.addEventListener('click', () => toggleDateSelection(dateStr, dayDiv));
            if (selectedDates.includes(dateStr)) dayDiv.classList.add("selected");
            if (dateStr === todayStr) dayDiv.classList.add("today");
        }
        calendarGrid.appendChild(dayDiv);
    }
  }

  function toggleDateSelection(dateStr, element) {
      if (selectedDates.includes(dateStr)) {
          selectedDates = selectedDates.filter(d => d !== dateStr);
          element.classList.remove("selected");
      } else {
          selectedDates.push(dateStr);
          element.classList.add("selected");
      }
      selectedDates.sort();
  }

  prevMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(currentDate); });
  nextMonthBtn.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(currentDate); });

  // --- UI HELPERS ---
  function updateUI(isActive) {
    const badge = document.getElementById('status-badge');
    if (isActive) {
      badge.textContent = "Active"; badge.className = "active-badge"; 
      actionButton.textContent = "Deactivate"; actionButton.className = "deactivate-btn"; 
    } else {
      badge.textContent = "Inactive"; badge.className = "inactive-badge"; 
      actionButton.textContent = "Activate"; actionButton.className = ""; 
    }
  }
  
  function toggleNotificationDot(hasTasks) {
      if (hasTasks) {
          notificationDot.classList.remove('hidden');
      } else {
          notificationDot.classList.add('hidden');
      }
  }

  function showView(viewId) {
    scheduleView.classList.add('hidden'); 
    settingsView.classList.add('hidden');
    activeScheduleView.classList.add('hidden');
    
    if (viewId === 'schedule') scheduleView.classList.remove('hidden');
    else if (viewId === 'settings') settingsView.classList.remove('hidden');
    else if (viewId === 'list') activeScheduleView.classList.remove('hidden');
  }

  function renderScheduleList(tasks) {
      if (!tasks || tasks.length === 0) {
          scheduleListContainer.innerHTML = "<div style='text-align:center;color:#b2bec3;margin-top:20px;'>No active schedule.</div>";
          return;
      }
      scheduleListContainer.innerHTML = "";
      
      const grouped = {};
      tasks.forEach(task => {
          if (!grouped[task.dateStr]) grouped[task.dateStr] = [];
          grouped[task.dateStr].push(task);
      });

      for (const [dateStr, dateTasks] of Object.entries(grouped)) {
          const item = document.createElement('div');
          item.className = 'sched-item';
          
          const [yy, mm, dd] = dateStr.split('-');
          const d = new Date(yy, mm - 1, dd);
          const dateDisplay = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

          const timeDetails = dateTasks.map(t => {
              const type = t.action === 'IN' ? 'IN' : 'OUT';
              const dt = new Date(t.timestamp);
              const timeStr = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              return `<span style="color:${type==='IN'?'#2ed573':'#ff4757'}">${type}</span> <span class="sched-tag">${timeStr}</span>`;
          }).join(" | ");

          item.innerHTML = `<span class="sched-date">${dateDisplay}</span> <div class="sched-time-block">${timeDetails}</div>`;
          scheduleListContainer.appendChild(item);
      }
  }

  // --- INITIALIZATION ---
  chrome.storage.sync.get(['clockInTime', 'clockOutTime', 'targetDates', 'isActive', 'ntfyTopic', 'isRandomized', 'scheduledTasks'], (result) => {
    if (result.clockInTime) clockInInput.value = result.clockInTime;
    if (result.clockOutTime) clockOutInput.value = result.clockOutTime;
    if (result.targetDates && Array.isArray(result.targetDates)) selectedDates = result.targetDates;
    if (result.isRandomized !== undefined) randomizeToggle.checked = result.isRandomized;
    if (result.ntfyTopic) ntfyTopicInput.value = result.ntfyTopic;

    renderCalendar(currentDate);
    updateUI(result.isActive);

    const hasTasks = result.isActive && result.scheduledTasks && result.scheduledTasks.length > 0;
    
    // Toggle Dot on Load
    toggleNotificationDot(hasTasks);
  });
  
  // --- HANDLERS ---
  settingsIcon.addEventListener('click', () => showView('settings'));
  listIcon.addEventListener('click', () => {
      chrome.storage.sync.get(['scheduledTasks'], (res) => {
          renderScheduleList(res.scheduledTasks || []);
          showView('list');
      });
  });
  
  backIconSettings.addEventListener('click', () => showView('schedule'));
  backIconList.addEventListener('click', () => showView('schedule'));

  saveTopicButton.addEventListener('click', () => {
      const topic = ntfyTopicInput.value.trim();
      if (!topic) { settingsStatus.textContent = "Invalid topic."; settingsStatus.style.color = '#ff4757'; return; }
      chrome.storage.sync.set({ ntfyTopic: topic }, () => { settingsStatus.textContent = "Saved!"; settingsStatus.style.color = '#2ed573'; });
  });
  randomizeToggle.addEventListener('change', () => {
      chrome.storage.sync.set({ isRandomized: randomizeToggle.checked });
  });

  // --- ACTIVATE / DEACTIVATE ---
  actionButton.addEventListener('click', () => {
    const isCurrentlyActive = actionButton.textContent === "Deactivate";
    statusEl.classList.remove('show'); statusEl.className = ''; 

    if (isCurrentlyActive) {
        chrome.storage.sync.set({ isActive: false, scheduledTasks: [] }, () => {
            statusEl.className = 'status-error show';
            statusEl.textContent = "Deactivated!"; // <--- UPDATED HERE
            updateUI(false);
            toggleNotificationDot(false); 
        });
    } else {
        const inTime = clockInInput.value;
        const outTime = clockOutInput.value;
        
        if (!inTime && !outTime) {
            statusEl.className = 'status-error show';
            statusEl.textContent = "Please set at least one time.";
            return;
        }
        if (selectedDates.length === 0) {
            statusEl.className = 'status-error show';
            statusEl.textContent = "Select at least one date.";
            return;
        }

        const isRandom = randomizeToggle.checked;
        const tasks = [];
        const now = new Date();

        selectedDates.forEach(dateStr => {
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
            addTask(inTime, 'IN');
            addTask(outTime, 'OUT');
        });

        if (tasks.length === 0) {
            statusEl.className = 'status-error show';
            statusEl.textContent = "All calculated times are in the past.";
            return;
        }

        tasks.sort((a, b) => a.timestamp - b.timestamp);

        chrome.storage.sync.set({ 
            clockInTime: inTime,
            clockOutTime: outTime,
            targetDates: selectedDates,
            scheduledTasks: tasks,
            isActive: true 
        }, () => {
            statusEl.className = 'status-success show';
            statusEl.style.fontWeight = 'bold';
            statusEl.textContent = "Saved!";
            updateUI(true);
            toggleNotificationDot(true); 
        });
    }
  });
});