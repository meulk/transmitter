/**
 * Transmitter - Manifest V3 Popup Interface
 * Complete drop-in replacement for popup.js
 */

const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;

// Local cache array to allow fast local string filtering without refetching from the API
let cachedTorrentsList = [];

// --- 1. UI Initializer on Document Load ---
document.addEventListener('DOMContentLoaded', async () => {
  setupSearchFilter();
  await refreshPopupUI();
});

// --- 2. Fetch and Render Engine ---
async function refreshPopupUI() {
  const torrentListContainer = document.getElementById('torrents-list');
  if (!torrentListContainer) return;

  // Visual feedback while communicating with Transmission daemon
  torrentListContainer.innerHTML = '<div class="loading-state">Loading transfers...</div>';

  try {
    // Re-use the decoupled communication channel built into our background service worker
    const response = await sendRpcMessageToBackground('torrent-get', {
      fields: ['id', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload', 'totalSize', 'error', 'errorString']
    });

    if (!response || !response.torrents) {
      renderErrorMessage('Could not retrieve active torrents. Please verify your connection status and server configurations.');
      return;
    }

    cachedTorrentsList = response.torrents;
    renderTorrentElements(cachedTorrentsList);

  } catch (error) {
    console.error('Transmitter Popup: UI render sequence failed:', error);
    renderErrorMessage('A structural communication error occurred.');
  }
}

// --- 3. Dynamic DOM Builder ---
function renderTorrentElements(torrents) {
  const torrentListContainer = document.getElementById('torrents-list');
  if (!torrentListContainer) return;

  if (torrents.length === 0) {
    torrentListContainer.innerHTML = '<div class="empty-state">No active downloads or seeds.</div>';
    return;
  }

  // Build a memory fragment layout tree to minimize structural DOM changes and layout thrashing
  const documentFragment = document.createDocumentFragment();

  torrents.forEach(torrent => {
    const itemRow = document.createElement('div');
    itemRow.className = `torrent-item status-${torrent.status}`;
    itemRow.dataset.torrentId = torrent.id;

    // Convert transmission core engine numeric status identifiers to modern human tags
    const statusLabel = mapStatusCodeToText(torrent.status);
    const progressPercent = (torrent.percentDone * 100).toFixed(1);
    
    // Performance metrics conversions
    const downSpeed = formatSpeed(torrent.rateDownload);
    const upSpeed = formatSpeed(torrent.rateUpload);
    const speedString = torrent.rateDownload > 0 ? ` ↓ ${downSpeed}` : '';

    itemRow.innerHTML = `
      <div class="torrent-meta-row">
        <span class="torrent-title" title="${escapeHtml(torrent.name)}">${escapeHtml(torrent.name)}</span>
        <span class="torrent-speeds">${speedString}</span>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
      </div>
      <div class="torrent-status-row">
        <span>${progressPercent}% • ${statusLabel}</span>
        <span>${formatBytes(torrent.totalSize)}</span>
      </div>
    `;

    documentFragment.appendChild(itemRow);
  });

  torrentListContainer.innerHTML = '';
  torrentListContainer.appendChild(documentFragment);
}

// --- 4. Interactive Search Filter Logic ---
function setupSearchFilter() {
  const searchInput = document.getElementById('search-filter-input');
  if (!searchInput) return;

  // High performance filter sweep: immediately toggles visibility using a CSS flag
  searchInput.addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll('.torrent-item');

    rows.forEach(row => {
      const titleText = row.querySelector('.torrent-title')?.textContent.toLowerCase() || '';
      if (titleText.includes(query)) {
        row.style.display = ''; // Restore visibility
      } else {
        row.style.display = 'none'; // Hide non-matching elements instantly
      }
    });
  });
}

