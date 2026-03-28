// Dashboard Main Logic
document.addEventListener('DOMContentLoaded', () => {
    // Check authentication
    if (!Storage.isAuthenticated()) {
        window.location.href = 'auth.html?mode=login';
        return;
    }
    
    // Initialize dashboard
    initDashboard();
    initNavigation();
    initProfileMenu();
    initSidebarToggle();
    loadUserData();
    loadDashboardStats();
    initCalendar();
    initPerformanceChart();
});

let performanceChartInstance = null;

function initDashboard() {
    // Set initial view
    showView('dashboard');
    updateVisualMetrics({ totalInterviews: 0, avgScore: 0, streak: 0 });
    
    // Display current date
    const currentDateEl = document.getElementById('current-date');
    if (currentDateEl) {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentDateEl.textContent = now.toLocaleDateString('en-US', options);
    }
}

function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active class from all items
            navItems.forEach(nav => nav.classList.remove('active'));
            
            // Add active class to clicked item
            item.classList.add('active');
            
            // Show corresponding view
            const view = item.getAttribute('data-view');
            showView(view);
            
            // Close sidebar on mobile after clicking a nav item
            if (window.innerWidth < 768) {
                closeSidebar();
            }
        });
    });
}

function initSidebarToggle() {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay?.classList.toggle('hidden');
        });
    }
}

// Global function for sidebar overlay onclick
function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar?.classList.remove('open');
    overlay?.classList.add('hidden');
}

function showView(viewName) {
    // Hide all views
    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.add('hidden');
    });
    
    // Show selected view
    const selectedView = document.getElementById(`${viewName}-view`);
    if (selectedView) {
        selectedView.classList.remove('hidden');
    }
    
    // Load view-specific content
    loadViewContent(viewName);
}

function loadViewContent(viewName) {
    switch(viewName) {
        case 'dashboard':
            loadDashboardStats();
            break;
        case 'resume':
            loadResume();
            break;
        case 'ats':
            // ATS checker modal button
            console.log('=== ATS View Initialized ===');
            const atsBtn = document.getElementById('open-ats-modal');
            console.log('ATS Button found:', !!atsBtn);
            console.log('ATSChecker exists:', typeof ATSChecker !== 'undefined');
            console.log('ATSChecker.instance exists:', typeof ATSChecker !== 'undefined' && !!ATSChecker.instance);
            
            if (atsBtn) {
                atsBtn.onclick = (e) => {
                    console.log('=== ATS BUTTON CLICKED ===');
                    e.preventDefault();
                    e.stopPropagation();
                    
                    try {
                        if (typeof ATSChecker !== 'undefined' && ATSChecker.instance) {
                            console.log('Opening ATS modal...');
                            ATSChecker.instance.openModal();
                        } else {
                            console.error('ATSChecker not available!');
                            alert('ATS Checker is not loaded. Please refresh the page.');
                        }
                    } catch (error) {
                        console.error('Error opening ATS modal:', error);
                        alert('Error opening ATS Checker: ' + error.message);
                    }
                    
                    return false;
                };
            } else {
                console.error('ATS button not found!');
            }
            break;
        case 'jdmatcher':
            // JD matcher modal button
            const jdBtn = document.getElementById('open-jd-modal');
            if (jdBtn) {
                jdBtn.onclick = () => JDMatcher.instance.openModal();
            }
            break;
        case 'interview':
            // Single start button
            const interviewBtn = document.getElementById('start-interview-btn');
            if (interviewBtn) {
                interviewBtn.onclick = () => InterviewManager.instance.openSetupModal();
            }
            // Load past sessions
            loadInterviewSessions();
            break;
        case 'jobs':
            loadJobs();
            break;
        case 'profile':
            loadProfile();
            break;
    }
}

function initProfileMenu() {
    const profileBtn = document.getElementById('profile-menu-btn');
    const profileMenu = document.getElementById('profile-menu');
    const logoutBtn = document.getElementById('logout-btn');
    
    profileBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenu.classList.toggle('hidden');
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', () => {
        profileMenu?.classList.add('hidden');
    });
    
    // Logout
    logoutBtn?.addEventListener('click', async (e) => {
        e.preventDefault();
        
        if (confirm('Are you sure you want to logout?')) {
            await API.logout();
            window.location.href = 'index.html';
        }
    });
}

function loadUserData() {
    const user = Storage.getUser();
    if (!user) return;
    
    // Update user info in header
    const userName = document.getElementById('user-name');
    const userAvatar = document.getElementById('user-avatar');
    const streakCount = document.getElementById('streak-count');
    const pointsCount = document.getElementById('points-count');
    
    if (userName) userName.textContent = user.fullName || user.email;
    
    if (userAvatar) {
        if (user.profilePicture) {
            // Show profile picture
            userAvatar.parentElement.innerHTML = `<img src="${user.profilePicture}" class="w-8 h-8 rounded-full object-cover" alt="Profile">`;
        } else {
            // Show initial
            userAvatar.textContent = (user.fullName || user.email).charAt(0).toUpperCase();
        }
    }
    
    if (streakCount) streakCount.textContent = user.streak || 0;
    if (pointsCount) pointsCount.textContent = user.totalPoints || 0;
}

async function loadDashboardStats() {
    try {
        const [statsResponse, interviewsResponse] = await Promise.all([
            API.getDashboardStats(),
            API.getInterviews()
        ]);

        if (!statsResponse.success) return;

        const stats = statsResponse.data;
        let totalInterviews = Number(stats.totalInterviews) || 0;
        let avgScore = Number(stats.avgScore) || 0;
        const streak = Number(stats.streak) || 0;
        let recentInterviews = Array.isArray(stats.recentInterviews) ? stats.recentInterviews : [];
        let latestScore = 0;
        let scoreDelta = 0;

        if (interviewsResponse.success && Array.isArray(interviewsResponse.data)) {
            const normalized = normalizeInterviewScoreRecords(interviewsResponse.data);
            if (normalized.length > 0) {
                totalInterviews = normalized.length;
                avgScore = Math.round(normalized.reduce((sum, record) => sum + record.score, 0) / normalized.length);
                latestScore = normalized[normalized.length - 1].score;
                scoreDelta = normalized.length > 1
                    ? latestScore - normalized[normalized.length - 2].score
                    : 0;

                recentInterviews = normalized
                    .slice(-5)
                    .reverse()
                    .map((record) => ({ date: record.dateISO, score: record.score }));
            }
        }

        const totalInterviewsEl = document.getElementById('total-interviews');
        const avgScoreEl = document.getElementById('avg-score');
        const streakDisplayEl = document.getElementById('streak-display');

        if (totalInterviewsEl) totalInterviewsEl.textContent = totalInterviews;
        if (avgScoreEl) avgScoreEl.textContent = `${Math.round(avgScore)}%`;
        if (streakDisplayEl) streakDisplayEl.textContent = `${streak}d`;

        updateVisualMetrics({ totalInterviews, avgScore, streak });
        updateMetricAssistiveText({ totalInterviews, avgScore, streak, latestScore, scoreDelta });
        loadRecentActivity(recentInterviews);

        await initPerformanceChart();
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
    }
}

