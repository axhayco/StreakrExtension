// popup.js
document.addEventListener("DOMContentLoaded", () => {
    const onboarding = document.getElementById("onboarding");
    const dashboard = document.getElementById("dashboard");
    const startBtn = document.getElementById("startBtn");
    const streakLabel = document.getElementById("streakLabel");
    const diffLabel = document.getElementById("diffLabel");
    const statusBox = document.getElementById("statusBox");
    const solveBtn = document.getElementById("solveBtn");
    const skipBtn = document.getElementById("skipBtn");
    const consistencyRow = document.getElementById("consistencyRow");
    const effortBox = document.getElementById("effortBox");
    const feedbackBox = document.getElementById("feedbackBox");
    const onboardUsername = document.getElementById("onboardUsername");
    const profileDisplay = document.getElementById("profileDisplay");
    const usernameLabel = document.getElementById("usernameLabel");
    const editProfileBtn = document.getElementById("editProfileBtn");
    const profileEdit = document.getElementById("profileEdit");
    const dashboardUsername = document.getElementById("dashboardUsername");
    const saveProfileBtn = document.getElementById("saveProfileBtn");

    function cleanUrl(url) {
        if (!url) return "";
        const match = url.match(/(https?:\/\/(www\.)?leetcode\.com\/problems\/[^\/]+)/i);
        return match ? match[1].toLowerCase() : url.split("?")[0].replace(/\/$/, "").toLowerCase();
    }

    function getLeetCodeDateStr(offsetDays = 0) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + offsetDays);
        return date.toISOString().slice(0, 10);
    }

    function updateUI(state) {
        if (!state) return;

        if (!state.isActive) {
            onboarding.classList.remove("hidden");
            dashboard.classList.add("hidden");
            return;
        }

        onboarding.classList.add("hidden");
        dashboard.classList.remove("hidden");

        streakLabel.innerHTML = `${state.streak || 0} <span>Day Auto-Streak</span>`;
        diffLabel.innerHTML = `${state.difficulty || 'Easy'} <span>Target Diff</span>`;

        if (state.username) {
            usernameLabel.textContent = state.username;
            usernameLabel.style.color = "#10b981"; // green
        } else {
            usernameLabel.textContent = "None";
            usernameLabel.style.color = "#ef4444"; // red
        }

        skipBtn.classList.remove("hidden");

        // Update Analytics
        if (effortBox && feedbackBox && consistencyRow) {
            let lastSession = state.lastSession || { timeSpent: 0, keys: 0 };
            effortBox.textContent = `Time: ${lastSession.timeSpent}s | Activity: ${lastSession.keys} actions`;
            feedbackBox.textContent = state.feedbackMessage || "Stay focused. Get it done.";

            let history = state.history || [];
            let daysHTML = "";
            for (let i = 6; i >= 0; i--) {
                let d = new Date();
                d.setUTCDate(d.getUTCDate() - i);
                let dateStr = getLeetCodeDateStr(-i);
                let dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
                
                let h = history.find(x => x.date === dateStr);
                let emoji = "—";
                if (i === 0) {
                    if (state.completedToday) emoji = "✅";
                    else if (state.skippedToday) emoji = "⚠";
                    else emoji = "—";
                } else if (h) {
                    if (h.status === 'done') emoji = "✅";
                    else if (h.status === 'missed') emoji = "❌";
                    else if (h.status === 'skipped') emoji = "⚠";
                }
                
                daysHTML += `<div style="text-align:center;"><div>${dayName}</div><div style="margin-top:4px;">${emoji}</div></div>`;
            }
            consistencyRow.innerHTML = daysHTML;
        }

        if (state.skippedToday) {
            statusBox.className = "status skipped";
            statusBox.textContent = "Skipped - Penalty Tomorrow";
            solveBtn.textContent = "Browse LeetCode";
            skipBtn.classList.add("hidden");
        } else if (state.completedToday) {
            statusBox.className = "status done";
            statusBox.textContent = "Done for today!";
            solveBtn.textContent = "Browse LeetCode";
            skipBtn.classList.add("hidden");
        } else if (state.repairMode) {
            statusBox.className = "status repair";
            let phase = (state.repairProgress || 0) + 1;
            let dayText = phase === 1 ? "Day 1 of 2" : "Final recovery day";
            statusBox.innerHTML = `Repair Mode: ${dayText}<br><span style="font-size:11px; font-weight:normal; opacity:0.9; margin-top:4px; display:block;">⚠️ Miss today = streak reset</span>`;
            solveBtn.textContent = "Solve Penalty Problem";
        } else {
            statusBox.className = "status";
            statusBox.textContent = "1 Problem Pending";
            solveBtn.textContent = "Go To Problem";
        }

        solveBtn.onclick = () => {
            if (state.completedToday || state.skippedToday) {
                chrome.tabs.create({ url: "https://leetcode.com/" });
            } else {
                let target = state.assignedProblems && state.assignedProblems[0];
                if (target) {
                    chrome.tabs.create({ url: target });
                }
            }
        };

        skipBtn.onclick = () => {
            if(confirm("Are you sure? This will break your streak and trigger Repair Mode tomorrow.")) {
                chrome.runtime.sendMessage({ type: "SKIP_TODAY" }, (newState) => {
                    updateUI(newState);
                });
            }
        };
    }

    chrome.runtime.sendMessage({ type: "CHECK_STATE" }, (state) => {
        if (chrome.runtime.lastError) return;
        updateUI(state);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;

        if (
            changes.completedToday ||
            changes.skippedToday ||
            changes.streak ||
            changes.lastSession ||
            changes.feedbackMessage ||
            changes.history ||
            changes.assignedProblems ||
            changes.difficulty ||
            changes.username
        ) {
            chrome.runtime.sendMessage({ type: "CHECK_STATE" }, (state) => {
                if (chrome.runtime.lastError) return;
                updateUI(state);
            });
        }
    });

    startBtn.onclick = () => {
        const username = onboardUsername.value.trim();
        chrome.storage.local.set({ isActive: true, username: username || null }, () => {
            chrome.runtime.sendMessage({ type: "CHECK_STATE" }, (newState) => {
                updateUI(newState);
                // Immediately open problem on first start if not completed
                if (newState && !newState.completedToday && newState.assignedProblems && newState.assignedProblems.length > 0) {
                    chrome.tabs.create({ url: newState.assignedProblems[0] });
                }
            });
        });
    };

    editProfileBtn.onclick = () => {
        profileDisplay.classList.add("hidden");
        profileEdit.classList.remove("hidden");
        chrome.storage.local.get(["username"], (res) => {
            if (res.username) dashboardUsername.value = res.username;
        });
    };

    saveProfileBtn.onclick = () => {
        const username = dashboardUsername.value.trim();
        chrome.storage.local.set({ username: username || null }, () => {
            profileEdit.classList.add("hidden");
            profileDisplay.classList.remove("hidden");
            chrome.runtime.sendMessage({ type: "CHECK_STATE" }, (newState) => {
                updateUI(newState);
            });
        });
    };
});
