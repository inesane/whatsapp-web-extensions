# WhatsApp Web Extensions

Chrome extensions for WhatsApp Web that help manage and analyze your groups and contacts.

## Extensions

### Group Compare — [Install from Chrome Web Store](https://chromewebstore.google.com/detail/whatsapp-group-compare/lmpekhlnfncmgkhimmdnddfgfihhpeje)

Find common members between two WhatsApp groups.

1. Open a group chat on WhatsApp Web
2. Click **Capture Group A** in the extension popup
3. Open another group chat and click **Capture Group B**
4. Click **Find Common Members**

The extension automatically opens the group info panel, scrolls through all members (including clicking "View all" for large groups), and collects full contact names.

### Group Finder

Find WhatsApp groups that contain a specific set of contacts.

1. Open a 1-on-1 chat with a contact
2. Click **Add Contact** — the extension reads their "groups in common" from contact info
3. Repeat for each contact you want to check
4. Click **Find Groups** to see the intersection

Groups where the member count exactly matches your selected contacts + you are highlighted as **exact matches**.

## Installation

1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select either the `group-compare/` or `group-finder/` folder

Group Compare is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/whatsapp-group-compare/lmpekhlnfncmgkhimmdnddfgfihhpeje). Group Finder will be available soon.

## How It Works

These extensions use content scripts that interact with the WhatsApp Web DOM to extract group and contact information. No data is sent to any external server — everything runs locally in your browser.
