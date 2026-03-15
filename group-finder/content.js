// Content script for WhatsApp Group Finder
// Opens contact info, collects "groups in common" with member counts

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureContact") {
    captureContactInfo().then(sendResponse);
    return true;
  }
  if (request.action === "getCommonGroups") {
    getCommonGroups().then(sendResponse);
    return true;
  }
});

function findChatHeader() {
  const headers = document.querySelectorAll("header");
  for (const h of headers) {
    const rect = h.getBoundingClientRect();
    if (rect.width > 500 && rect.y < 80 && rect.x > 300) return h;
  }
  return null;
}

function getChatName(header) {
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
    if (rect.y < topY) { topY = rect.y; topSpan = span; }
  }
  return topSpan?.textContent?.trim() || null;
}

function isGroupChat(header) {
  for (const span of header.querySelectorAll("span[title]")) {
    const title = span.getAttribute("title") || "";
    if ((title.match(/,/g) || []).length >= 2) return true;
  }
  const text = header.textContent || "";
  if (text.includes("community-refreshed") || text.includes("default-group-refreshed")) return true;
  return false;
}

async function captureContactInfo() {
  const header = findChatHeader();
  if (!header) {
    return { success: false, error: "No chat is open. Please open a 1-on-1 chat first." };
  }
  if (isGroupChat(header)) {
    return { success: false, error: "This is a group chat. Please open a 1-on-1 chat with a contact." };
  }
  const name = getChatName(header);
  if (!name) {
    return { success: false, error: "Could not read contact name from header." };
  }
  return { success: true, contactName: name };
}

async function getCommonGroups() {
  const header = findChatHeader();
  if (!header) {
    return { success: false, error: "No chat is open." };
  }

  const name = getChatName(header);

  const clickTarget = Array.from(header.querySelectorAll('div[role="button"]'))
    .find(b => b.getBoundingClientRect().width > 100);
  if (!clickTarget) {
    return { success: false, error: "Could not open contact info." };
  }

  clickTarget.click();
  await sleep(2000);

  // Collect groups with their member counts
  const groupsMap = await collectGroupsInCommon();

  pressEscape();
  await sleep(300);
  pressEscape();
  await sleep(300);

  // Convert to array of {name, memberCount}
  const groups = Object.entries(groupsMap).map(([name, count]) => ({
    name,
    memberCount: count
  })).sort((a, b) => a.name.localeCompare(b.name));

  return {
    success: true,
    contactName: name,
    groups: groups
  };
}

async function collectGroupsInCommon() {
  // Map of groupName -> memberCount
  const allGroups = {};
  let foundSection = false;

  for (let i = 0; i < 30; i++) {
    if (!foundSection) {
      document.querySelectorAll("span").forEach(span => {
        const text = span.textContent?.trim() || "";
        if (/\d+\s+group.*common/i.test(text)) foundSection = true;
      });
    }

    if (foundSection) collectRightPanelGroupsWithCounts(allGroups);

    const scrolled = scrollRightPanel();
    if (!scrolled) break;
    await sleep(400);
  }

  if (!foundSection) return allGroups;

  // Check for "N more" button and click it
  const moreBtn = findMoreButton();
  if (moreBtn) {
    moreBtn.click();
    await sleep(2000);

    for (let i = 0; i < 50; i++) {
      collectRightPanelGroupsWithCounts(allGroups);
      const scrolled = scrollRightPanel();
      if (!scrolled) break;
      await sleep(300);
    }
    collectRightPanelGroupsWithCounts(allGroups);
  }

  return allGroups;
}

function collectRightPanelGroupsWithCounts(groupsMap) {
  // In the "groups in common" list, each group is a listitem with:
  //   - a span[title] inside gridcell = group name
  //   - a span[title] NOT in gridcell = comma-separated member subtitle
  // They appear as sibling-ish elements within the same listitem/button container

  document.querySelectorAll('[role="listitem"]').forEach(listitem => {
    const rect = listitem.getBoundingClientRect();
    if (rect.x < 400 || rect.width < 50) return;

    let groupName = null;
    let memberCount = -1;

    listitem.querySelectorAll('span[title]').forEach(span => {
      const title = span.getAttribute("title") || "";
      if (!title || title === "Loading…") return;

      if (span.closest('[role="gridcell"]')) {
        // This is the group name
        groupName = title;
      } else {
        // This is the member subtitle (e.g., "Aadhaaras, Maygyatta, You")
        // Count members by splitting on commas
        const members = title.split(",").map(s => s.trim()).filter(s => s.length > 0);
        if (members.length > 0) {
          memberCount = members.length;
        }
      }
    });

    if (groupName && groupName !== "You" && !groupsMap.hasOwnProperty(groupName)) {
      groupsMap[groupName] = memberCount;
    }
  });

  // Fallback: also scan for gridcell span[title] not yet captured
  // (in case the listitem structure differs)
  document.querySelectorAll('span[title]').forEach(span => {
    const rect = span.getBoundingClientRect();
    if (rect.x < 400 || rect.width < 10) return;
    if (span.closest('[role="row"]')) return;
    if (!span.closest('[role="gridcell"]')) return;
    const title = span.getAttribute("title");
    if (!title || title === "Loading…" || title === "You") return;
    if (groupsMap.hasOwnProperty(title)) return;

    // Try to find the sibling member subtitle
    const listitem = span.closest('[role="listitem"]') || span.closest('[role="button"]');
    let memberCount = -1;
    if (listitem) {
      listitem.querySelectorAll('span[title]').forEach(s => {
        if (s === span) return;
        const t = s.getAttribute("title") || "";
        const commas = (t.match(/,/g) || []).length;
        if (commas >= 1) {
          memberCount = t.split(",").map(x => x.trim()).filter(x => x.length > 0).length;
        }
      });
    }

    groupsMap[title] = memberCount;
  });
}

function findMoreButton() {
  const buttons = document.querySelectorAll('div[role="button"], button');
  for (const btn of buttons) {
    const text = btn.textContent?.trim() || "";
    const rect = btn.getBoundingClientRect();
    if (rect.x < 400) continue;
    if (/\d+\s+more/i.test(text) && text.length < 30) return btn;
  }
  const divs = document.querySelectorAll("div");
  for (const div of divs) {
    const text = div.textContent?.trim() || "";
    const rect = div.getBoundingClientRect();
    if (rect.x < 400 || rect.width < 50) continue;
    if (/^\s*chevron\s*\d+\s+more\s*$/i.test(text) && text.length < 40) return div;
  }
  return null;
}

function scrollRightPanel() {
  const divs = document.querySelectorAll("div");
  let best = null;
  let bestHeight = 0;
  for (const div of divs) {
    const rect = div.getBoundingClientRect();
    if (rect.x < 350 || rect.width < 100) continue;
    if (div.scrollHeight > div.clientHeight + 20) {
      if (rect.height > bestHeight) { bestHeight = rect.height; best = div; }
    }
  }
  if (!best) return false;
  const prev = best.scrollTop;
  const max = best.scrollHeight - best.clientHeight;
  best.scrollTop += 400;
  return !(best.scrollTop >= max - 5 && prev >= max - 5);
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