function updateVisualMetrics({ totalInterviews = 0, avgScore = 0, streak = 0 }) {
    const sessionsBars = document.getElementById('sessions-bars');
    const scoreOrbit = document.getElementById('score-orbit');
    const streakTrail = document.getElementById('streak-trail');

    const normalize = (value, max) => Math.max(0, Math.min(value / max, 1));

    const sessionsRatio = normalize(totalInterviews, 30);
    const scoreRatio = normalize(avgScore, 100);
    const streakRatio = normalize(streak, 21);

    if (sessionsBars) {
        const heights = [8, 14, 20, 11, 24, 13, 18, 9, 22, 12, 17, 13];
        const activeCount = Math.round(sessionsRatio * heights.length);
        sessionsBars.innerHTML = heights
            .map((height, index) => `<span class="${index < activeCount ? 'active' : ''}" style="height:${height}px"></span>`)
            .join('');
    }

    if (scoreOrbit) {
        scoreOrbit.style.setProperty('--metric-value', String(Math.max(scoreRatio, 0.02)));
    }

    if (streakTrail) {
        const activeCount = Math.round(streakRatio * 12);
        streakTrail.innerHTML = Array.from({ length: 12 }, (_, i) =>
            `<span class="${i < activeCount ? 'active' : ''}"></span>`
        ).join('');
    }
}

function updateMetricAssistiveText({ totalInterviews = 0, avgScore = 0, streak = 0, latestScore = 0, scoreDelta = 0 }) {
    const sessionsText = document.getElementById('sessions-progress');
    const scoreText = document.getElementById('score-trend');
    const streakText = document.getElementById('streak-progress');

    if (sessionsText) {
        sessionsText.textContent = totalInterviews > 0
            ? `${totalInterviews} completed interviews tracked`
            : 'No completed sessions yet';
    }

    if (scoreText) {
        if (latestScore > 0) {
            const direction = scoreDelta > 0 ? '▲' : scoreDelta < 0 ? '▼' : '•';
            const deltaText = scoreDelta === 0 ? 'no change' : `${Math.abs(Math.round(scoreDelta))} pts`;
            scoreText.textContent = `Latest ${latestScore}% ${direction} ${deltaText}`;
        } else {
            scoreText.textContent = avgScore > 0
                ? `Average score holding at ${avgScore}%`
                : 'Complete interviews to track trend';
        }
    }

    if (streakText) {
        streakText.textContent = streak > 0
            ? `${streak}-day consistency streak`
            : 'Build consistency with daily practice';
    }
}

function loadRecentActivity(interviews) {
    const activityContainer = document.getElementById('recent-activity');
    if (!activityContainer) return;
    
    const safeInterviews = Array.isArray(interviews) ? interviews : [];

    if (safeInterviews.length === 0) {
        activityContainer.innerHTML = '<p class="text-gray-400 text-sm">No recent activity</p>';
        return;
    }
    
    activityContainer.innerHTML = safeInterviews.map(interview => `
        <div class="activity-item">
            <div class="flex justify-between items-start">
                <div>
                    <p class="font-semibold">Mock Interview</p>
                    <p class="text-sm text-gray-400">${new Date(interview.date).toLocaleDateString()}</p>
                </div>
                <div class="text-accent-cyan font-bold">${interview.score}/100</div>
            </div>
        </div>
    `).join('');
}

function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    
    // Initialize FullCalendar with compact settings
    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next',
            center: 'title',
            right: ''
        },
        events: async function(info, successCallback, failureCallback) {
            try {
                // Fetch activities from database
                const result = await API.getCalendarActivities(
                    info.startStr,
                    info.endStr
                );
                
                if (result.success && result.data.activities) {
                    const events = result.data.activities.map(activity => ({
                        id: activity._id,
                        title: activity.title,
                        start: activity.date,
                        backgroundColor: getActivityColor(activity.activity_type, activity.status),
                        borderColor: getActivityColor(activity.activity_type, activity.status),
                        extendedProps: {
                            activity: activity
                        }
                    }));
                    successCallback(events);
                } else {
                    successCallback([]);
                }
            } catch (error) {
                console.error('Error loading calendar activities:', error);
                failureCallback(error);
            }
        },
        dateClick: function(info) {
            showDayActivities(info.dateStr);
        },
        eventClick: function(info) {
            showDayActivities(info.event.startStr.split('T')[0]);
        },
        height: 'auto',
        contentHeight: 'auto',
        aspectRatio: 1.2,
        fixedWeekCount: false,
        showNonCurrentDates: false,
        dayMaxEvents: false,
        eventDisplay: 'block',
        displayEventTime: false,
        eventContent: function() {
            return {
                html: '<span class="calendar-event-pill" aria-hidden="true"></span>'
            };
        },
        eventsSet: function(events) {
            decorateCalendarActivityDots(calendarEl, events);
        },
        eventDidMount: function(info) {
            // Add class to day cell to show it has activities
            const dayEl = info.el.closest('.fc-daygrid-day');
            if (dayEl) {
                dayEl.classList.add('has-activity');
            }
        },
        dayCellDidMount: function(info) {
            const dayFrame = info.el.querySelector('.fc-daygrid-day-frame');
            if (dayFrame && !dayFrame.querySelector('.calendar-day-dot-anchor')) {
                const dotAnchor = document.createElement('span');
                dotAnchor.className = 'calendar-day-dot-anchor';
                dayFrame.appendChild(dotAnchor);
            }
        }
    });
    
    calendar.render();
    
    // Store calendar instance globally for refresh
    window.dashboardCalendar = calendar;
    
    // Update upcoming sessions
    updateUpcomingSessions();
}

function decorateCalendarActivityDots(calendarEl, events = []) {
    if (!calendarEl) return;

    const countsByDate = new Map();
    events.forEach((event) => {
        const dateKey = event.startStr?.split('T')[0];
        if (!dateKey) return;
        countsByDate.set(dateKey, (countsByDate.get(dateKey) || 0) + 1);
    });

    const dayCells = calendarEl.querySelectorAll('.fc-daygrid-day');
    dayCells.forEach((dayCell) => {
        const dateKey = dayCell.getAttribute('data-date');
        const activityCount = dateKey ? (countsByDate.get(dateKey) || 0) : 0;

        dayCell.classList.toggle('has-activity', activityCount > 0);

        const anchor = dayCell.querySelector('.calendar-day-dot-anchor') || dayCell.querySelector('.fc-daygrid-day-frame');
        if (!anchor) return;

        let dot = anchor.querySelector('.calendar-day-dot');
        if (activityCount > 0) {
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'calendar-day-dot';
                anchor.appendChild(dot);
            }
            dot.setAttribute('data-count', String(activityCount));
            dot.title = `${activityCount} activity${activityCount > 1 ? 'ies' : ''}`;
        } else if (dot) {
            dot.remove();
        }
    });
}

