// Content script - extracts full group member names
// Flow: click header → open group info → click "View all" → scroll & collect

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureMembers") {
    captureGroupMembers().then(sendResponse);
    return true; // keep channel open for async
  }
});

async function captureGroupMembers() {
  // Step 1: Find the chat header to get group name and verify a group is open
  const chatHeader = findChatHeader();
  if (!chatHeader) {
    return { success: false, error: "No chat is open. Please open a group chat first." };
  }

  // Get group name from header
  const groupName = getGroupName(chatHeader);

  // Check if this is a group (header subtitle has comma-separated members)
  const isGroup = checkIsGroup(chatHeader);
  if (!isGroup) {
    return { success: false, error: "This doesn't appear to be a group chat. Please open a group chat." };
  }

  // Step 2: Click the header to open group info panel
  const headerBtn = chatHeader.querySelector('div[role="button"]');
  const clickTarget = Array.from(chatHeader.querySelectorAll('div[role="button"]'))
    .find(b => b.getBoundingClientRect().width > 100);

  if (!clickTarget) {
    return { success: false, error: "Could not find group name button in header." };
  }

  clickTarget.click();
  await sleep(2000);

  // Step 3: Look for "View all" button and click it
  const viewAllBtn = findViewAllButton();
  if (viewAllBtn) {
    viewAllBtn.click();
    await sleep(2000);
  }

  // Step 4: Scroll through the member list and collect all names
  const members = await scrollAndCollectMembers();

  // Step 5: Close the panel by pressing Escape
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(500);
  // Press escape again to close group info panel too
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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
  // The group name is the first large visible text span in the header
  // (positioned at the top, y ~ 11, height ~ 21)
  // For community groups, the group name has NO title attribute
  // For regular groups, the group name also has NO title attribute
  // The subtitle (member list or community name) is below it (y ~ 32)
  const spans = header.querySelectorAll("span");
  let topSpan = null;
  let topY = Infinity;

  for (const span of spans) {
    const text = span.textContent?.trim();
    const rect = span.getBoundingClientRect();
    if (!text || text.length === 0 || text.length > 100) continue;
    if (rect.width < 50 || rect.height < 10) continue;
    // Skip icon text
    if (text.includes("-refreshed") || text.includes("ic-")) continue;
    // Skip member list
    if ((text.match(/,/g) || []).length >= 2) continue;

    // Pick the topmost (smallest y) visible text span
    if (rect.y < topY) {
      topY = rect.y;
      topSpan = span;
    }
  }

  return topSpan?.textContent?.trim() || null;
}

function checkIsGroup(header) {
  const headerText = header.textContent || "";
  // 1-on-1 chats have "default-contact-refreshed" icon — definitely not a group
  if (headerText.includes("default-contact-refreshed")) return false;
  // Regular groups: subtitle has comma-separated member names
  for (const span of header.querySelectorAll("span[title]")) {
    const title = span.getAttribute("title") || "";
    if ((title.match(/,/g) || []).length >= 2) return true;
  }
  // Community groups: header contains community or group icon text
  if (headerText.includes("community-refreshed")) return true;
  if (headerText.includes("default-group-refreshed")) return true;
  return false;
}

function findViewAllButton() {
  const buttons = document.querySelectorAll('div[role="button"]');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || "";
    if (/view all/i.test(text) && text.length < 40) {
      return btn;
    }
  }
  return null;
}

async function scrollAndCollectMembers() {
  const allMembers = new Set();

  // Collect visible members
  collectVisibleMembers(allMembers);

  // Find the scrollable container (rightmost, largest scrollHeight)
  for (let i = 0; i < 200; i++) {
    const scrollResult = scrollRightPanel();
    if (!scrollResult) break;

    await sleep(300);
    collectVisibleMembers(allMembers);

    if (scrollResult.atBottom) break;
  }

  return Array.from(allMembers);
}

function collectVisibleMembers(memberSet) {
  document.querySelectorAll('span[title]').forEach(span => {
    const rect = span.getBoundingClientRect();
    // Must be in the right area (not chat list)
    if (rect.x < 300 || rect.width < 10) return;
    // Must NOT be in a chat list row
    if (span.closest('[role="row"]')) return;
    // Must be inside a gridcell (member names are, status text is not)
    if (!span.closest('[role="gridcell"]')) return;

    const title = span.getAttribute("title");
    if (!title || title === "Loading…" || title === "You") return;

    memberSet.add(title);
  });
}

function scrollRightPanel() {
  const divs = document.querySelectorAll("div");
  let best = null;
  for (const div of divs) {
    const rect = div.getBoundingClientRect();
    if (rect.x < 250 || rect.width < 100) continue;
    if (div.scrollHeight > div.clientHeight + 20) {
      if (!best || div.scrollHeight > best.scrollHeight) {
        best = div;
      }
    }
  }
  if (!best) return null;

  const prev = best.scrollTop;
  const max = best.scrollHeight - best.clientHeight;
  best.scrollTop += 400;

  return {
    atBottom: best.scrollTop >= max - 5 || best.scrollTop === prev
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
