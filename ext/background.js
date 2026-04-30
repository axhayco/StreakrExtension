// background.js

const FALLBACK_PROBLEM = "https://leetcode.com/problems/two-sum/";

const DEFAULT_STATE = {
    isActive: false,
    streak: 0,
    lastCompletedDate: null,
    assignedDate: null,
    repairMode: false,
    repairProgress: 0,
    difficulty: "Easy",
    assignedProblems: [],
    visitedProblems: [],
    completedToday: false,
    skippedToday: false,
    seenProblems: [],
    recentOutcomes: [],
    history: [],
    lastSession: { timeSpent: 0, keys: 0 },
    feedbackMessage: "Stay focused. Get it done.",
    notificationDate: null,
    notificationCountToday: 0,
    lastNotificationTime: 0,
    username: null
};

const NOTIFICATION_ID = "streakr-daily-reminder";
const REMINDER_ALARM = "streakr-reminder-check";

// Compute a feedback message from current state.
// Called ONLY at day-rollover or on skip — not on every popup open.
function computeFeedback(state) {
    const history = state.history || [];
    const streak = state.streak || 0;
    const missedCount = history.filter(h => h.status === "missed").length;
    const lastEntry = history.length > 0 ? history[history.length - 1] : null;

    if (missedCount >= 3) return "You keep missing days. Fix your routine or disable this.";
    if (lastEntry && lastEntry.status === "skipped") return "You avoided hard work yesterday. Don't do it again.";
    if (streak >= 7) return "One week straight. This is becoming a habit.";
    if (streak >= 5) return "You're building real discipline. Keep going.";
    if (streak >= 2) return "Good start. Momentum matters now.";
    if (state.repairMode) return "You broke the streak. Two days to recover it.";
    return "Stay focused. Get it done.";
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(null, (res) => {
        if (Object.keys(res).length === 0) {
            chrome.storage.local.set(DEFAULT_STATE);
        }
    });
    chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 30 });
    handleDailyCheck().then((state) => {
        updateBadge(state);
        maybeSendReminder(state);
    });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(REMINDER_ALARM, { periodInMinutes: 30 });
    handleDailyCheck().then((state) => {
        updateBadge(state);
        maybeSendReminder(state);
        
        // Auto-open LeetCode on startup if not done
        if (state.isActive && !state.completedToday && !state.skippedToday && state.assignedProblems?.length > 0) {
            chrome.tabs.create({ url: state.assignedProblems[0] });
        }
    });
});

const DISTRACTING_SITES = [
    "youtube.com", "reddit.com", "twitter.com", "x.com", 
    "instagram.com", "facebook.com", "netflix.com"
];

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url || tab.pendingUrl;
    if (url) {
        chrome.storage.local.get(null, (state) => {
            if (state.isActive && !state.completedToday && !state.skippedToday) {
                const isDistracting = DISTRACTING_SITES.some(site => url.includes(site));
                if (isDistracting) {
                    const targetUrl = (state.assignedProblems && state.assignedProblems.length > 0) 
                        ? state.assignedProblems[0] 
                        : "https://leetcode.com/";
                    
                    chrome.tabs.update(tabId, { url: targetUrl });
                    
                    chrome.notifications.create({
                        type: "basic",
                        iconUrl: "streakr_icon.jpg",
                        title: "Streakr Enforcement",
                        message: "No distractions allowed until you solve your daily problem!",
                        priority: 2
                    });
                }
            }
        });
    }
});

chrome.tabs.onCreated.addListener((tab) => {
    chrome.storage.local.get(null, (state) => {
        if (!state.isActive || state.completedToday || state.skippedToday) return;

        const today = getLeetCodeDateStr();
        if (state.lastAutoOpenDate !== today && state.assignedProblems && state.assignedProblems.length > 0) {
            chrome.storage.local.set({ lastAutoOpenDate: today }, () => {
                chrome.tabs.create({ url: state.assignedProblems[0] });
            });
        }
    });
});