function getActivityColor(activityType, status) {
    if (status === 'completed') {
        return '#10b981'; // Green
    } else if (status === 'cancelled') {
        return '#ef4444'; // Red
    }
    
    // Color by type for scheduled activities
    const colors = {
        'interview': '#1F3A5F',
        'ats_check': '#4F6D7A',
        'jd_match': '#f59e0b',
        'practice': '#374151'
    };
    
    return colors[activityType] || '#1F3A5F';
}

async function showDayActivities(dateStr) {
    try {
        // Remove existing modal if any
        const existingModal = document.querySelector('.calendar-day-overlay');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Fetch activities for the selected date
        const result = await API.getActivitiesByDate(dateStr);
        
        if (!result.success) {
            showNotification('Failed to load activities', 'error');
            return;
        }
        
        const activities = result.data.activities || [];
        const date = new Date(dateStr);
        const dateFormatted = date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-backdrop calendar-day-overlay';
        overlay.onclick = () => overlay.remove();
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal day-activity-modal unified-dashboard-modal';
        modal.onclick = (e) => e.stopPropagation();
        
        // Generate activities HTML
        let activitiesHTML = '';
        if (activities.length === 0) {
            activitiesHTML = `
                <div class="day-empty-state">
                    <div style="font-size:1.05rem;margin-bottom:0.35rem;">📅</div>
                    <div>No activities planned for this date.</div>
                </div>
            `;
        } else {
            activitiesHTML = `<div class="day-activities-list">`;
            activities.forEach(activity => {
                const icon = getActivityIcon(activity.activity_type);
                const time = new Date(activity.date).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit'
                });

                activitiesHTML += `
                    <div class="day-activity-item">
                        <div class="day-activity-icon">${icon}</div>
                        <div>
                            <div class="day-activity-head">
                                <div class="day-activity-title">${activity.title}</div>
                                <span class="day-status-chip ${activity.status || 'scheduled'}">${activity.status || 'scheduled'}</span>
                            </div>
                            <div class="day-activity-meta">${activity.activity_type.replace('_', ' ')} • ${time}</div>
                            ${activity.description ? `<div class="day-activity-description">${activity.description}</div>` : ''}
                        </div>
                        ${activity.score ? `<div class="day-activity-score">${activity.score}</div>` : ''}
                    </div>
                `;
            });
            activitiesHTML += `</div>`;
        }
        
        modal.innerHTML = `
            <div class="modal-header">
                <h3>${dateFormatted}</h3>
                <button class="modal-close" onclick="this.closest('.calendar-day-overlay').remove()">×</button>
            </div>
            <div class="modal-body">
                ${activitiesHTML}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.calendar-day-overlay').remove()">Close</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
    } catch (error) {
        console.error('Error showing day activities:', error);
        showNotification('Failed to load activities', 'error');
    }
}

function getActivityIcon(activityType) {
    const icons = {
        'interview': '🎤',
        'ats_check': '📄',
        'jd_match': '🎯',
        'practice': '💪'
    };
    return icons[activityType] || '📌';
}

async function updateUpcomingSessions() {
    const upcomingEl = document.getElementById('upcoming-sessions');
    if (!upcomingEl) return;
    
    try {
        const now = new Date().toISOString();
        const future = new Date();
        future.setDate(future.getDate() + 30);
        
        const result = await API.getCalendarActivities(now, future.toISOString());
        
        if (!result.success || !result.data.activities) {
            upcomingEl.innerHTML = '<p class="text-xs text-gray-500">No scheduled activities</p>';
            return;
        }
        
        const upcoming = result.data.activities
            .filter(a => a.status === 'scheduled' && new Date(a.date) > new Date())
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .slice(0, 3);
        
        if (upcoming.length === 0) {
            upcomingEl.innerHTML = '<p class="text-xs text-gray-500">No scheduled activities</p>';
            return;
        }
        
        upcomingEl.innerHTML = upcoming.map(activity => {
            const date = new Date(activity.date);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            
            return `
                <div class="session-item">
                    <div class="font-semibold text-white text-xs">${activity.title}</div>
                    <div class="text-accent-cyan text-xs">${dateStr} at ${timeStr}</div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading upcoming sessions:', error);
        upcomingEl.innerHTML = '<p class="text-xs text-gray-500">No scheduled activities</p>';
    }
}

function getCalendarEvents() {
    const interviews = Storage.getInterviews();
    
    return interviews.map(interview => ({
        title: 'Interview',
        start: interview.date,
        color: interview.status === 'completed' ? '#10b981' : '#1F3A5F',
        extendedProps: {
            interviewId: interview.interviewId,
            score: interview.score
        }
    }));
}

async function initPerformanceChart() {
    const ctx = document.getElementById('performance-chart');
    if (!ctx) return;
    const scoreRecords = await getInterviewScoreRecords();

    const labels = scoreRecords.map((record, index) => {
        if (record.dateISO) {
            return new Date(record.dateISO).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
        }
        return `Session ${index + 1}`;
    });

    const scores = scoreRecords.map((record) => record.score || 0);

    // Keep graph visible even for new users with no completed interviews yet
    const graphLabels = labels.length > 0 ? labels : ['Start'];
    const graphScores = scores.length > 0 ? scores : [0];

    const chartCtx = ctx.getContext('2d');
    const areaGradient = chartCtx.createLinearGradient(0, 0, 0, 260);
    areaGradient.addColorStop(0, 'rgba(255, 205, 86, 0.34)');
    areaGradient.addColorStop(0.45, 'rgba(255, 189, 72, 0.12)');
    areaGradient.addColorStop(1, 'rgba(255, 189, 72, 0)');

    if (performanceChartInstance) {
        performanceChartInstance.destroy();
    }

    performanceChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: graphLabels,
            datasets: [{
                label: 'Interview Marks',
                data: graphScores,
                borderColor: '#f7c948',
                borderWidth: 2.5,
                backgroundColor: areaGradient,
                tension: 0.38,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 5,
                pointBorderWidth: 2,
                pointBackgroundColor: '#ffe29a',
                pointBorderColor: '#f6bf3b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(11, 20, 48, 0.95)',
                    borderColor: 'rgba(247, 201, 72, 0.35)',
                    borderWidth: 1,
                    titleColor: '#f5f9ff',
                    bodyColor: '#d7e7ff',
                    displayColors: false,
                    callbacks: {
                        label: (context) => `Marks: ${context.parsed.y}/100`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        color: '#87a3d4',
                        stepSize: 20
                    },
                    grid: {
                        color: 'rgba(244, 188, 63, 0.14)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: '#87a3d4',
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 7
                    },
                    grid: {
                        color: 'rgba(91, 117, 181, 0.18)',
                        borderDash: [4, 5],
                        drawBorder: false
                    }
                }
            }
        }
    });

    updatePerformanceSummary(graphScores);
}

