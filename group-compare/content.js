// Content script - extracts full group member names
// Flow: click header → open group info → click "View all" → scroll & collect

if (window.__gcLoaded) {
  // Already injected — skip re-declaration to avoid "already declared" errors
} else {
window.__gcLoaded = true;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureMembers") {
    captureGroupMembers().then(sendResponse);
    return true; // keep channel open for async
  }
});

async function captureGroupMembers() {
  const chatHeader = findChatHeader();
  if (!chatHeader) {
    return { success: false, error: "No chat is open. Please open a group chat first." };
  }

  const groupName = getGroupName(chatHeader);

  // Retry for up to 4s to let the subtitle load before checking
  let isGroup = false;
  for (let i = 0; i < 8; i++) {
    isGroup = checkIsGroup(chatHeader);
    if (isGroup) break;
    await sleep(500);
  }
  if (!isGroup) {
    return { success: false, error: "This doesn't appear to be a group chat. Please open a group chat." };
  }

  const clickTarget = Array.from(chatHeader.querySelectorAll('div[role="button"]'))
    .find(b => b.getBoundingClientRect().width > 100);
  if (!clickTarget) {
    return { success: false, error: "Could not find group name button in header." };
  }

  clickTarget.click();
  await sleep(2500);

  const viewAllBtn = findViewAllButton();
  if (viewAllBtn) {
    viewAllBtn.click();
    await sleep(2500);
  }

  const members = await scrollAndCollectMembers();

  closeMemberListPanel();

  if (members.length === 0) {
    return { success: false, error: "Could not find any members. Try again." };
  }

  return {
    success: true,
    groupName: groupName || "Unknown Group",
    members: members.sort()
  };
}

function findChatHeader() {
  const headers = document.querySelectorAll("header");
  for (const h of headers) {
    const rect = h.getBoundingClientRect();
    if (rect.width > 500 && rect.y < 80 && rect.x > 300) {
      return h;
    }
  }
  return null;
}

function getGroupName(header) {
  const spans = header.querySelectorAll("span");
  let topSpan = null;
  let topY = Infinity;

  for (const span of spans) {
    const text = span.textContent?.trim();
    const rect = span.getBoundingClientRect();
    if (!text || text.length === 0 || text.length > 100) continue;
    if (rect.width < 50 || rect.height < 10) continue;
    if (text.includes("-refreshed") || text.includes("ic-")) continue;
    if ((text.match(/,/g) || []).length >= 2) continue;
    if (rect.y < topY) {
      topY = rect.y;
      topSpan = span;
    }
  }

  return topSpan?.textContent?.trim() || null;
}

function checkIsGroup(header) {
  const headerText = header.textContent || "";
  if (headerText.includes("default-contact-refreshed")) return false;
  if (headerText.includes("community-refreshed")) return true;
  if (headerText.includes("default-group-refreshed")) return true;
  for (const span of header.querySelectorAll("span[title]")) {
    const title = span.getAttribute("title") || "";
    if ((title.match(/,/g) || []).length >= 2) return true;
  }
  for (const span of header.querySelectorAll("span")) {
    const text = span.textContent?.trim() || "";
    if (/^\d+\s+members?$/i.test(text)) return true;
  }
  return false;
}

function findViewAllButton() {
  const isMatch = text => /view (all|more)/i.test(text) || /^\+?\d+\s+more$/i.test(text);
  const inRightPanel = el => {
    const rect = el.getBoundingClientRect();
    return rect.width > 10 && rect.x > 300;
  };

  for (const btn of document.querySelectorAll('div[role="button"]')) {
    const text = btn.textContent?.trim() || "";
    if (isMatch(text) && text.length < 60 && inRightPanel(btn)) return btn;
  }

  for (const el of document.querySelectorAll('div, span, li')) {
    if (el.children.length > 8) continue;
    const text = el.textContent?.trim() || "";
    if (isMatch(text) && text.length < 60 && inRightPanel(el)) return el;
  }

  return null;
}

