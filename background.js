// Background service worker for Chrome Extension
let isRunning = false;
let intervalId = null;
let currentTabId = null;

// List of URLs to randomly select from
const TARGET_URLS = [
  'https://www.competitiondatabase.co.uk',
  'https://www.facebook.com',
  'https://www.google.com',
  'https://www.yahoo.com'
];

// Configuration
const SCREENSHOT_INTERVAL = 60000; // 1 minute in milliseconds
const PAGE_LOAD_TIMEOUT = 15000; // 15 seconds timeout

// Start the automated screenshot process when extension loads
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension starting up - initializing screenshot process');
  startAutomatedScreenshots();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed - initializing screenshot process');
  startAutomatedScreenshots();
});

// Function to start the automated screenshot process
function startAutomatedScreenshots() {
  if (isRunning) {
    console.log('Screenshot process already running');
    return;
  }
  
  isRunning = true;
  console.log('Starting automated screenshot process');
  
  // Take first screenshot immediately
  takeScreenshot();
  
  // Set up interval for continuous operation
  intervalId = setInterval(() => {
    takeScreenshot();
  }, SCREENSHOT_INTERVAL);
  
  // Update storage for popup display
  chrome.storage.local.set({
    isRunning: true,
    lastRun: new Date().toISOString(),
    totalScreenshots: 0
  });
}

// Function to stop the automated process
function stopAutomatedScreenshots() {
  if (!isRunning) return;
  
  isRunning = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  
  console.log('Stopped automated screenshot process');
  chrome.storage.local.set({ isRunning: false });
}

// Main screenshot function
async function takeScreenshot() {
  try {
    console.log('Starting screenshot process...');
    
    // Get random URL
    const randomUrl = getRandomUrl();
    console.log(`Selected URL: ${randomUrl}`);
    
    // Create or update tab with the target URL
    const tab = await createOrUpdateTab(randomUrl);
    currentTabId = tab.id;
    
    // Wait for page to load with timeout
    await waitForPageLoad(tab.id);
    
    // Take screenshot
    const screenshotDataUrl = await captureScreenshot(tab.id);
    
    // Save screenshot (show Save As dialog)
    await saveScreenshot(screenshotDataUrl, randomUrl);
    
    // Update statistics
    await updateStats();
    
    console.log('Screenshot process completed successfully');
    
  } catch (error) {
    console.error('Error during screenshot process:', error);
    // Continue running even if one screenshot fails
  }
}

// Get random URL from the list
function getRandomUrl() {
  const randomIndex = Math.floor(Math.random() * TARGET_URLS.length);
  return TARGET_URLS[randomIndex];
}

// Create or update a tab with the target URL
async function createOrUpdateTab(url) {
  try {
    // Try to get the current active tab first
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (activeTab) {
      // Update existing active tab
      await chrome.tabs.update(activeTab.id, { url: url });
      return activeTab;
    } else {
      // Create new tab if no active tab
      return await chrome.tabs.create({ url: url, active: true });
    }
  } catch (error) {
    console.error('Error creating/updating tab:', error);
    // Fallback: create new tab
    return await chrome.tabs.create({ url: url, active: true });
  }
}

// Wait for page to load with timeout
function waitForPageLoad(tabId) {
  return new Promise((resolve, reject) => {
    let timeoutId;
    let loadingListener;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (loadingListener) chrome.tabs.onUpdated.removeListener(loadingListener);
    };
    
    // Set up timeout
    timeoutId = setTimeout(() => {
      cleanup();
      console.log('Page load timeout reached, proceeding with screenshot');
      resolve(); // Resolve instead of reject to continue with screenshot
    }, PAGE_LOAD_TIMEOUT);
    
    // Listen for tab updates
    loadingListener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        console.log('Page loaded successfully');
        resolve();
      }
    };
    
    chrome.tabs.onUpdated.addListener(loadingListener);
    
    // Check if tab is already loaded
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        cleanup();
        resolve();
      }
    }).catch(error => {
      console.error('Error checking tab status:', error);
      cleanup();
      resolve(); // Continue anyway
    });
  });
}

// Capture screenshot of the specified tab
async function captureScreenshot(tabId) {
  try {
    // Make sure tab is active for screenshot
    await chrome.tabs.update(tabId, { active: true });
    
    // Small delay to ensure tab is fully active
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Capture screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 90
    });
    
    console.log('Screenshot captured successfully');
    return dataUrl;
    
  } catch (error) {
    console.error('Error capturing screenshot:', error);
    throw error;
  }
}

// Save screenshot with Save As dialog
async function saveScreenshot(dataUrl, sourceUrl) {
  try {
    // Generate filename based on URL and timestamp
    const urlDomain = new URL(sourceUrl).hostname.replace('www.', '');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `screenshot_${urlDomain}_${timestamp}.png`;
    
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    // Create object URL
    const objectUrl = URL.createObjectURL(blob);
    
    // Trigger download with Save As dialog
    await chrome.downloads.download({
      url: objectUrl,
      filename: filename,
      saveAs: true // This will show the Save As dialog
    });
    
    console.log(`Screenshot saved: ${filename}`);
    
  } catch (error) {
    console.error('Error saving screenshot:', error);
    throw error;
  }
}

// Update statistics
async function updateStats() {
  try {
    const result = await chrome.storage.local.get(['totalScreenshots']);
    const totalScreenshots = (result.totalScreenshots || 0) + 1;
    
    await chrome.storage.local.set({
      totalScreenshots: totalScreenshots,
      lastRun: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Message handling for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'getStatus':
      chrome.storage.local.get(['isRunning', 'lastRun', 'totalScreenshots']).then(result => {
        sendResponse({
          isRunning: isRunning,
          lastRun: result.lastRun,
          totalScreenshots: result.totalScreenshots || 0
        });
      });
      return true; // Indicates we will send a response asynchronously
      
    case 'start':
      startAutomatedScreenshots();
      sendResponse({ success: true });
      break;
      
    case 'stop':
      stopAutomatedScreenshots();
      sendResponse({ success: true });
      break;
      
    case 'takeScreenshotNow':
      takeScreenshot().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error.message });
      });
      return true;
  }
});

// Handle extension lifecycle
chrome.runtime.onSuspend.addListener(() => {
  console.log('Extension suspending - stopping screenshot process');
  stopAutomatedScreenshots();
}