async function getInterviewScoreRecords() {
    try {
        const response = await API.getInterviews();
        if (response.success && Array.isArray(response.data)) {
            return normalizeInterviewScoreRecords(response.data).slice(-12);
        }
    } catch (error) {
        console.error('Error loading interview score records:', error);
    }

    const fallback = (Storage.getInterviews() || [])
        .filter((item) => item.status === 'completed' && Number.isFinite(Number(item.score)))
        .map((item) => ({
            score: Number(item.score),
            dateISO: item.date || item.created_at || item.updated_at || null
        }));

    return normalizeInterviewScoreRecords(fallback).slice(-12);
}

function normalizeInterviewScoreRecords(interviews = []) {
    return interviews
        .map((item) => {
            const scoreCandidate =
                item?.score ??
                item?.overall_score ??
                item?.final_score ??
                item?.report?.overall_score ??
                item?.result?.overall_score ??
                item?.metrics?.overall_score;

            const parsedScore = Number(scoreCandidate);
            const status = (item?.status || '').toLowerCase();
            const isCompleted = status === 'completed' || Number.isFinite(parsedScore);
            const dateISO = item?.completed_at || item?.date || item?.updated_at || item?.created_at || null;

            return {
                score: Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, Math.round(parsedScore))) : null,
                dateISO,
                isCompleted
            };
        })
        .filter((item) => item.isCompleted && Number.isFinite(item.score))
        .sort((a, b) => {
            const dateA = a.dateISO ? new Date(a.dateISO).getTime() : 0;
            const dateB = b.dateISO ? new Date(b.dateISO).getTime() : 0;
            return dateA - dateB;
        });
}

function updatePerformanceSummary(scores) {
    const latestEl = document.getElementById('chart-latest-score');
    const progressEl = document.getElementById('chart-improvement');
    if (!latestEl || !progressEl) return;

    const validScores = scores.filter((score) => Number.isFinite(Number(score)));
    if (validScores.length === 0 || (validScores.length === 1 && validScores[0] === 0)) {
        latestEl.textContent = 'Latest: —';
        progressEl.textContent = 'Progress: complete an interview to begin';
        return;
    }

    const latestScore = Number(validScores[validScores.length - 1]);
    latestEl.textContent = `Latest: ${Math.round(latestScore)}/100`;

    if (validScores.length === 1) {
        progressEl.textContent = 'Progress: first score recorded';
        return;
    }

    const prevScore = Number(validScores[validScores.length - 2]);
    const delta = Math.round(latestScore - prevScore);
    if (delta === 0) {
        progressEl.textContent = 'Progress: steady performance';
    } else if (delta > 0) {
        progressEl.textContent = `Progress: +${delta} points from last interview`;
    } else {
        progressEl.textContent = `Progress: ${delta} points from last interview`;
    }
}

function loadResume() {
    const resumePreview = document.getElementById('resume-preview');
    if (!resumePreview) return;
    
    // Show loading
    resumePreview.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Loading resumes...</p></div>';
    
    // Fetch resumes from backend
    API.getUserResumes().then(response => {
        if (response.success && response.data && response.data.length > 0) {
            const resumes = response.data;
            
            resumePreview.innerHTML = `
                <div class="space-y-4 resumes-shell">
                    <div class="resumes-toolbar">
                        <h2 class="text-2xl font-bold">Your Resumes</h2>
                        <button onclick="uploadResume()" class="resume-upload-btn" title="Upload New Resume">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                            </svg>
                            Upload Resume
                        </button>
                    </div>
                    ${resumes.map(resume => `
                        <div class="resume-card">
                            <div class="resume-meta">
                                <h3 class="resume-name">${resume.fileName}</h3>
                                <p class="resume-date">Uploaded: ${new Date(resume.uploadedAt).toLocaleDateString()}</p>
                                ${resume.atsScore ? `<p class="resume-score">ATS Score: ${resume.atsScore}%</p>` : '<p class="resume-score muted">ATS pending</p>'}
                            </div>
                            <div class="resume-actions">
                                <button onclick="viewResume('${resume.resumeId}')" class="resume-action-btn view" title="View Resume">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                                    </svg>
                                    View
                                </button>
                                <button onclick="downloadResume('${resume.resumeId}', '${resume.fileName}')" class="resume-action-btn download" title="Download Resume">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                                    </svg>
                                    Download
                                </button>
                                <button onclick="deleteResume('${resume.resumeId}')" class="resume-action-btn delete" title="Delete Resume">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            resumePreview.innerHTML = `
                <div class="text-center py-12 resume-empty-state">
                    <p class="text-gray-400 mb-4">No resume uploaded yet</p>
                    <button onclick="uploadResume()" class="resume-upload-btn mx-auto">
                        Upload Resume
                    </button>
                </div>
            `;
        }
    }).catch(error => {
        console.error('Error loading resumes:', error);
        resumePreview.innerHTML = `
            <div class="text-center py-12">
                <p class="text-red-500 mb-4">❌ Failed to load resumes</p>
                <button onclick="loadResume()" class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                    Retry
                </button>
            </div>
        `;
    });
}

