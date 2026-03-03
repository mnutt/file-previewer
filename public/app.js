'use strict';

const dropzone = document.getElementById('dropzone');
const pickFileButton = document.getElementById('pickFile');
const fileInput = document.getElementById('fileInput');
const statusEl = document.getElementById('status');
const previewFrame = document.getElementById('previewFrame');
let currentPreviewUrl = null;
let latestUploadToken = 0;
let currentAbortController = null;
const supportedExtensions = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#c0392b' : '#556270';
}

async function uploadAndPreview(file) {
  if (!file) return;

  const lower = file.name.toLowerCase();
  if (!supportedExtensions.some((ext) => lower.endsWith(ext))) {
    setStatus(`Please select one of: ${supportedExtensions.join(', ')}.`, true);
    return;
  }

  setStatus('Converting document...');
  const uploadToken = ++latestUploadToken;
  if (currentAbortController) {
    currentAbortController.abort();
  }
  const abortController = new AbortController();
  currentAbortController = abortController;

  try {
    const response = await fetch('/api/preview', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Sandstorm-App-Filename': file.name,
      },
      body: file,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw new Error(message || `Preview failed (HTTP ${response.status}).`);
    }

    const body = await response.arrayBuffer();
    if (uploadToken !== latestUploadToken) return;

    const blob = new Blob([body], { type: 'application/pdf' });
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
    }
    currentPreviewUrl = URL.createObjectURL(blob);
    previewFrame.src = currentPreviewUrl;
    setStatus(`Preview ready: ${file.name}`);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (uploadToken !== latestUploadToken) return;
    setStatus(error?.message || 'Preview failed. Please try again.', true);
  } finally {
    if (currentAbortController === abortController) {
      currentAbortController = null;
    }
  }
}

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add('active');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove('active');
  });
});

dropzone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  uploadAndPreview(file);
});

pickFileButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  uploadAndPreview(file);
  fileInput.value = '';
});