function getLeetCodeDateStr(date = new Date()) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function getSlugFromUrl(url) {
    if (!url) return null;
    const match = url.match(/problems\/([^\/]+)/i);
    return match ? match[1].toLowerCase() : null;
}

async function markCompleted(state, visitedUrl, timeSpent, keys) {
    let newStreak = state.streak || 0;
    let repairMode = state.repairMode || false;
    let repairProgress = state.repairProgress || 0;

    if (repairMode) {
        repairProgress += 1;
        if (repairProgress >= 2) {
            repairMode = false;
            repairProgress = 0;
            newStreak = 1;
        }
    } else {
        newStreak += 1;
    }

    const newVisited = [...new Set([...(state.visitedProblems || []), cleanUrl(visitedUrl)])];
    const patch = {
        visitedProblems: newVisited,
        completedToday: true,
        lastCompletedDate: getLeetCodeDateStr(),
        streak: newStreak,
        repairMode,
        repairProgress
    };
    
    if (timeSpent !== undefined || keys !== undefined) {
        patch.lastSession = {
            timeSpent: timeSpent || 0,
            keys: keys || 0
        };
    }

    patch.feedbackMessage = computeFeedback({ ...state, ...patch });

    return new Promise(resolve => {
        chrome.storage.local.set(patch, () => {
            const nextState = { ...state, ...patch };
            updateBadge(nextState);
            chrome.notifications.clear(NOTIFICATION_ID);
            resolve(nextState);
        });
    });
}

async function checkProfileCompletion(state) {
    if (!state.isActive || !state.username || state.completedToday || state.skippedToday || !state.assignedProblems || state.assignedProblems.length === 0) {
        return state;
    }

    const assignedUrl = state.assignedProblems[0];
    const assignedSlug = getSlugFromUrl(assignedUrl);
    if (!assignedSlug) return state;

    try {
        const query = `
          query recentAcSubmissions($username: String!) {
            recentAcSubmissionList(username: $username, limit: 15) {
              titleSlug
              timestamp
            }
          }
        `;
        const res = await fetch('https://leetcode.com/graphql/', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query, variables: {username: state.username}})
        });
        const json = await res.json();
        
        const submissions = json?.data?.recentAcSubmissionList || [];
        const todayStr = getLeetCodeDateStr();

        for (const sub of submissions) {
            const subDateStr = getLeetCodeDateStr(new Date(parseInt(sub.timestamp) * 1000));
            if (subDateStr === todayStr) {
                // The user solved a problem today! Auto-complete the streak.
                const solvedUrl = "https://leetcode.com/problems/" + sub.titleSlug + "/";
                return await markCompleted(state, solvedUrl);
            }
        }
    } catch (e) {
        console.error("Profile check failed", e);
    }
    
    return state;
}

// Adaptive difficulty: upgrade after 3 consecutive successes, downgrade after 2 consecutive failures.
function calculateNewDifficulty(outcomes, currentDiff) {
    const diffOrder = ["Easy", "Medium", "Hard"];
    let idx = diffOrder.indexOf(currentDiff);
    if (idx === -1) idx = 0;

    const len = outcomes.length;
    if (len >= 2 && outcomes[len - 1] === 0 && outcomes[len - 2] === 0) {
        return { newDiff: diffOrder[Math.max(0, idx - 1)], newOutcomes: [] };
    }
    if (len >= 3 && outcomes[len - 1] === 1 && outcomes[len - 2] === 1 && outcomes[len - 3] === 1) {
        return { newDiff: diffOrder[Math.min(diffOrder.length - 1, idx + 1)], newOutcomes: [] };
    }
    return { newDiff: diffOrder[idx], newOutcomes: outcomes };
}