async function viewResume(resumeId) {
    console.log('=== VIEW RESUME START ===');
    console.log('Resume ID:', resumeId);
    
    try {
        showNotification('Loading resume...', 'info');
        
        const blob = await API.getResumeFile(resumeId, { download: false });
        console.log('Blob received:', {
            type: blob?.type,
            size: blob?.size,
            exists: !!blob
        });
        
        if (blob && blob.size > 0) {
            const url = URL.createObjectURL(blob);
            console.log('Object URL created:', url);
            
            // Create a modal to view the PDF
            const modal = document.createElement('div');
            modal.className = 'modal-backdrop';
            modal.innerHTML = `
                <div class="modal-container resume-viewer-modal" style="max-width: 90vw; width: 1200px; height: 90vh;">
                    <div class="modal-header">
                        <h2 class="text-2xl font-bold">Resume Viewer</h2>
                        <button onclick="this.closest('.modal-backdrop').remove(); URL.revokeObjectURL('${url}')" class="text-gray-400 hover:text-white">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body" style="height: calc(100% - 80px); overflow: hidden;">
                        <iframe src="${url}" type="application/pdf" style="width: 100%; height: 100%; border: none;"></iframe>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            showNotification('Resume loaded successfully', 'success');
        } else {
            console.error('Invalid blob received');
            const user = Storage.getUser();
            const userQuery = user?.userId ? `?user_id=${encodeURIComponent(user.userId)}` : '';
            const fallbackUrl = `${API.baseURL}/ats/resumes/file/${encodeURIComponent(resumeId)}${userQuery}`;
            window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
            showNotification('Opening resume in a new tab...', 'info');
        }
    } catch (error) {
        console.error('=== VIEW RESUME ERROR ===');
        console.error('Error details:', error);
        const user = Storage.getUser();
        const userQuery = user?.userId ? `?user_id=${encodeURIComponent(user.userId)}` : '';
        const fallbackUrl = `${API.baseURL}/ats/resumes/file/${encodeURIComponent(resumeId)}${userQuery}`;
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
        showNotification('Preview had an issue, opened in a new tab instead.', 'warning');
    }
}

async function downloadResume(resumeId, fileName) {
    console.log('=== DOWNLOAD RESUME START ===');
    console.log('Resume ID:', resumeId);
    console.log('File Name:', fileName);
    
    try {
        showNotification('Downloading resume...', 'info');
        
        const blob = await API.getResumeFile(resumeId, { download: true });
        console.log('Blob received for download:', {
            type: blob?.type,
            size: blob?.size,
            exists: !!blob
        });
        
        if (blob && blob.size > 0) {
            // Create download link
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = fileName || 'resume.pdf';
            
            // Trigger download
            document.body.appendChild(a);
            console.log('Triggering download...');
            a.click();
            
            // Cleanup
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.log('Download cleanup complete');
            }, 100);
            
            showNotification('Resume downloaded successfully!', 'success');
        } else {
            console.error('Invalid blob for download');
            const user = Storage.getUser();
            const userQuery = user?.userId ? `?user_id=${encodeURIComponent(user.userId)}` : '';
            const fallbackUrl = `${API.baseURL}/ats/resumes/download/${encodeURIComponent(resumeId)}${userQuery}`;
            window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
            showNotification('Download started in a new tab.', 'info');
        }
    } catch (error) {
        console.error('=== DOWNLOAD RESUME ERROR ===');
        console.error('Error details:', error);
        const user = Storage.getUser();
        const userQuery = user?.userId ? `?user_id=${encodeURIComponent(user.userId)}` : '';
        const fallbackUrl = `${API.baseURL}/ats/resumes/download/${encodeURIComponent(resumeId)}${userQuery}`;
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
        showNotification('Download fallback opened in new tab.', 'warning');
    }
}

async function deleteResume(resumeId) {
    // Confirm deletion
    if (!confirm('Are you sure you want to delete this resume? This action cannot be undone.')) {
        return;
    }
    
    try {
        showNotification('Deleting resume...', 'info');
        const response = await API.deleteResume(resumeId);
        
        if (response.success) {
            showNotification('Resume deleted successfully!', 'success');
            // Reload the resume list
            loadResume();
        } else {
            showNotification(response.message || 'Failed to delete resume', 'error');
        }
    } catch (error) {
        console.error('Error deleting resume:', error);
        showNotification('Error deleting resume', 'error');
    }
}

function uploadResume() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            // Show notification
            showNotification('Uploading resume...', 'info');
            
            try {
                // Use ATS upload endpoint to save resume
                const response = await API.checkATS(file);
                
                if (response.success) {
                    showNotification('Resume uploaded successfully!', 'success');
                    loadResume(); // Reload the resume list
                } else {
                    showNotification(response.message || 'Upload failed', 'error');
                }
            } catch (error) {
                console.error('Error uploading resume:', error);
                showNotification('Error uploading resume', 'error');
            }
        }
    };
    
    input.click();
}

async function loadInterviewSessions() {
    const container = document.getElementById('interview-sessions-list');
    if (!container) return;
    
    try {
        const result = await API.getInterviews();
        if (!result.success || !result.data || result.data.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No interview sessions yet. Start your first interview!</p>';
            return;
        }
        
        container.innerHTML = result.data.slice(0, 10).map(s => {
            const statusColor = s.status === 'completed' ? 'text-green-400' : 'text-yellow-400';
            const date = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';
            return `
                <div class="flex items-center justify-between p-3 rounded-lg border border-accent-cyan/10 hover:border-accent-cyan/30 transition cursor-pointer" 
                     onclick="InterviewManager.instance.loadSessionReport('${s.session_id}')">
                    <div class="flex items-center gap-3">
                        <span class="text-sm">&#x1F399;</span>
                        <div>
                            <p class="text-sm font-medium">${s.candidate_name || 'Candidate'}</p>
                            <p class="text-xs text-gray-500">${date}</p>
                        </div>
                    </div>
                    <span class="text-xs font-semibold ${statusColor}">${s.status || 'unknown'}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error loading sessions:', err);
        container.innerHTML = '<p class="text-gray-500 text-sm">Failed to load sessions.</p>';
    }
}

function loadJobs() {
    const jobsView = document.getElementById('jobs-view');
    if (!jobsView) return;

    jobsView.innerHTML = `
        <div class="jobs-shell">
            <h1 class="text-2xl sm:text-3xl font-extrabold text-[#1E1E1E] mb-2">Job Discovery</h1>
            <p class="text-[#6B7280] mb-6 max-w-2xl">Upload a resume to get role recommendations and discover matching openings, or search jobs directly without uploading.</p>

            <div class="jobs-search-card mb-6">
                <form id="jobs-search-form" class="jobs-search-form">
                    <div class="jobs-architecture">
                        <div class="jobs-left-stack">
                            <div class="jobs-field jobs-field-role">
                                <label class="jobs-label" for="jobs-query">Role or Keyword</label>
                                <input id="jobs-query" type="text" placeholder="e.g. Software Engineer" class="jobs-input" />
                            </div>

                            <div class="jobs-field jobs-field-location">
                                <label class="jobs-label" for="jobs-location">Location</label>
                                <input id="jobs-location" type="text" placeholder="e.g. Bengaluru" class="jobs-input" />
                            </div>
                        </div>

                        <div class="jobs-right-stack">
                            <div class="jobs-field jobs-field-resume">
                                <label class="jobs-label" for="jobs-resume">Resume (Optional)</label>
                                <div class="jobs-resume-stack">
                                    <input id="jobs-resume" type="file" accept=".pdf,.docx" class="jobs-file-input" />
                                    <select id="jobs-existing-resume" class="jobs-select">
                                        <option value="">Use latest saved resume</option>
                                    </select>
                                </div>
                                <p class="jobs-field-help">Upload a new file or choose an existing resume from your account.</p>
                            </div>

                            <div class="jobs-action-row">
                                <button id="jobs-search-btn" type="submit" class="jobs-primary-btn">Find Jobs</button>
                                <button id="jobs-refresh-applied" type="button" class="jobs-link-btn">Refresh Applied Jobs</button>
                            </div>
                        </div>
                    </div>

                    <div class="jobs-options-row">
                        <label class="jobs-checkbox-wrap">
                            <input id="jobs-remote-only" type="checkbox" class="jobs-checkbox">
                            <span>Remote only</span>
                        </label>
                        <label class="jobs-checkbox-wrap">
                            <input id="jobs-use-resume" type="checkbox" class="jobs-checkbox">
                            <span>Use resume analysis</span>
                        </label>
                    </div>
                </form>
            </div>

            <div id="jobs-status" class="hidden mb-4 text-sm"></div>

            <div id="jobs-recommended-roles" class="hidden mb-4 bg-white border border-slate-100 rounded-xl p-4 shadow-sm"></div>

            <div id="jobs-grid" class="grid gap-4 md:grid-cols-2"></div>
        </div>
    `;

    initJobsPortalEvents();
    runJobsSearch();
}

function initJobsPortalEvents() {
    const form = document.getElementById('jobs-search-form');
    const refreshBtn = document.getElementById('jobs-refresh-applied');
    const resumeInput = document.getElementById('jobs-resume');
    const existingResumeSelect = document.getElementById('jobs-existing-resume');
    const useResumeCheckbox = document.getElementById('jobs-use-resume');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await runJobsSearch();
    });

    refreshBtn?.addEventListener('click', async () => {
        await runJobsSearch();
    });

    resumeInput?.addEventListener('change', () => {
        if (resumeInput.files && resumeInput.files.length > 0 && useResumeCheckbox) {
            useResumeCheckbox.checked = true;
            if (existingResumeSelect) {
                existingResumeSelect.value = '';
            }
        }
    });

    existingResumeSelect?.addEventListener('change', () => {
        if (existingResumeSelect.value && useResumeCheckbox) {
            useResumeCheckbox.checked = true;
            if (resumeInput) {
                resumeInput.value = '';
            }
        }
    });

    populateExistingResumes();
}

