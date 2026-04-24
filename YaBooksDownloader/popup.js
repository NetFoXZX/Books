// Popup.js - Логика интерфейса расширения

let currentBookId = null;
let currentBookTitle = null;
let isAudioBook = false;

// Элементы DOM
const statusEl = document.getElementById('status');
const bookInfoEl = document.getElementById('bookInfo');
const bookIdEl = document.getElementById('bookId');
const downloadBtn = document.getElementById('downloadBtn');
const downloadAudioBtn = document.getElementById('downloadAudioBtn');
const refreshBtn = document.getElementById('refreshBtn');
const progressEl = document.getElementById('progress');
const progressFillEl = document.getElementById('progressFill');
const progressTextEl = document.getElementById('progressText');
const errorEl = document.getElementById('error');

// Элемент для уведомления о готовом ZIP
const zipNotificationEl = document.getElementById('zipNotification');
const zipDownloadBtn = document.getElementById('zipDownloadBtn');
const zipInfoEl = document.getElementById('zipInfo');
const clearStorageBtn = document.getElementById('clearStorageBtn');

// Открыть IndexedDB в popup
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('AudioBookDownloader', 1);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('archives')) {
        db.createObjectStore('archives', { keyPath: 'id' });
      }
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Получить все записи из IndexedDB
async function getAllFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('archives', 'readonly');
    const store = tx.objectStore('archives');
    const request = store.getAll();
    
    request.onsuccess = () => {
      resolve(request.result || []);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Получить одну запись из IndexedDB
async function getFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('archives', 'readonly');
    const store = tx.objectStore('archives');
    const request = store.get(id);
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  });
}

