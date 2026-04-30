// content.js — FINAL STABLE VERSION

const REQUIRED_SECONDS = 15;
const REQUIRED_KEYS = 10;
const EFFORT_UPDATE_INTERVAL_MS = 5000;

// 🔥 INJECT NETWORK INTERCEPTOR
// This bypasses fragile DOM changes by directly listening to LeetCode's submission API.
const script = document.createElement('script');
script.textContent = `
    (function() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const url = args[0] && typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url.includes('/check/') || url.includes('/submissions/detail/')) {
                    const clone = response.clone();
                    clone.json().then(data => {
                        if (data && data.status_msg === 'Accepted' && data.state === 'SUCCESS') {
                            window.postMessage({ type: 'STREAKR_ACCEPTED' }, '*');
                        }
                    }).catch(e => {});
                }
            } catch(e) {}
            return response;
        };

        const originalXHR = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function(method, url) {
            this.addEventListener('load', function() {
                try {
                    if (typeof url === 'string' && (url.includes('/check/') || url.includes('/submissions/detail/'))) {
                        const data = JSON.parse(this.responseText);
                        if (data && data.status_msg === 'Accepted' && data.state === 'SUCCESS') {
                            window.postMessage({ type: 'STREAKR_ACCEPTED' }, '*');
                        }
                    }
                } catch(e) {}
            });
            originalXHR.apply(this, arguments);
        };
    })();
`;
(document.head || document.documentElement).appendChild(script);

// Listen for the network interceptor message
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'STREAKR_ACCEPTED') {
        window.dispatchEvent(new CustomEvent('STREAKR_TRIGGER_COMPLETE'));
    }
});

function cleanUrl(url) {
    if (!url) return "";
    const match = url.match(/(https?:\/\/(www\.)?leetcode\.com\/problems\/[^\/]+)/i);
    return match ? match[1].toLowerCase() : url.split("?")[0].replace(/\/$/, "").toLowerCase();
}

let validationStarted = false;
let lastUrl = location.href;
let stopValidation = null;

const REDIRECT_KEY = "streakr_redirected";

// 🔥 CORE ROUTER (handles SPA navigation)
function runStreakr() {
    chrome.runtime.sendMessage({ type: "CHECK_STATE" }, (state) => {
        if (chrome.runtime.lastError) return;
        if (!state || !state.isActive || state.completedToday || state.skippedToday) return;

        const currentUrl = cleanUrl(location.href);
        const assignedUrls = (state.assignedProblems || []).map(cleanUrl);

        if (assignedUrls.includes(currentUrl)) {
            sessionStorage.removeItem(REDIRECT_KEY);

            if (!validationStarted) {
                validationStarted = true;
                if (stopValidation) {
                    stopValidation();
                    stopValidation = null;
                }
                startValidation();
            }
        } else {
            const visited = (state.visitedProblems || []).map(cleanUrl);
            const nextTarget = state.assignedProblems.find(
                u => !visited.includes(cleanUrl(u))
            );

            if (
                nextTarget &&
                currentUrl !== cleanUrl(nextTarget) &&
                !sessionStorage.getItem(REDIRECT_KEY)
            ) {
                sessionStorage.setItem(REDIRECT_KEY, "1");
                location.href = nextTarget;
            }
        }
    });
}

// 🔁 Detect SPA navigation (critical fix)
setInterval(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        validationStarted = false;
        if (stopValidation) {
            stopValidation();
            stopValidation = null;
        }
        runStreakr();
    }
}, 1000);

// Initial run
runStreakr();