async function getRandomProblem(diff, seen) {
    try {
        const res = await fetch("https://leetcode.com/api/problems/algorithms/");
        const data = await res.json();
        
        const levelMap = { "Easy": 1, "Medium": 2, "Hard": 3 };
        const targetLevel = levelMap[diff] || 1;
        
        let pool = data.stat_status_pairs
            .filter(p => !p.paid_only && p.difficulty.level === targetLevel && p.status !== "ac")
            .map(p => "https://leetcode.com/problems/" + p.stat.question__title_slug + "/");

        if (pool.length === 0) {
            // fallback if all are solved or something
            pool = data.stat_status_pairs
                .filter(p => !p.paid_only && p.difficulty.level === targetLevel)
                .map(p => "https://leetcode.com/problems/" + p.stat.question__title_slug + "/");
        }

        let filteredPool = pool.filter(p => !seen.includes(p));
        if (filteredPool.length === 0) {
            seen.length = 0; // mutate seen to clear it if pool exhausted
            filteredPool = pool;
        }

        if (filteredPool.length > 0) {
            return filteredPool[Math.floor(Math.random() * filteredPool.length)];
        }
    } catch (e) {
        console.error("Failed to fetch real problems, using fallback", e);
    }
    return FALLBACK_PROBLEM;
}

async function handleDailyCheck() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (state) => {
            if (!state.isActive) { resolve(state); return; }

            const today = getLeetCodeDateStr();

            // Already processed today — return as-is, no mutations.
            if (state.assignedDate === today) {
                // If not completed today, check profile just in case they solved it
                if (!state.completedToday && !state.skippedToday && state.username) {
                    checkProfileCompletion(state).then(resolve);
                    return;
                }
                resolve(state);
                return;
            }

            // --- Day rollover ---
            let newStreak = state.streak || 0;
            let repairMode = state.repairMode || false;
            let repairProgress = state.repairProgress || 0;
            let diff = state.difficulty || "Easy";
            let outcomes = [...(state.recentOutcomes || [])];
            let seen = [...(state.seenProblems || [])];
            let history = [...(state.history || [])];

            // Score the previous day (only if there was a previous assignment)
            if (state.assignedDate) {
                // Fix: deduplicate history — never add the same date twice
                const alreadyRecorded = history.some(h => h.date === state.assignedDate);
                if (!alreadyRecorded) {
                    let prevStatus = "missed";
                    if (state.completedToday) prevStatus = "done";
                    else if (state.skippedToday) prevStatus = "skipped";
                    history.push({ date: state.assignedDate, status: prevStatus });
                    if (history.length > 14) history = history.slice(-14); // keep 2 weeks
                }

                if (state.completedToday) {
                    outcomes.push(1);
                    // Streak already updated when completed! Do nothing to streak/repairMode here.
                } else {
                    // Missed or skipped
                    outcomes.push(0);
                    if (!state.skippedToday) {
                        if (repairMode) {
                            repairProgress = 0; // Reset repair progress; stay in repair mode
                            newStreak = 0;
                        } else {
                            repairMode = true;
                            repairProgress = 0;
                            newStreak = 0;
                        }
                    } else {
                        // If they skipped, the streak penalty was applied during SKIP_TODAY
                        newStreak = state.streak || 0;
                        repairMode = state.repairMode || false;
                        repairProgress = state.repairProgress || 0;
                    }
                }
            }

            outcomes = outcomes.slice(-5);

            const diffResult = calculateNewDifficulty(outcomes, diff);
            diff = diffResult.newDiff;
            outcomes = diffResult.newOutcomes;

            // Pick today's problem — dynamically fetch from LeetCode
            getRandomProblem(diff, seen).then(chosenUrl => {
                seen.push(chosenUrl);

                const newState = {
                    ...state,
                    assignedDate: today,
                    assignedProblems: [chosenUrl],
                    visitedProblems: [],
                    completedToday: false,
                    skippedToday: false,
                    streak: newStreak,
                    repairMode,
                    repairProgress,
                    difficulty: diff,
                    recentOutcomes: outcomes,
                    seenProblems: seen,
                    history,
                    lastSession: { timeSpent: 0, keys: 0 }
                };
                newState.feedbackMessage = computeFeedback(newState);

                chrome.storage.local.set(newState, () => {
                    checkProfileCompletion(newState).then(resolve);
                });
            });
        });
    });
}

function cleanUrl(url) {
    if (!url) return "";
    const match = url.match(/(https?:\/\/(www\.)?leetcode\.com\/problems\/[^\/]+)/i);
    return match ? match[1].toLowerCase() : url.split("?")[0].replace(/\/$/, "").toLowerCase();
}