// Удалить запись из IndexedDB
async function deleteFromDB(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('archives', 'readwrite');
    const store = tx.objectStore('archives');
    store.delete(id);
    
    tx.oncomplete = () => {
      log(`Запись удалена из IndexedDB: ${id}`);
      resolve();
    };
    
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

// Проверить наличие готовых ZIP архивов
async function checkForReadyArchives() {
  try {
    const records = await getAllFromDB();
    
    if (records && records.length > 0) {
      log(`Найдено ${records.length} готовых архивов`);
      showZipNotification(records);
    } else {
      log('Готовых архивов нет');
      hideZipNotification();
    }
  } catch (error) {
    log(`Ошибка проверки архивов: ${error.message}`);
  }
}

// Показать уведомление о готовом ZIP
function showZipNotification(records) {
  if (!zipNotificationEl || !zipInfoEl) return;
  
  const count = records.length;
  const totalSize = records.reduce((sum, r) => sum + (r.data?.size || 0), 0);
  const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
  
  // Проверяем, это части одного архива или разные архивы
  const isParts = records.some(r => r.id.includes('_part'));
  
  if (isParts) {
    // Сортируем части по номеру
    records.sort((a, b) => {
      const matchA = a.id.match(/_part(\d+)$/);
      const matchB = b.id.match(/_part(\d+)$/);
      const numA = matchA ? parseInt(matchA[1]) : 0;
      const numB = matchB ? parseInt(matchB[1]) : 0;
      return numA - numB;
    });
    
    zipInfoEl.innerHTML = `
      <p><strong>Готов архив из ${count} частей</strong></p>
      <p>Размер: ~${sizeMB} MB (общий)</p>
      <p style="font-size: 11px; color: #666;">Нажмите кнопку ниже чтобы скачать все части</p>
    `;
  } else {
    zipInfoEl.innerHTML = `
      <p><strong>Готов ${count} архив${count === 1 ? '' : 'а'}</strong></p>
      <p>Размер: ~${sizeMB} MB</p>
      <p style="font-size: 11px; color: #666;">Нажмите кнопку ниже чтобы скачать</p>
    `;
  }
  
  zipNotificationEl.classList.remove('hidden');
  
  // Привязываем обработчик к кнопке
  if (zipDownloadBtn) {
    zipDownloadBtn.onclick = () => downloadAllZips(records);
  }
}

// Скрыть уведомление о ZIP
function hideZipNotification() {
  if (zipNotificationEl) {
    zipNotificationEl.classList.add('hidden');
  }
}

// Скачать все архивы (или все части одного архива)
async function downloadAllZips(records) {
  if (!records || records.length === 0) return;
  
  // Проверяем, это части одного архива или разные архивы
  const isParts = records.some(r => r.id.includes('_part'));
  
  try {
    if (isParts) {
      // Сортируем части по номеру
      records.sort((a, b) => {
        const matchA = a.id.match(/_part(\d+)$/);
        const matchB = b.id.match(/_part(\d+)$/);
        const numA = matchA ? parseInt(matchA[1]) : 0;
        const numB = matchB ? parseInt(matchB[1]) : 0;
        return numA - numB;
      });
      
      log(`Скачивание ${records.length} частей архива...`);
      
      // Скачиваем каждую часть
      for (const record of records) {
        await downloadSingleZip(record);
      }
      
      showStatus(`Все ${records.length} частей архива успешно сохранены!`);
    } else {
      // Скачиваем только последний (самый свежий) архив
      const record = records[records.length - 1];
      await downloadSingleZip(record);
      showStatus('Аудиокнига успешно сохранена!');
    }
    
    // Очищаем бейдж на иконке
    chrome.runtime.sendMessage({ action: 'clearBadge' });
    
  } catch (error) {
    log(`Ошибка скачивания: ${error.message}`);
    showError(`Ошибка скачивания: ${error.message}`);
  }
}

// Скачать один ZIP архив
async function downloadSingleZip(record) {
  try {
    log(`Начинаю скачивание архива: ${record.id}`);
    
    if (!record.data) {
      throw new Error('Данные архива не найдены');
    }
    
    const blob = record.data;
    log(`Type: ${typeof blob}, Constructor: ${blob?.constructor?.name}`);
    log(`Размер Blob: ${blob?.size} байт`);
    
    if (!blob || blob.size === 0) {
      throw new Error('Blob пустой или некорректный!');
    }
    
    // Проверяем что это действительно Blob
    if (!(blob instanceof Blob)) {
      throw new Error(`Некорректный тип данных: ${typeof blob}, expected Blob`);
    }
    
    // Создаём Blob URL
    log('Создание Blob URL...');
    const blobUrl = URL.createObjectURL(blob);
    
    // Генерируем имя файла из ID
    // Если это часть архива, используем имя части, иначе генерируем новое
    let fileName;
    if (record.id.includes('_part')) {
      // Извлекаем base ID и номер части
      const match = record.id.match(/^(.+)_part(\d+)$/);
      if (match) {
        const partNum = match[2];
        fileName = `audiobook_part${partNum}.zip`;
      } else {
        fileName = `audiobook_${Date.now()}.zip`;
      }
    } else {
      fileName = `audiobook_${Date.now()}.zip`;
    }
    
    log('Сохранение ZIP архива...');
    
    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        {
          url: blobUrl,
          filename: fileName,
          saveAs: true
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (downloadId) {
            resolve({ downloadId });
          } else {
            reject(new Error('Не удалось начать загрузку'));
          }
        }
      );
    });
    
    log(`Архив сохранён: ${fileName}`);
    
    // Очищаем IndexedDB
    await deleteFromDB(record.id);
    
    // Освобождаем Blob URL
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    log(`Ошибка при скачивании ${record.id}: ${error.message}`);
    throw error;
  }
}

function log(message) {
  console.log('[Popup]', message);
}

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
  downloadAudioBtn.disabled = isLoading;
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
    
    console.log('Current tab URL:', tab.url);
    
    // Определяем тип книги по URL напрямую
    const isAudio = /\/audiobooks\//.test(tab.url);
    console.log('Is audio book:', isAudio);
    
    // Попытка получить информацию через content script
    let bookId = null;
    let bookTitle = null;
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getBookInfo' });
      if (response && response.bookId) {
        bookId = response.bookId;
        bookTitle = response.bookTitle;
      }
    } catch (e) {
      // Content script может не ответить
      console.log('Content script not responding:', e);
    }
    
    // Фолбэк: извлечь BookId из URL
    if (!bookId) {
      bookId = extractBookIdFromUrl(tab.url);
    }
    
    if (bookId) {
      return { 
        bookId, 
        bookTitle: bookTitle || null, 
        bookType: isAudio ? 'audio' : 'book',
        tabId: tab.id 
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error getting book info:', error);
    return null;
  }
}