async function populateExistingResumes() {
    const select = document.getElementById('jobs-existing-resume');
    if (!select) return;

    const resumesResult = await API.getUserResumes();
    if (!resumesResult.success || !Array.isArray(resumesResult.data) || resumesResult.data.length === 0) {
        return;
    }

    const options = resumesResult.data.map((resume) => {
        const label = `${resume.fileName || 'Resume'} (${new Date(resume.uploadedAt).toLocaleDateString()})`;
        return `<option value="${escapeHtml(resume.resumeId)}">${escapeHtml(label)}</option>`;
    }).join('');

    select.innerHTML = '<option value="">Use latest saved resume</option>' + options;
}

function setJobsStatus(message, type = 'info') {
    const statusEl = document.getElementById('jobs-status');
    if (!statusEl) return;

    const colorMap = {
        info: 'text-[#1F3A5F]',
        success: 'text-green-600',
        error: 'text-red-600'
    };

    statusEl.className = `mb-4 text-sm ${colorMap[type] || colorMap.info}`;
    statusEl.textContent = message;
    statusEl.classList.remove('hidden');
}

async function runJobsSearch() {
    const queryInput = document.getElementById('jobs-query');
    const locationInput = document.getElementById('jobs-location');
    const resumeInput = document.getElementById('jobs-resume');
    const existingResumeSelect = document.getElementById('jobs-existing-resume');
    const useResumeInput = document.getElementById('jobs-use-resume');
    const remoteOnlyInput = document.getElementById('jobs-remote-only');
    const searchBtn = document.getElementById('jobs-search-btn');
    const jobsGrid = document.getElementById('jobs-grid');
    const rolesBox = document.getElementById('jobs-recommended-roles');

    if (!jobsGrid || !searchBtn) return;

    searchBtn.disabled = true;
    jobsGrid.innerHTML = '<div class="md:col-span-2 text-center py-10 text-[#6B7280]">Loading jobs...</div>';
    rolesBox?.classList.add('hidden');

    setJobsStatus('Searching jobs from multiple sources...', 'info');

    const useResume = !!useResumeInput?.checked;
    const selectedResumeFile = resumeInput?.files?.[0] || null;
    const selectedExistingResumeId = existingResumeSelect?.value || '';

    const discoverResult = await API.discoverJobs({
        query: queryInput?.value?.trim() || '',
        location: locationInput?.value?.trim() || '',
        remoteOnly: !!remoteOnlyInput?.checked,
        resumeFile: useResume ? selectedResumeFile : null,
        resumeId: useResume ? selectedExistingResumeId : '',
        useResume
    });

    if (!discoverResult.success) {
        jobsGrid.innerHTML = '<div class="md:col-span-2 text-center py-10 text-red-600">Unable to fetch jobs right now. Please try again.</div>';
        setJobsStatus(discoverResult.message || 'Failed to fetch jobs', 'error');
        searchBtn.disabled = false;
        return;
    }

    const [appliedResult, jobsPayload] = await Promise.all([
        API.getAppliedJobs(),
        Promise.resolve(discoverResult.data || {})
    ]);

    const appliedUrls = new Set((appliedResult.success ? appliedResult.data : []).map(item => item.jobUrl));
    const jobs = jobsPayload.jobs || [];
    const recommendedRoles = jobsPayload.recommended_roles || [];

    if (recommendedRoles.length > 0) {
        rolesBox.innerHTML = `
            <p class="text-sm font-semibold text-[#374151] mb-2">Recommended roles from your resume</p>
            <div class="flex flex-wrap gap-2">
                ${recommendedRoles.map(role => `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-[#1F3A5F]/10 text-[#1F3A5F]">${escapeHtml(role)}</span>`).join('')}
            </div>
        `;
        rolesBox.classList.remove('hidden');
    }

    if (jobs.length === 0) {
        jobsGrid.innerHTML = '<div class="md:col-span-2 text-center py-10 text-[#6B7280]">No jobs found. Try another role or location.</div>';
        setJobsStatus('No jobs matched your filters.', 'info');
        searchBtn.disabled = false;
        return;
    }

    jobsGrid.innerHTML = jobs.map(job => renderJobCard(job, appliedUrls.has(job.url))).join('');
    bindApplyButtons(appliedUrls);

    const usedResume = !!jobsPayload.used_resume;
    const message = usedResume
        ? `Found ${jobs.length} jobs using your resume insights.`
        : `Found ${jobs.length} jobs using role search.`;
    setJobsStatus(message, 'success');
    searchBtn.disabled = false;
}

function renderJobCard(job, isApplied) {
    const safeTitle = escapeHtml(job.title || 'Unknown Role');
    const safeCompany = escapeHtml(job.company || 'Unknown Company');
    const safeLocation = escapeHtml(job.location || 'Not specified');
    const safeSource = escapeHtml(job.source || 'Unknown');
    const safeType = escapeHtml(job.employment_type || 'Not specified');
    const description = escapeHtml((job.description || 'No description available').replace(/\s+/g, ' ').trim().slice(0, 230));
    const buttonLabel = isApplied ? 'Applied' : 'Apply';

    return `
        <div class="job-card job-discovery-card">
            <div class="flex items-start justify-between gap-3 mb-2">
                <h3 class="text-lg font-bold text-[#1E1E1E] leading-tight">${safeTitle}</h3>
                ${job.is_remote ? '<span class="jobs-remote-chip">Remote</span>' : ''}
            </div>
            <p class="text-sm text-[#374151] font-semibold mb-1 jobs-company">${safeCompany}</p>
            <p class="text-sm text-[#6B7280] mb-3 jobs-location">${safeLocation}</p>
            <p class="text-sm text-[#4B5563] mb-4 jobs-description">${description}${description.length >= 230 ? '...' : ''}</p>
            <div class="flex items-center justify-between gap-3 jobs-card-footer">
                <div class="text-xs text-[#6B7280] jobs-meta-line">
                    <span class="mr-3">${safeSource}</span>
                    <span>${safeType}</span>
                </div>
                <button
                    class="apply-job-btn jobs-apply-btn ${isApplied ? 'jobs-apply-btn-disabled' : 'jobs-apply-btn-active'}"
                    data-job='${encodeURIComponent(JSON.stringify(job))}'
                    ${isApplied ? 'disabled' : ''}
                >${buttonLabel}</button>
            </div>
        </div>
    `;
}

function bindApplyButtons(appliedUrls) {
    document.querySelectorAll('.apply-job-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;

            let job;
            try {
                job = JSON.parse(decodeURIComponent(btn.getAttribute('data-job') || ''));
            } catch (error) {
                showNotification('Invalid job payload', 'error');
                return;
            }

            if (!job.url) {
                showNotification('This job has no valid apply link', 'error');
                return;
            }

            const applyResult = await API.applyToJob(job);
            if (!applyResult.success) {
                showNotification(applyResult.message || 'Could not save application', 'error');
                return;
            }

            appliedUrls.add(job.url);
            btn.disabled = true;
            btn.className = 'apply-job-btn jobs-apply-btn jobs-apply-btn-disabled';
            btn.textContent = 'Applied';

            window.open(job.url, '_blank', 'noopener,noreferrer');
            showNotification('Application saved. Opening job link...', 'success');
        });
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="flex items-center gap-3">
            <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

async function loadProfile() {
    const profileView = document.getElementById('profile-view');
    if (!profileView) return;
    
    // Show loading
    profileView.innerHTML = '<div class="text-center py-12"><div class="spinner mx-auto"></div><p class="mt-4 text-gray-400">Loading profile...</p></div>';
    
    const response = await API.getProfile();
    
    if (response.success && response.data) {
        const profile = response.data;
        
        profileView.innerHTML = `
            <h1 class="text-3xl font-bold mb-6">My Profile</h1>
            
            <div class="grid gap-6 md:grid-cols-3">
                <!-- Profile Card -->
                <div class="md:col-span-2 bg-primary-dark-secondary border border-accent-cyan/20 rounded-lg p-6">
                    <div id="profile-view-mode">
                        <div class="space-y-6">
                            <div class="flex items-center gap-6 mb-8">
                                <div class="relative">
                                    <div id="profile-avatar" class="w-24 h-24 bg-accent-cyan/20 rounded-full flex items-center justify-center text-4xl font-bold text-accent-cyan overflow-hidden">
                                        ${Storage.getUser()?.profilePicture 
                                            ? `<img src="${Storage.getUser().profilePicture}" class="w-full h-full object-cover" alt="Profile">`
                                            : profile.fullName.charAt(0).toUpperCase()
                                        }
                                    </div>
                                    <button onclick="changeProfilePicture()" class="absolute bottom-0 right-0 bg-accent-cyan text-white p-2 rounded-full hover:bg-accent-cyan/90 transition">
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                        </svg>
                                    </button>
                                </div>
                                <div>
                                    <h2 class="text-2xl font-bold">${profile.fullName}</h2>
                                    <p class="text-gray-400">${profile.email}</p>
                                </div>
                            </div>
                            
                            <div class="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label class="block text-sm font-medium text-gray-400 mb-2">Full Name</label>
                                    <p class="text-lg">${profile.fullName}</p>
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-medium text-gray-400 mb-2">Email</label>
                                    <p class="text-lg">${profile.email}</p>
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-medium text-gray-400 mb-2">Phone</label>
                                    <p class="text-lg">${profile.phone || 'Not provided'}</p>
                                </div>
                                
                                <div>
                                    <label class="block text-sm font-medium text-gray-400 mb-2">Member Since</label>
                                    <p class="text-lg">${new Date(profile.createdAt).toLocaleDateString()}</p>
                                </div>
                            </div>
                            
                            ${profile.education && profile.education.length > 0 ? `
                                <div>
                                    <label class="block text-sm font-medium text-gray-400 mb-4">Education</label>
                                    <div class="space-y-3">
                                        ${profile.education.map(edu => `
                                            <div class="p-4 bg-primary-dark rounded-lg border border-accent-cyan/10">
                                                <h4 class="font-semibold">${edu.degree} in ${edu.field || 'N/A'}</h4>
                                                <p class="text-gray-400">${edu.institution}</p>
                                                <p class="text-sm text-gray-500">${edu.year || 'N/A'}</p>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                            
                            <div class="flex gap-4 mt-8">
                                <button onclick="editProfile()" 
                                        class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                                    ✏️ Edit Profile
                                </button>
                                <button onclick="changePassword()" 
                                        class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                                    🔒 Change Password
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="profile-edit-mode" class="hidden">
                        <!-- Edit form will be inserted here -->
                    </div>
                </div>
                
                <!-- Stats Card -->
                <div class="space-y-6">
                    <div class="bg-primary-dark-secondary border border-accent-cyan/20 rounded-lg p-6">
                        <h3 class="text-lg font-bold mb-4">Profile Stats</h3>
                        <div class="space-y-4">
                            <div class="flex justify-between items-center">
                                <span class="text-gray-400">Total Interviews</span>
                                <span class="text-xl font-bold text-accent-cyan">${Storage.getInterviews().length}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-gray-400">ATS Checks</span>
                                <span class="text-xl font-bold text-accent-cyan">${Storage.getATSResults().length}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-gray-400">JD Matches</span>
                                <span class="text-xl font-bold text-accent-cyan">${Storage.getJDMatches().length}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-gray-400">Resumes</span>
                                <span class="text-xl font-bold text-accent-cyan" id="resume-count">-</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="bg-primary-dark-secondary border border-accent-cyan/20 rounded-lg p-6">
                        <h3 class="text-lg font-bold mb-4">Quick Actions</h3>
                        <div class="space-y-3">
                            <button onclick="showView('ats')" class="w-full px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded-lg hover:bg-accent-cyan/30 transition">
                                📄 Check ATS Score
                            </button>
                            <button onclick="showView('jdmatcher')" class="w-full px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded-lg hover:bg-accent-cyan/30 transition">
                                🎯 Match Job Description
                            </button>
                            <button onclick="showView('interview')" class="w-full px-4 py-2 bg-accent-cyan/20 text-accent-cyan rounded-lg hover:bg-accent-cyan/30 transition">
                                🎤 Take Interview
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Load resume count
        API.getUserResumes().then(res => {
            if (res.success && res.data) {
                document.getElementById('resume-count').textContent = res.data.length;
            }
        });
    } else {
        profileView.innerHTML = `
            <div class="text-center py-12">
                <p class="text-red-500 mb-4">❌ Failed to load profile</p>
                <button onclick="loadProfile()" class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                    Retry
                </button>
            </div>
        `;
    }
}

async function editProfile() {
    const response = await API.getProfile();
    if (!response.success) {
        showNotification('Failed to load profile', 'error');
        return;
    }
    
    const profile = response.data;
    const viewMode = document.getElementById('profile-view-mode');
    const editMode = document.getElementById('profile-edit-mode');
    
    viewMode.classList.add('hidden');
    editMode.classList.remove('hidden');
    
    editMode.innerHTML = `
        <form id="profile-edit-form" class="space-y-6">
            <div class="grid md:grid-cols-2 gap-6">
                <div>
                    <label class="block text-sm font-medium mb-2">Full Name</label>
                    <input type="text" id="edit-fullName" value="${profile.fullName}" 
                           class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                </div>
                
                <div>
                    <label class="block text-sm font-medium mb-2">Phone</label>
                    <input type="tel" id="edit-phone" value="${profile.phone || ''}" 
                           class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                </div>
            </div>
            
            <div>
                <label class="block text-sm font-medium mb-2">Email (cannot be changed)</label>
                <input type="email" value="${profile.email}" disabled 
                       class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-gray-400">
            </div>
            
            <div class="flex gap-4">
                <button type="submit" 
                        class="px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                    Save Changes
                </button>
                <button type="button" onclick="cancelEditProfile()" 
                        class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                    Cancel
                </button>
            </div>
        </form>
    `;
    
    // Handle form submission
    document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const fullName = document.getElementById('edit-fullName').value;
        const phone = document.getElementById('edit-phone').value;
        const user = Storage.getUser();
        const profilePicture = user?.profilePicture || null;
        
        showNotification('Updating profile...', 'info');
        
        const updateResponse = await API.updateProfile({
            fullName,
            phone,
            profilePicture
        });
        
        if (updateResponse.success) {
            showNotification('Profile updated successfully!', 'success');
            loadProfile(); // Reload profile to show changes
        } else {
            showNotification(updateResponse.message || 'Failed to update profile', 'error');
        }
    });
}

