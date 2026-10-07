/**
 * Transmitter - Manifest V3 Options Panel Configuration
 * Complete drop-in replacement for options.js
 */

const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

// --- 1. DOM Lifecycle Bindings ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadSavedSettings();
  
  // Explicitly attach event listeners to comply with MV3 CSP regulations
  document.getElementById('options-form').addEventListener('submit', saveSettings);
  document.getElementById('test-connection-btn').addEventListener('click', testServerConnection);
});

// --- 2. Load Saved Preferences ---
async function loadSavedSettings() {
  try {
    const settings = await browserAPI.storage.local.get({
      rpc_url: 'http://localhost:9091/transmission/',
      download_dir: ''
    });

    document.getElementById('rpc-url-input').value = settings.rpc_url;
    document.getElementById('download-dir-input').value = settings.download_dir;
  } catch (error) {
    console.error('Transmitter Options: Failed to load user storage metrics:', error);
    showStatusAlert('Failed to initialize local settings storage profiles.', 'error');
  }
}

// --- 3. Save Preferences to Storage ---
async function saveSettings(event) {
  event.preventDefault(); // Stop standard form submission reloads

  let rpcUrl = document.getElementById('rpc-url-input').value.trim();
  const downloadDir = document.getElementById('download-dir-input').value.trim();

  if (!rpcUrl) {
    showStatusAlert('Transmission RPC Endpoint URL is a mandatory parameter.', 'error');
    return;
  }

  // Ensure trailing slash structural compliance for generic concatenation
  if (!rpcUrl.endsWith('/')) {
    rpcUrl += '/';
  }

  try {
    await browserAPI.storage.local.set({
      rpc_url: rpcUrl,
      download_dir: downloadDir
    });

    showStatusAlert('Configuration preferences saved successfully!', 'success');
    
    // Proactively alert the running service worker background daemon to re-trigger statistics polling
    browserAPI.runtime.sendMessage({ action: 'trigger-immediate-poll' });

  } catch (error) {
    console.error('Transmitter Options: Failed to write configuration updates:', error);
    showStatusAlert('Could not save configuration changes into local browser data engines.', 'error');
  }
}

// --- 4. Live Server Connection Diagnosis Tester ---
async function testServerConnection() {
  const statusIndicator = document.getElementById('connection-test-status');
  let rpcUrl = document.getElementById('rpc-url-input').value.trim();

  if (!rpcUrl) {
    statusIndicator.className = 'status-msg error';
    statusIndicator.textContent = 'Please type a valid server URL address baseline first.';
    return;
  }

  if (!rpcUrl.endsWith('/')) {
    rpcUrl += '/';
  }

  statusIndicator.className = 'status-msg loading';
  statusIndicator.textContent = 'Contacting Transmission Daemon...';

  // Format testing endpoint
  let testUrl = rpcUrl;
  if (!testUrl.endsWith('/rpc') && !testUrl.endsWith('/web')) {
    testUrl = `${testUrl}transmission/rpc`;
  } else if (testUrl.endsWith('/web')) {
    testUrl = testUrl.replace(/\/web\/\$/, '/rpc');
  }

  try {
    // Send a standard validation probe request
    const response = await fetch(testUrl, {
      method: 'POST',
      body: JSON.stringify({ method: 'session-get' })
    });

    // Transmission's 409 Conflict code indicates the server is alive and negotiating session tokens
    if (response.status === 200 || response.status === 409) {
      statusIndicator.className = 'status-msg success';
      statusIndicator.textContent = 'Connection Verified! Server successfully acknowledged endpoint.';
    } else {
      statusIndicator.className = 'status-msg error';
      statusIndicator.textContent = `Server responded with HTTP Error Status Code: ${response.status}`;
    }
  } catch (error) {
    console.error('Transmitter Options: Diagnostic connection endpoint lookup failure:', error);
    statusIndicator.className = 'status-msg error';
    statusIndicator.textContent = 'Failed to reach host. Check network, ports, or CORS rules.';
  }
}

// --- 5. UI Notification Utilities ---
function showStatusAlert(message, type) {
  const messageBox = document.getElementById('form-status-alert');
  messageBox.textContent = message;
  messageBox.className = `alert-box visible ${type}`;

  // Automatically fade visual alerts out after a short duration
  setTimeout(() => {
    messageBox.className = 'alert-box';
  }, 4000);
}