async function scrollAndCollectMembers() {
  const allMembers = new Map();

  collectVisibleMembers(allMembers);

  const panel = findMemberPanel();
  if (!panel) return Array.from(allMembers.values());

  for (let i = 0; i < 200; i++) {
    collectVisibleMembers(allMembers);

    const prev = panel.scrollTop;
    const max = panel.scrollHeight - panel.clientHeight;
    panel.scrollTop += 400;

    await waitForStable(allMembers);
    collectVisibleMembers(allMembers);

    if (panel.scrollTop >= max - 5 || panel.scrollTop === prev) break;
  }

  const nameCounts = new Map();
  for (const { name } of allMembers.values()) {
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }

  return Array.from(allMembers.values()).map(({ name, phone }) => {
    const isDuplicate = nameCounts.get(name) > 1;
    const isUnsaved = name.startsWith("~");
    return ((isDuplicate || isUnsaved) && phone) ? `${name} (${phone})` : name;
  });
}

function findMemberPanel() {
  const memberSpans = Array.from(document.querySelectorAll('span[title]')).filter(span => {
    const rect = span.getBoundingClientRect();
    if (rect.x < 300 || rect.width < 10) return false;
    if (span.closest('[role="row"]')) return false;
    if (!span.closest('[role="gridcell"]')) return false;
    const title = span.getAttribute("title");
    return title && title !== "Loading…" && title !== "You";
  });

  if (memberSpans.length === 0) return null;

  let el = memberSpans[0].parentElement;
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 20) return el;
    el = el.parentElement;
  }
  return null;
}

function collectVisibleMembers(memberMap) {
  document.querySelectorAll('span[title]').forEach(span => {
    const rect = span.getBoundingClientRect();
    if (rect.x < 300 || rect.width < 10) return;
    if (span.closest('[role="row"]')) return;
    if (!span.closest('[role="gridcell"]')) return;

    const title = span.getAttribute("title");
    if (!title || title === "Loading…" || title === "You") return;

    let container = span.parentElement;
    while (container && container !== document.body && container.children.length <= 1) {
      container = container.parentElement;
    }
    let phone = null;
    if (container) {
      for (const child of container.children) {
        if (child.contains(span)) continue;
        const t = child.textContent?.trim() || "";
        if (!t || isNonPhoneText(t)) continue;
        // Extract phone number from text — it may be followed by a status message
        const match = t.match(/\+[\d\s\-().]{5,}/);
        if (match) { phone = match[0].trim(); break; }
      }
    }

    const isPhone = !!phone;
    const key = isPhone ? `${title}|||${phone}` : title;

    if (memberMap.has(key)) return;

    if (isPhone) {
      if (memberMap.has(title)) memberMap.delete(title);
    } else {
      if (Array.from(memberMap.keys()).some(k => k.startsWith(`${title}|||`))) return;
    }

    memberMap.set(key, { name: title, phone: isPhone ? phone : null });
  });
}

function closeMemberListPanel() {
  const btn = document.querySelector('button[aria-label="Close"][data-tab="2"]');
  if (btn) { btn.click(); return; }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

const NON_PHONE_TEXTS = new Set(["group admin", "admin", "you"]);
function isNonPhoneText(t) {
  return NON_PHONE_TEXTS.has(t.toLowerCase());
}

async function waitForStable(memberMap) {
  const timeout = 1500;
  const interval = 100;
  const stableNeeded = 2;
  const start = Date.now();
  let stableCount = 0;
  let lastSize = memberMap.size;

  while (Date.now() - start < timeout) {
    await sleep(interval);
    collectVisibleMembers(memberMap);
    if (memberMap.size === lastSize) {
      stableCount++;
      if (stableCount >= stableNeeded) break;
    } else {
      stableCount = 0;
      lastSize = memberMap.size;
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

} // end if (!window.__gcLoaded)
