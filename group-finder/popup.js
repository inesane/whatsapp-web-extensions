let contacts = []; // [{name, groups: [{name, memberCount}]}]

const addBtn = document.getElementById("addContact");
const findBtn = document.getElementById("findGroups");
const statusEl = document.getElementById("status");
const tagsDiv = document.getElementById("contactTags");
const exactResultsDiv = document.getElementById("exactResults");
const commonResultsDiv = document.getElementById("commonResults");
const exactList = document.getElementById("exactList");
const commonList = document.getElementById("commonList");
const clearBtn = document.getElementById("clearAll");

// Load saved contacts on popup open
chrome.storage.local.get(["gfContacts"], (data) => {
  if (data.gfContacts) {
    contacts = data.gfContacts;
    updateUI();
    if (contacts.length > 0) clearBtn.style.display = "block";
  }
});

function saveContacts() {
  chrome.storage.local.set({ gfContacts: contacts });
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#e74c3c" : "#667781";
}

function updateUI() {
  tagsDiv.innerHTML = contacts.map((c, i) =>
    `<span class="tag">${c.name} <span class="count">(${c.groups.length} groups)</span><span class="remove" data-index="${i}">&times;</span></span>`
  ).join("");

  tagsDiv.querySelectorAll(".remove").forEach(btn => {
    btn.addEventListener("click", () => {
      contacts.splice(parseInt(btn.dataset.index), 1);
      saveContacts();
      updateUI();
      exactResultsDiv.style.display = "none";
      commonResultsDiv.style.display = "none";
      if (contacts.length === 0) clearBtn.style.display = "none";
    });
  });

  findBtn.disabled = contacts.length < 1;
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("web.whatsapp.com")) {
    setStatus("Please open WhatsApp Web first!", true);
    return null;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) {}
  return tab;
}

addBtn.addEventListener("click", async () => {
  const tab = await getTab();
  if (!tab) return;

  setStatus("Reading contact name...");

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: "captureContact" });
  } catch (e) {
    setStatus("Could not connect. Refresh WhatsApp Web.", true);
    return;
  }

  if (!response?.success) {
    setStatus(response?.error || "Failed to read contact.", true);
    return;
  }

  const contactName = response.contactName;

  if (contacts.some(c => c.name.toLowerCase() === contactName.toLowerCase())) {
    setStatus(`"${contactName}" is already added.`, true);
    return;
  }

  setStatus(`Getting groups in common for "${contactName}"...`);

  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: "getCommonGroups" });
  } catch (e) {
    setStatus("Error getting groups. Try again.", true);
    return;
  }

  if (!response?.success) {
    setStatus(response?.error || "Failed to get groups.", true);
    return;
  }

  contacts.push({ name: contactName, groups: response.groups });
  saveContacts();
  updateUI();
  clearBtn.style.display = "block";
  setStatus(`Added "${contactName}" with ${response.groups.length} common groups.`);
});

findBtn.addEventListener("click", () => {
  if (contacts.length < 1) return;

  // Build map of groupName -> {memberCount, from all contacts}
  // groups are now [{name, memberCount}]
  const groupSets = contacts.map(c => new Set(c.groups.map(g => g.name)));

  // Find group names common to ALL contacts
  let commonNames;
  if (groupSets.length === 1) {
    commonNames = [...groupSets[0]];
  } else {
    commonNames = [...groupSets[0]].filter(name => groupSets.every(s => s.has(name)));
  }
  commonNames.sort();

  // Build a member count lookup from the first contact's data
  // (member count should be the same regardless of which contact we got it from)
  const memberCounts = {};
  for (const contact of contacts) {
    for (const g of contact.groups) {
      if (!memberCounts[g.name] || memberCounts[g.name] === -1) {
        memberCounts[g.name] = g.memberCount;
      }
    }
  }

  // Exact match = group where memberCount === contacts.length + 1 (them + you)
  const expectedSize = contacts.length + 1;
  const exact = [];
  const other = [];

  for (const name of commonNames) {
    const count = memberCounts[name];
    if (count === expectedSize) {
      exact.push({ name, memberCount: count });
    } else {
      other.push({ name, memberCount: count });
    }
  }

  // Display exact matches
  if (exact.length > 0) {
    exactResultsDiv.style.display = "block";
    const contactNames = contacts.map(c => c.name).join(", ");
    exactResultsDiv.querySelector("h3").textContent =
      `Exact match${exact.length !== 1 ? "es" : ""} (only ${contactNames} + you)`;
    exactList.innerHTML = exact.map(g =>
      `<div class="exact-match">${g.name}</div>`
    ).join("");
  } else {
    exactResultsDiv.style.display = "none";
  }

  // Display other common groups
  if (other.length > 0) {
    commonResultsDiv.style.display = "block";
    commonResultsDiv.querySelector("h3").textContent =
      `${other.length} other common group${other.length !== 1 ? "s" : ""}`;
    commonList.innerHTML = other.map(g => {
      const countStr = g.memberCount > 0 ? ` (${g.memberCount} members)` : "";
      return `<div>${g.name}<span style="color:#667781;font-size:11px">${countStr}</span></div>`;
    }).join("");
  } else if (exact.length > 0) {
    commonResultsDiv.style.display = "none";
  }

  if (commonNames.length === 0) {
    exactResultsDiv.style.display = "none";
    commonResultsDiv.style.display = "block";
    commonResultsDiv.querySelector("h3").textContent = "Common groups";
    commonList.innerHTML = '<div class="no-results">No groups found containing all these contacts.</div>';
  }

  clearBtn.style.display = "block";
  const summary = exact.length > 0
    ? `Found ${exact.length} exact match${exact.length !== 1 ? "es" : ""} and ${other.length} other group${other.length !== 1 ? "s" : ""}.`
    : `Found ${commonNames.length} common group${commonNames.length !== 1 ? "s" : ""}. No exact matches.`;
  setStatus(summary);
});

clearBtn.addEventListener("click", () => {
  contacts = [];
  saveContacts();
  updateUI();
  exactResultsDiv.style.display = "none";
  commonResultsDiv.style.display = "none";
  clearBtn.style.display = "none";
  setStatus("");
});