// Извлечь BookId из URL
function extractBookIdFromUrl(url) {
  const patterns = [
    /bookId=([^&]+)/,
    /\/audiobooks\/([a-zA-Z0-9]+)/,
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
function showBookInfo(bookId, isAudio = false) {
  bookIdEl.textContent = bookId;
  bookInfoEl.classList.remove('hidden');
  isAudioBook = isAudio;
  
  console.log('showBookInfo called, isAudio:', isAudio);
  
  // Всегда показываем обе кнопки, если это аудиокнига - показываем приоритетно MP3
  if (isAudio) {
    // Для аудиокниг показываем обе кнопки
    downloadBtn.classList.remove('hidden');
    downloadAudioBtn.classList.remove('hidden');
    downloadBtn.disabled = false;
    downloadAudioBtn.disabled = false;
  } else {
    // Для обычных книг только EPUB
    downloadAudioBtn.classList.add('hidden');
    downloadBtn.classList.remove('hidden');
    downloadBtn.disabled = false;
  }
}

// Скрыть информацию о книге
function hideBookInfo() {
  bookInfoEl.classList.add('hidden');
  downloadBtn.disabled = true;
  downloadAudioBtn.disabled = true;
  downloadAudioBtn.classList.add('hidden');
  downloadBtn.classList.add('hidden');
}

// Запустить скачивание EPUB
async function startDownload() {
  if (!currentBookId) return;
  
  setLoading(true);
  progressEl.classList.remove('hidden');
  hideError();
  
  try {
    updateProgress(10, 'Получение метаданных...');
    
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

// Запустить скачивание аудиокниги
async function startAudioDownload() {
  if (!currentBookId) return;
  
  setLoading(true);
  progressEl.classList.remove('hidden');
  hideError();
  
  try {
    updateProgress(10, 'Получение метаданных...');
    
    const response = await chrome.runtime.sendMessage({
      action: 'downloadAudio',
      bookId: currentBookId,
      bookTitle: currentBookTitle
    });
    
    if (response.success) {
      updateProgress(100, 'Готово!');
      showStatus(`Аудиокнига готовится...`);
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
  
  console.log('Book info:', bookInfo);
  
  if (bookInfo) {
    currentBookId = bookInfo.bookId;
    currentBookTitle = bookInfo.bookTitle;
    
    // Используем bookType из content script
    const isAudio = bookInfo.bookType === 'audio';
    
    console.log('Showing book info, isAudio:', isAudio);
    showBookInfo(currentBookId, isAudio);
    hideStatus();
  } else {
    showStatus('Откройте страницу книги на books.yandex.ru');
    hideBookInfo();
  }
  
  // Проверить наличие готовых ZIP архивов
  await checkForReadyArchives();
}

// Очистить хранилище
async function clearStorage() {
  try {
    log('Очистка хранилища...');
    
    // Получаем все записи
    const records = await getAllFromDB();
    
    if (records && records.length > 0) {
      // Удаляем каждую запись
      for (const record of records) {
        await deleteFromDB(record.id);
        log(`Удалён архив: ${record.id}`);
      }
    }
    
    // Скрываем уведомление
    hideZipNotification();
    
    // Очищаем бейдж
    chrome.runtime.sendMessage({ action: 'clearBadge' });
    
    showStatus('Хранилище очищено!');
    log('Хранилище очищено');
  } catch (error) {
    log(`Ошибка очистки: ${error.message}`);
    showError(`Ошибка очистки: ${error.message}`);
  }
}

// Обработчики событий
downloadBtn.addEventListener('click', startDownload);
downloadAudioBtn.addEventListener('click', startAudioDownload);

refreshBtn.addEventListener('click', async () => {
  hideBookInfo();
  hideZipNotification();
  showStatus('Обновление...');
  await init();
});

clearStorageBtn.addEventListener('click', clearStorage);

// Запуск при открытии popup
init();

// Обновление при изменении активной вкладки
chrome.tabs.onActivated.addListener(async () => {
  if (document.hidden) return;
  await init();
});