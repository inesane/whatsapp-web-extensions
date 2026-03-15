let groupA = null;
let groupB = null;

// Load saved groups from storage on popup open
chrome.storage.local.get(["groupA", "groupB"], (data) => {
  if (data.groupA) {
    groupA = data.groupA;
    updateGroupUI("A", groupA);
  }
  if (data.groupB) {
    groupB = data.groupB;
    updateGroupUI("B", groupB);
  }
  updateCompareButton();
});

function updateGroupUI(label, group) {
  document.getElementById(`group${label}-name`).textContent = group.name;
  document.getElementById(`group${label}-count`).textContent = `(${group.members.length} members)`;
  document.getElementById(`clear${label}`).style.display = "inline";
}

function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.style.color = isError ? "#e74c3c" : "#667781";
}

function updateCompareButton() {
  document.getElementById("compare").disabled = !(groupA && groupB);
}

async function captureGroup(label) {
  setStatus("Capturing members...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes("web.whatsapp.com")) {
      setStatus("Please open WhatsApp Web first!", true);
      return;
    }

    // Ensure content script is injected (handles tabs open before extension install)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    } catch (e) {
      // Script may already be injected, that's fine
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "captureMembers" });
    } catch (e) {
      setStatus("Could not connect to WhatsApp Web. Please refresh the tab and try again.", true);
      return;
    }

    if (!response || !response.success) {
      setStatus(response?.error || "Failed to capture members. Is a group chat open?", true);
      return;
    }

    const group = {
      name: response.groupName,
      members: response.members
    };

    if (label === "A") {
      groupA = group;
      chrome.storage.local.set({ groupA: group });
    } else {
      groupB = group;
      chrome.storage.local.set({ groupB: group });
    }

    updateGroupUI(label, group);
    updateCompareButton();
    setStatus(`Captured ${group.members.length} members from "${group.name}"`);

  } catch (err) {
    setStatus("Error: " + err.message, true);
  }
}

function clearGroup(label) {
  if (label === "A") {
    groupA = null;
    chrome.storage.local.remove("groupA");
  } else {
    groupB = null;
    chrome.storage.local.remove("groupB");
  }
  document.getElementById(`group${label}-name`).textContent = "Not captured";
  document.getElementById(`group${label}-count`).textContent = "";
  document.getElementById(`clear${label}`).style.display = "none";
  document.getElementById("results").style.display = "none";
  updateCompareButton();
  setStatus("");
}

function findCommonMembers() {
  if (!groupA || !groupB) return;

  // Normalize names for comparison (lowercase, trim whitespace)
  const normalize = (name) => name.toLowerCase().trim();

  const setB = new Map(groupB.members.map(m => [normalize(m), m]));

  const common = [];
  for (const member of groupA.members) {
    const key = normalize(member);
    if (setB.has(key)) {
      common.push(member);
    }
  }

  // Sort: 1) saved contacts, 2) ~unsaved with names, 3) phone numbers
  const tier = (s) => /^\+/.test(s) ? 2 : /^~/.test(s) ? 1 : 0;
  common.sort((a, b) => {
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    return a.localeCompare(b);
  });

  const resultsDiv = document.getElementById("results");
  const titleEl = document.getElementById("results-title");
  const listEl = document.getElementById("common-list");

  resultsDiv.style.display = "block";
  titleEl.textContent = `${common.length} common member${common.length !== 1 ? "s" : ""} between "${groupA.name}" and "${groupB.name}"`;

  if (common.length === 0) {
    listEl.innerHTML = "<div style='color:#667781;padding:8px'>No common members found.</div>";
  } else {
    listEl.innerHTML = common.map(m => `<div>${m}</div>`).join("");
  }
}

// Event listeners
document.getElementById("captureA").addEventListener("click", () => captureGroup("A"));
document.getElementById("captureB").addEventListener("click", () => captureGroup("B"));
document.getElementById("clearA").addEventListener("click", () => clearGroup("A"));
document.getElementById("clearB").addEventListener("click", () => clearGroup("B"));
document.getElementById("compare").addEventListener("click", findCommonMembers);