function updateBadge(state) {
    const pending = Boolean(state && state.isActive && !state.completedToday);
    chrome.action.setBadgeBackgroundColor({ color: pending ? "#ef4444" : "#64748b" });
    chrome.action.setBadgeText({ text: pending ? "!" : "" });
    chrome.action.setTitle({
        title: pending
            ? "Streakr: today's problem is still pending"
            : "Streakr: streak secured for today"
    });
}

function isReminderWindow() {
    const hour = new Date().getHours();
    return hour >= 17 && hour < 24;
}

function maybeSendReminder(state) {
    if (!state || !state.isActive || state.completedToday || !isReminderWindow()) {
        return;
    }

    const today = getLeetCodeDateStr();
    const countToday = state.notificationDate === today ? (state.notificationCountToday || 0) : 0;
    const lastNotificationTime = Number(state.lastNotificationTime || 0);
    const assignedUrl = state.assignedProblems && state.assignedProblems[0];

    if (!assignedUrl) {
        return;
    }

    if (countToday >= 2) {
        return;
    }

    if (Date.now() - lastNotificationTime < 90 * 60 * 1000) {
        return;
    }

    chrome.notifications.create(NOTIFICATION_ID, {
        type: "basic",
        iconUrl: "streakr_icon.jpg",
        title: "Streakr",
        message: "You haven't solved today. Don't break your streak.",
        priority: 1
    }, () => {
        const patch = {
            notificationDate: today,
            notificationCountToday: countToday + 1,
            lastNotificationTime: Date.now()
        };
        chrome.storage.local.set(patch);
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REMINDER_ALARM) {
        return;
    }

    handleDailyCheck().then((state) => {
        updateBadge(state);
        maybeSendReminder(state);
    });
});

chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId !== NOTIFICATION_ID) {
        return;
    }

    chrome.storage.local.get(["assignedProblems"], (state) => {
        const assignedUrl = state.assignedProblems && state.assignedProblems[0];
        if (assignedUrl) {
            chrome.tabs.create({ url: assignedUrl });
        }
        chrome.notifications.clear(notificationId);
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    if (request.type === "CHECK_STATE") {
        handleDailyCheck().then((state) => {
            updateBadge(state);
            maybeSendReminder(state);
            sendResponse(state);
        });
        return true;
    }

    if (request.type === "SKIP_TODAY") {
        chrome.storage.local.get(null, (state) => {
            if (state.skippedToday || state.completedToday) {
                sendResponse(state);
                return;
            }
            let newStreak = 0;
            let repairMode = true;
            let repairProgress = 0;

            const patch = {
                skippedToday: true,
                completedToday: false,
                streak: newStreak,
                repairMode,
                repairProgress,
                feedbackMessage: "You avoided hard work. Don't do it again."
            };
            chrome.storage.local.set(patch, () => {
                const nextState = { ...state, ...patch };
                updateBadge(nextState);
                maybeSendReminder(nextState);
                sendResponse(nextState);
            });
        });
        return true;
    }

    if (request.type === "MARK_VISITED") {
        chrome.storage.local.get(null, (state) => {
            if (!state.isActive || state.completedToday || state.skippedToday) {
                sendResponse(state);
                return;
            }
            markCompleted(state, request.url, request.timeSpent, request.keys).then(nextState => {
                sendResponse(nextState);
            });
        });
        return true;
    }

    // Periodic effort updates from content.js (best-effort, no response needed)
    if (request.type === "UPDATE_EFFORT") {
        chrome.storage.local.get(["lastSession", "completedToday"], (data) => {
            if (data.completedToday) return; // Don't overwrite after completion
            const prev = data.lastSession || { timeSpent: 0, keys: 0 };
            chrome.storage.local.set({
                lastSession: {
                    timeSpent: Math.max(prev.timeSpent, request.timeSpent || 0),
                    keys: Math.max(prev.keys, request.keys || 0)
                }
            });
        });
        return false; // No async response needed
    }
});
