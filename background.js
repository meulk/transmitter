/**
 * Transmitter - Manifest V3 Background Service Worker
 * Complete drop-in replacement for background.js
 */

const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

// --- 1. Extension Lifecycle Initialization ---
browserAPI.runtime.onInstalled.addListener(() => {
  rebuildContextMenus();
  setupPollingAlarm();
});

browserAPI.runtime.onStartup.addListener(() => {
  rebuildContextMenus();
  setupPollingAlarm();
});

// --- 2. Alarm Handler (Replaces legacy setInterval) ---
browserAPI.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll-transmission-stats') {
    updateTransmissionStats();
  }
});

function setupPollingAlarm() {
  browserAPI.alarms.get('poll-transmission-stats', (existingAlarm) => {
    if (!existingAlarm) {
      // Manifest V3 restricts periodic background alarms to a 1-minute minimum
      browserAPI.alarms.create('poll-transmission-stats', {
        periodInMinutes: 1.0
      });
    }
  });
}

// --- 3. Context Menu Construction & Click Handler ---
function rebuildContextMenus() {
  browserAPI.contextMenus.removeAll(() => {
    browserAPI.contextMenus.create({
      id: 'download-with-transmitter',
      title: 'Download with Transmission',
      contexts: ['link']
    });
  });
}

browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-with-transmitter' && info.linkUrl) {
    addTorrent(info.linkUrl);
  }
});

// --- 4. Transmission RPC Engine Core ---
async function makeRpcRequest(method, args = {}) {
  const settings = await browserAPI.storage.local.get(['rpc_url', 'session_id']);
  if (!settings.rpc_url) {
    console.warn('Transmitter: RPC URL is not configured in extension options.');
    return null;
  }

  // Sanitize trailing slash and ensure correct RPC endpoint path
  let baseUrl = settings.rpc_url.endsWith('/') ? settings.rpc_url.slice(0, -1) : settings.rpc_url;
  if (!baseUrl.endsWith('/rpc') && !baseUrl.endsWith('/web')) {
    baseUrl = `${baseUrl}/transmission/rpc`;
  } else if (baseUrl.endsWith('/web')) {
    baseUrl = baseUrl.replace(/\/web\$/, '/rpc');
  }

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Transmission-Session-Id': settings.session_id || ''
      },
      body: JSON.stringify({ method, arguments: args })
    });

    // Handle standard Transmission token negotiation (409 Conflict)
    if (response.status === 409) {
      const newSessionId = response.headers.get('X-Transmission-Session-Id');
      if (newSessionId) {
        await browserAPI.storage.local.set({ session_id: newSessionId });
        return makeRpcRequest(method, args); // Retry request recursively with fresh token
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    const payload = await response.json();
    if (payload.result !== 'success') {
      throw new Error(`RPC Error: ${payload.result}`);
    }

    return payload.arguments;
  } catch (err) {
    console.error('Transmitter: RPC Network communication failed:', err);
    return null;
  }
}

// --- 5. Functional Action Implementation ---
async function addTorrent(torrentUrl) {
  const result = await makeRpcRequest('torrent-add', { filename: torrentUrl });
  if (result) {
    // Fire a native browser alert notification on successful upload
    browserAPI.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: 'Transmitter',
      message: 'Torrent successfully sent to Transmission!'
    });
    // Trigger immediate badge refresh to capture the newly added item
    updateTransmissionStats();
  }
}

async function updateTransmissionStats() {
  const stats = await makeRpcRequest('session-stats');
  if (!stats) {
    browserAPI.action.setBadgeText({ text: 'ERR' });
    browserAPI.action.setBadgeBackgroundColor({ color: '#D32F2F' });
    return;
  }

  const downSpeed = stats.downloadSpeed || 0;
  if (downSpeed === 0) {
    browserAPI.action.setBadgeText({ text: '' }); // Clear badge if completely idling
  } else {
    browserAPI.action.setBadgeText({ text: formatSpeedString(downSpeed) });
    browserAPI.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  }
}

// Byte utility serialization
function formatSpeedString(bytesPerSecond) {
  const kbs = bytesPerSecond / 1024;
  if (kbs > 1024) {
    return `${(kbs / 1024).toFixed(1)}M`;
  }
  return `${kbs.toFixed(0)}K`;
}