// --- 5. Message Passing Bridge to MV3 Service Worker ---
async function sendRpcMessageToBackground(method, args) {
  // Rather than duplicating fetch calls here, we securely pipeline queries through background.js
  return new Promise((resolve) => {
    browserAPI.runtime.sendMessage({ action: 'popup-rpc-request', method, args }, (response) => {
      if (browserAPI.runtime.lastError) {
        console.warn('Transmitter Background Worker was asleep. Retrying pipeline connection...');
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// --- 6. Helper Serialization Modules ---
function mapStatusCodeToText(code) {
  const codes = {
    0: 'Paused',
    1: 'Waiting to Verify',
    2: 'Verifying Files',
    3: 'Waiting to Download',
    4: 'Downloading',
    5: 'Waiting to Seed',
    6: 'Seeding'
  };
  return codes[code] ?? 'Unknown State';
}

function formatSpeed(bytesPerSecond) {
  if (!bytesPerSecond || bytesPerSecond === 0) return '0 KB/s';
  const kbs = bytesPerSecond / 1024;
  return kbs > 1024 ? `${(kbs / 1024).toFixed(1)} MB/s` : `${kbs.toFixed(1)} KB/s`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(string) {
  return string
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderErrorMessage(message) {
  const container = document.getElementById('torrents-list');
  if (container) {
    container.innerHTML = `<div class="error-state-alert">${escapeHtml(message)}</div>`;
  }
}
'use strict'

const torrentsPane = document.getElementById('torrents-pane')
const configPane = document.getElementById('config-pane')

for (const opener of document.querySelectorAll('.config-opener')) {
	opener.addEventListener('click', e => {
		browser.runtime.openOptionsPage()
	})
}

function showConfig (server) {
	torrentsPane.hidden = true
	configPane.hidden = false
}

const torrentsSearch = document.getElementById('torrents-search')
const torrentsList = document.getElementById('torrents-list')
const torrentsTpl = document.getElementById('torrents-tpl')
const torrentsError = document.getElementById('torrents-error')
const getArgs = {
	fields: ['id', 'name', 'percentDone', 'rateDownload', 'rateUpload', 'queuePosition', 'status']
}
let cachedTorrents = []

function renderTorrents (newTorrents) {
	if (torrentsList.children.length < newTorrents.length) {
		const dif = newTorrents.length - torrentsList.children.length
		for (let i = 0; i < dif; i++) {
			const node = document.importNode(torrentsTpl.content, true)
			torrentsList.appendChild(node)
		}
	} else if (torrentsList.children.length > newTorrents.length) {
		const oldLen = torrentsList.children.length
		const dif = oldLen - newTorrents.length
		for (let i = 1; i <= dif; i++) {
			torrentsList.removeChild(torrentsList.children[oldLen - i])
		}
	}
	for (let i = 0; i < newTorrents.length; i++) {
		const torr = newTorrents[i]
		const cont = torrentsList.children[i]
		const speeds = '↓ ' + formatSpeed(torr.rateDownload) + 'B/s ↑ ' + formatSpeed(torr.rateUpload) + 'B/s'
		const progress = cont.querySelector('.torrent-progress')
		cont.querySelector('.torrent-name').textContent = torr.name
		cont.querySelector('.torrent-speeds').textContent = speeds
		cont.querySelector('.torrent-progress').value = torr.percentDone * 100

		const pauseResumeBtn = cont.querySelector('.pause-resume-btn')
		const isComplete = torr.percentDone === 1
		const isRunning = torr.status !== 0 && !isComplete
		
		if (isComplete) {
			pauseResumeBtn.textContent = '✓'
			pauseResumeBtn.title = 'Complete - Seeding'
			pauseResumeBtn.classList.remove('paused-state', 'running-state')
			pauseResumeBtn.classList.add('complete-state')
			pauseResumeBtn.disabled = true
			progress.classList.toggle('complete', true)
		} else if (isRunning) {
			pauseResumeBtn.textContent = '⏸'
			pauseResumeBtn.title = 'Pause'
			pauseResumeBtn.classList.remove('paused-state', 'complete-state')
			pauseResumeBtn.classList.add('running-state')
			pauseResumeBtn.disabled = false
			progress.classList.toggle('paused', false)
		} else {
			pauseResumeBtn.textContent = '▶'
			pauseResumeBtn.title = 'Resume'
			pauseResumeBtn.classList.remove('running-state', 'complete-state')
			pauseResumeBtn.classList.add('paused-state')
			pauseResumeBtn.disabled = false
			progress.classList.toggle('paused', true)
		}
		
		pauseResumeBtn.onclick = async (e) => {
			e.preventDefault()
			e.stopPropagation()
			
			if (isRunning) {
				await rpcCall('torrent-stop', { ids: [torr.id] })
			} else if (!isComplete) {
				await rpcCall('torrent-start', { ids: [torr.id] })
			}
			browser.storage.local.get('server').then(({server}) => {
				if (server && server.base_url) {
					refreshTorrentsLogErr(server)
				}
			})
		}

		const deleteBtn = cont.querySelector('.remove-torrent-btn')
		
		deleteBtn.onclick = async (e) => {
			e.preventDefault()
			e.stopPropagation()

			if (torr.percentDone < 1) {
				const confirmed = await showConfirm(`"${torr.name}" is incomplete.\nRemove it AND delete downloaded data?`);
				if (confirmed) {
					removeTorrents([torr.id], true);
				}
			} else {
				const confirmed = await showConfirm(`"${torr.name}" is complete and seeding.\nRemove from list? Downloaded data will be kept.`);
				if (confirmed) {
					removeTorrents([torr.id], false);
				}
			}
		}
	}
}

function searchTorrents () {
	let newTorrents = cachedTorrents
	const val = torrentsSearch.value.toLowerCase().trim()
	if (val.length > 0) {
		newTorrents = newTorrents.filter(x => x.name.toLowerCase().includes(val))
	}
	renderTorrents(newTorrents)
}
torrentsSearch.addEventListener('change', searchTorrents)
torrentsSearch.addEventListener('keyup', searchTorrents)

function refreshTorrents (server) {
	return rpcCall('torrent-get', getArgs).then(response => {
		let newTorrents = response.arguments.torrents
		newTorrents.sort((x, y) => y.queuePosition - x.queuePosition)
		cachedTorrents = newTorrents
		torrentsSearch.hidden = newTorrents.length <= 8
		if (torrentsSearch.hidden) {
			torrentsSearch.value = ''
			renderTorrents(newTorrents)
		} else {
			searchTorrents()
		}
	})
}

function refreshTorrentsLogErr (server) {
	return refreshTorrents(server).catch(err => {
		console.error(err)
		torrentsError.textContent = 'Error: ' + err.toString()
	})
}

function showTorrents (server) {
	torrentsPane.hidden = false
	configPane.hidden = true
	for (const opener of document.querySelectorAll('.webui-opener')) {
		opener.href = server.base_url + 'web/'
	}
	refreshTorrents(server).catch(_ => refreshTorrentsLogErr(server))
	setInterval(() => refreshTorrentsLogErr(server), 2000)
}

browser.storage.local.get('server').then(({server}) => {
	if (server && server.base_url && server.base_url !== '') {
		showTorrents(server)
	} else {
		showConfig(server)
	}
})

async function removeTorrents(ids, deleteData = false) {
	if (!ids || ids.length === 0) return;
	try {
		const args = { ids: ids };
		
		if (deleteData === true) {
			args['delete-local-data'] = true;
		}

		await rpcCall('torrent-remove', args);
		
		browser.storage.local.get('server').then(({server}) => {
			if (server && server.base_url) {
				refreshTorrentsLogErr(server);
			}
		});
	} catch (err) {
		console.error("Transmitter: Failed to remove torrents", err);
	}
}

function showConfirm(message) {
	return new Promise((resolve) => {
		const dialog = document.getElementById('custom-modal');
		const text = document.getElementById('modal-text');
		const btnYes = document.getElementById('modal-yes');
		const btnCancel = document.getElementById('modal-cancel');

		text.textContent = message;
		dialog.showModal();

		const cleanup = () => {
			dialog.close();
			btnYes.onclick = null;
			btnCancel.onclick = null;
		};

		btnYes.onclick = () => { cleanup(); resolve(true); };
		btnCancel.onclick = () => { cleanup(); resolve(false); };
	});
}

document.getElementById('clear-completed').addEventListener('click', async (e) => {
	e.preventDefault();

	const completedIds = cachedTorrents
		.filter(t => t.percentDone === 1)
		.map(t => t.id);

	if (completedIds.length > 0) {
		const confirmed = await showConfirm(`Remove ${completedIds.length} completed torrent(s) from list? Downloaded data will be kept.`)
		if (confirmed) {
			removeTorrents(completedIds, false)
		}
	}
});
