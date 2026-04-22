// Popup.js - Логика интерфейса расширения

let currentBookId = null;
let currentBookTitle = null;

// Элементы DOM
const statusEl = document.getElementById('status');
const bookInfoEl = document.getElementById('bookInfo');
const bookIdEl = document.getElementById('bookId');
const downloadBtn = document.getElementById('downloadBtn');
const refreshBtn = document.getElementById('refreshBtn');
const progressEl = document.getElementById('progress');
const progressFillEl = document.getElementById('progressFill');
const progressTextEl = document.getElementById('progressText');
const errorEl = document.getElementById('error');

// Показать ошибку
function showError(message) {
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
  setTimeout(() => errorEl.classList.add('hidden'), 5000);
}

// Скрыть ошибку
function hideError() {
  errorEl.classList.add('hidden');
}

// Обновить прогресс
function updateProgress(percent, text) {
  progressFillEl.style.width = percent + '%';
  progressTextEl.textContent = text;
}

// Скрыть прогресс
function hideProgress() {
  progressEl.classList.add('hidden');
  progressFillEl.style.width = '0%';
}

// Показать/скрыть состояние загрузки
function setLoading(isLoading) {
  downloadBtn.disabled = isLoading;
  refreshBtn.disabled = isLoading;
}

// Получить книгу из content script
async function getBookInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url || !tab.url.startsWith('https://books.yandex.ru')) {
      showStatus('Откройте страницу книги на books.yandex.ru');
      return null;
    }
    
    // Попытка получить информацию через content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getBookInfo' });
      if (response && response.bookId) {
        return {
          bookId: response.bookId,
          bookTitle: response.bookTitle || null,
          tabId: tab.id
        };
      }
    } catch (e) {
      // Content script может не ответить
      console.log('Content script not responding:', e);
    }
    
    // Фолбэк: извлечь BookId из URL
    const bookId = extractBookIdFromUrl(tab.url);
    if (bookId) {
      return { bookId, bookTitle: null, tabId: tab.id };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting book info:', error);
    return null;
  }
}

// Извлечь BookId из URL
function extractBookIdFromUrl(url) {
  // Форматы URL:
  // https://books.yandex.ru/reader/?bookId=xxx
  // https://books.yandex.ru/books/xxx/...
  // https://books.yandex.ru/reader/xxx
  
  const patterns = [
    /bookId=([^&]+)/,
    /\/books\/([a-zA-Z0-9]+)/,
    /\/reader\/([a-zA-Z0-9]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

// Показать статус
function showStatus(message) {
  statusEl.innerHTML = `<p>${message}</p>`;
  statusEl.classList.remove('hidden');
}

// Скрыть статус
function hideStatus() {
  statusEl.classList.add('hidden');
}

// Показать информацию о книге
function showBookInfo(bookId) {
  bookIdEl.textContent = bookId;
  bookInfoEl.classList.remove('hidden');
  downloadBtn.disabled = false;
}

// Скрыть информацию о книге
function hideBookInfo() {
  bookInfoEl.classList.add('hidden');
  downloadBtn.disabled = true;
}

// Конвертировать base64 в blob
function base64ToBlob(base64, contentType) {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

// Запустить скачивание
async function startDownload() {
  if (!currentBookId) return;
  
  setLoading(true);
  progressEl.classList.remove('hidden');
  hideError();
  
  try {
    updateProgress(10, 'Получение метаданных...');
    
    // Отправить запрос на скачивание в background script
    // Background script сам сохранит файл через chrome.downloads API
    const response = await chrome.runtime.sendMessage({
      action: 'downloadBook',
      bookId: currentBookId,
      bookTitle: currentBookTitle
    });
    
    if (response.success) {
      updateProgress(100, 'Готово!');
      showStatus('Книга скачана успешно!');
    } else {
      throw new Error(response.error || 'Ошибка скачивания');
    }
  } catch (error) {
    showError(`Ошибка: ${error.message}`);
    updateProgress(0, 'Ошибка');
  } finally {
    setLoading(false);
    setTimeout(() => {
      hideProgress();
      hideStatus();
    }, 3000);
  }
}

// Инициализация
async function init() {
  // Получить информацию о книге
  const bookInfo = await getBookInfo();
  
  if (bookInfo) {
    currentBookId = bookInfo.bookId;
    showBookInfo(currentBookId);
    hideStatus();
  } else {
    showStatus('Откройте страницу книги на books.yandex.ru');
    hideBookInfo();
  }
}

// Обработчики событий
downloadBtn.addEventListener('click', startDownload);

refreshBtn.addEventListener('click', async () => {
  hideBookInfo();
  showStatus('Обновление...');
  await init();
});

// Запуск при открытии popup
init();

// Обновление при изменении активной вкладки
chrome.tabs.onActivated.addListener(async () => {
  if (document.hidden) return;
  await init();
});