function cancelEditProfile() {
    const viewMode = document.getElementById('profile-view-mode');
    const editMode = document.getElementById('profile-edit-mode');
    
    editMode.classList.add('hidden');
    viewMode.classList.remove('hidden');
}

function changeProfilePicture() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const imgData = event.target.result;
                
                // Save to localStorage
                const user = Storage.getUser();
                if (user) {
                    user.profilePicture = imgData;
                    Storage.saveUser(user);
                    
                    // Update avatar display
                    const avatar = document.getElementById('profile-avatar');
                    if (avatar) {
                        avatar.innerHTML = `<img src="${imgData}" class="w-full h-full rounded-full object-cover" alt="Profile">`;
                    }
                    
                    // Update header avatar
                    const headerAvatar = document.getElementById('user-avatar');
                    if (headerAvatar && headerAvatar.parentElement) {
                        headerAvatar.parentElement.innerHTML = `<img src="${imgData}" class="w-8 h-8 rounded-full object-cover" alt="Profile">`;
                    }
                    
                    showNotification('Profile picture updated!', 'success');
                }
            };
            reader.readAsDataURL(file);
        }
    };
    
    input.click();
}

function changePassword() {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h2 class="text-2xl font-bold">Change Password</h2>
                <button onclick="this.closest('.modal-backdrop').remove()" class="text-gray-400 hover:text-white">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <form id="change-password-form" class="space-y-6">
                    <div>
                        <label class="block text-sm font-medium mb-2">Current Password</label>
                        <input type="password" id="current-password" required
                               class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium mb-2">New Password</label>
                        <input type="password" id="new-password" required minlength="6"
                               class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                        <p class="text-xs text-gray-400 mt-1">Minimum 6 characters</p>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium mb-2">Confirm New Password</label>
                        <input type="password" id="confirm-password" required minlength="6"
                               class="w-full px-4 py-3 bg-primary-dark border border-accent-cyan/30 rounded-lg focus:outline-none focus:border-accent-cyan text-white">
                    </div>
                    
                    <div class="flex gap-4">
                        <button type="submit" 
                                class="flex-1 px-6 py-3 bg-accent-cyan text-white rounded-lg hover:bg-accent-cyan/90 transition">
                            Change Password
                        </button>
                        <button type="button" onclick="this.closest('.modal-backdrop').remove()" 
                                class="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle form submission
    document.getElementById('change-password-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        
        if (newPassword !== confirmPassword) {
            showNotification('New passwords do not match!', 'error');
            return;
        }
        
        if (newPassword.length < 6) {
            showNotification('Password must be at least 6 characters!', 'error');
            return;
        }
        
        // Note: In a real app, this would call an API endpoint to change password
        // For now, just show a success message
        showNotification('Password change functionality requires backend implementation', 'info');
        modal.remove();
        
        // TODO: Implement API call when backend endpoint is ready
        // API.changePassword(currentPassword, newPassword).then(...)
    });
}

// Calendar Activity Logging Helper Functions
async function logCalendarActivity(activityType, title, metadata = {}) {
    try {
        const activityData = {
            activity_type: activityType,
            title: title,
            description: metadata.description || null,
            date: new Date().toISOString(),
            score: metadata.score || null,
            status: metadata.status || 'completed',
            reference_id: metadata.reference_id || null,
            metadata: metadata
        };
        
        const result = await API.createCalendarActivity(activityData);
        
        if (result.success) {
            // Refresh calendar if it exists
            if (window.dashboardCalendar) {
                window.dashboardCalendar.refetchEvents();
            }
            // Refresh upcoming sessions
            updateUpcomingSessions();
        }
        
        return result;
    } catch (error) {
        console.error('Error logging calendar activity:', error);
        return { success: false, error };
    }
}

// Expose globally for use in other modules
window.logCalendarActivity = logCalendarActivity;
window.refreshCalendar = function() {
    if (window.dashboardCalendar) {
        window.dashboardCalendar.refetchEvents();
        updateUpcomingSessions();
    }
};

window.refreshDashboardAnalytics = async function() {
    await loadDashboardStats();
    await initPerformanceChart();
    window.refreshCalendar();
};