// 🔥 VALIDATION ENGINE
function startValidation() {
    let activeSeconds = 0;
    let isCompleted = false;

    let firstKeyTime = null;
    let lastKeyTime = null;

    const pressedKeys = new Set();
    const uniqueKeys = new Set();
    let timerId = null;
    let effortSyncId = null;

    const toast = document.createElement("div");
    toast.style.cssText = `
        position:fixed;top:20px;right:20px;
        background:#ef4444;color:white;
        padding:12px 18px;z-index:999999;
        border-radius:8px;font-size:13px;
        font-weight:600;max-width:300px;
    `;

    const msg = document.createElement("div");
    const bar = document.createElement("div");

    bar.style.cssText = "height:3px;background:white;margin-top:6px;width:0%;transition:0.5s;";

    toast.appendChild(msg);
    toast.appendChild(bar);
    document.documentElement.appendChild(toast);

    function updateUI() {
        const timeLeft = REQUIRED_SECONDS - activeSeconds;
        const keyLeft = REQUIRED_KEYS - uniqueKeys.size;

        const progress = Math.min(
            (activeSeconds / REQUIRED_SECONDS) * 100,
            (uniqueKeys.size / REQUIRED_KEYS) * 100
        );

        bar.style.width = progress + "%";

        if (uniqueKeys.size === 0) {
            msg.textContent = "Start typing to unlock streak";
        } else if (keyLeft > 0 && timeLeft > 0) {
            msg.textContent = `${keyLeft} keys + ${timeLeft}s remaining`;
        } else if (timeLeft > 0) {
            msg.textContent = `Almost done (${timeLeft}s)`;
        } else if (keyLeft > 0) {
            msg.textContent = `Need ${keyLeft} more keys`;
        }
    }

    function complete() {
        if (isCompleted) return;
        isCompleted = true;

        chrome.runtime.sendMessage({
            type: "MARK_VISITED",
            url: cleanUrl(location.href),
            timeSpent: activeSeconds,
            keys: uniqueKeys.size
        });

        toast.style.background = "#10b981";
        msg.textContent = "Streak secured!";
        bar.style.width = "100%";

        if (timerId) clearInterval(timerId);
        if (effortSyncId) clearInterval(effortSyncId);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener('STREAKR_TRIGGER_COMPLETE', onTriggerComplete);
        setTimeout(() => toast.remove(), 3000);
    }

    const onTriggerComplete = () => complete();
    window.addEventListener('STREAKR_TRIGGER_COMPLETE', onTriggerComplete);

    function effortRequirementsMet() {
        const duration = firstKeyTime && lastKeyTime
            ? (lastKeyTime - firstKeyTime) / 1000
            : 0;

        return (
            activeSeconds >= REQUIRED_SECONDS &&
            uniqueKeys.size >= REQUIRED_KEYS &&
            duration >= 8
        );
    }

    function check() {
        // Effort requirements removed to ensure real success is never blocked.
    }

    function syncEffort() {
        chrome.runtime.sendMessage({
            type: "UPDATE_EFFORT",
            timeSpent: activeSeconds,
            keys: uniqueKeys.size
        });
    }

    function onKeyDown(e) {
        if (isCompleted) return;

        if (!pressedKeys.has(e.code)) {
            pressedKeys.add(e.code);
            uniqueKeys.add(e.code);
            if (!firstKeyTime) firstKeyTime = Date.now();
            lastKeyTime = Date.now();
        }

        updateUI();
        check();
    }

    function onKeyUp(e) {
        pressedKeys.delete(e.code);
    }

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);

    timerId = setInterval(() => {
        if (isCompleted) return;

        if (document.visibilityState === "visible") {
            activeSeconds++;
            updateUI();
            check();
        }
    }, 1000);

    effortSyncId = setInterval(() => {
        if (!isCompleted) {
            syncEffort();
        }
    }, EFFORT_UPDATE_INTERVAL_MS);

    updateUI();
    syncEffort();

    stopValidation = () => {
        if (timerId) clearInterval(timerId);
        if (effortSyncId) clearInterval(effortSyncId);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener('STREAKR_TRIGGER_COMPLETE', onTriggerComplete);
        if (toast.isConnected) {
            toast.remove();
        }
    };
}
