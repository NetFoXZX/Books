// Popup.js - Логика интерфейса расширения

let currentBookId = null;
let currentBookTitle = null;
let currentComicBookId = null;
let bookType = 'book'; // 'book', 'audio', 'comic'

// Элементы DOM
const statusEl = document.getElementById('status');
const bookInfoEl = document.getElementById('bookInfo');
const bookIdEl = document.getElementById('bookId');
const downloadBtn = document.getElementById('downloadBtn');
const downloadAudioBtn = document.getElementById('downloadAudioBtn');
const downloadComicBtn = document.getElementById('downloadComicBtn');
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

// Элементы авторизации
const authorizeBtnEl = document.getElementById('authorizeBtn');
const checkAuthBtnEl = document.getElementById('checkAuthBtn');
const authStatusEl = document.getElementById('authStatus');
const authStatusIconEl = document.getElementById('authStatusIcon');
const authStatusTextEl = document.getElementById('authStatusText');

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
  if (downloadComicBtn) downloadComicBtn.disabled = isLoading;
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
    let bookType = 'book';
    if (/\/audiobooks\//.test(tab.url)) {
      bookType = 'audio';
    } else if (/\/comicbooks\//.test(tab.url)) {
      bookType = 'comic';
    }
    console.log('Book type:', bookType);
    
    // Попытка получить информацию через content script
    let bookId = null;
    let comicBookId = null;
    let bookTitle = null;
    
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getBookInfo' });
      if (response && response.bookId) {
        bookId = response.bookId;
        bookTitle = response.bookTitle;
        // Если content script вернул bookType, используем его
        if (response.bookType) {
          bookType = response.bookType;
        }
        comicBookId = response.comicBookId;
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
        comicBookId: comicBookId || bookId,
        bookTitle: bookTitle || null, 
        bookType: bookType,
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
function showBookInfo(bookId, bookType = 'book') {
  bookIdEl.textContent = bookId;
  bookInfoEl.classList.remove('hidden');
  
  console.log('showBookInfo called, bookType:', bookType);
  
  // Скрываем все кнопки сначала
  downloadBtn.classList.add('hidden');
  downloadAudioBtn.classList.add('hidden');
  if (downloadComicBtn) downloadComicBtn.classList.add('hidden');
  
  // Показываем кнопки в зависимости от типа
  if (bookType === 'audio') {
    // Для аудиокниг показываем обе кнопки
    downloadBtn.classList.remove('hidden');
    downloadAudioBtn.classList.remove('hidden');
    downloadBtn.disabled = false;
    downloadAudioBtn.disabled = false;
  } else if (bookType === 'comic') {
    // Для комиксов показываем кнопку скачивания комикса
    if (downloadComicBtn) {
      downloadComicBtn.classList.remove('hidden');
      downloadComicBtn.disabled = false;
    }
  } else {
    // Для обычных книг только EPUB
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

// Запустить скачивание комикса
async function startComicDownload() {
  if (!currentComicBookId) return;
  
  setLoading(true);
  progressEl.classList.remove('hidden');
  hideError();
  
  try {
    updateProgress(10, 'Получение метаданных комикса...');
    
    const response = await chrome.runtime.sendMessage({
      action: 'downloadComic',
      comicBookId: currentComicBookId,
      comicTitle: currentBookTitle
    });
    
    if (response.success) {
      updateProgress(100, 'Готово!');
      showStatus(`Комикс готовится...`);
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
    currentComicBookId = bookInfo.comicBookId;
    currentBookTitle = bookInfo.bookTitle;
    
    // Используем bookType из content script
    const bookTypeValue = bookInfo.bookType;
    
    console.log('Showing book info, bookType:', bookTypeValue);
    showBookInfo(currentBookId, bookTypeValue);
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
if (downloadComicBtn) {
  downloadComicBtn.addEventListener('click', startComicDownload);
}

refreshBtn.addEventListener('click', async () => {
  hideBookInfo();
  hideZipNotification();
  showStatus('Обновление...');
  await init();
});

clearStorageBtn.addEventListener('click', clearStorage);

// ==================== Авторизация через Cookie ====================

// Проверить статус авторизации и получить auth-token из cookies
async function checkAuthStatus() {
  try {
    log('[Авторизация] Начало проверки auth-token...');
    
    // Пробуем получить auth-token из разных доменов Яндекса
    log('[Авторизация] Поиск auth-token в cookies...');
    const authTokens = await Promise.all([
      chrome.cookies.get({ url: 'https://oauth.yandex.ru', name: 'auth-token' }),
      chrome.cookies.get({ url: 'https://id.yandex.ru', name: 'auth-token' }),
      chrome.cookies.get({ url: 'https://books.yandex.ru', name: 'auth-token' }),
      chrome.cookies.get({ url: 'https://yandex.ru', name: 'auth-token' })
    ]);
    
    // Находим первый не-null токен
    const authToken = authTokens.find(token => token && token.value);
    
    if (authToken && authToken.value) {
      log(`[Авторизация] auth-token найден в cookies (${authToken.url})`);
      // Сохраняем токен в storage
      await chrome.storage.local.set({ authToken: authToken.value });
      log('[Авторизация] Токен сохранён в storage');
      updateAuthUI(true);
      return;
    }
    
    // Token не найден в cookies - пробуем из storage
    log('[Авторизация] auth-token не найден в cookies, проверка storage...');
    const { authToken: storedToken } = await chrome.storage.local.get('authToken');
    if (storedToken) {
      log('[Авторизация] auth-token найден в storage');
      updateAuthUI(true);
    } else {
      log('[Авторизация] auth-token не найден. Требуется авторизация.');
      updateAuthUI(false);
    }
  } catch (error) {
    log(`[Авторизация] Ошибка проверки авторизации: ${error.message}`);
    updateAuthUI(false);
  }
}

// Обновить UI авторизации
function updateAuthUI(isAuthenticated) {
  if (!authStatusIconEl || !authStatusTextEl || !authorizeBtnEl) return;
  
  if (isAuthenticated) {
    authStatusIconEl.textContent = '🔓';
    authStatusTextEl.textContent = 'Авторизован';
    authorizeBtnEl.classList.add('authenticated');
    authorizeBtnEl.style.display = 'none'; // Скрываем кнопку если авторизован
    if (checkAuthBtnEl) checkAuthBtnEl.style.display = 'none';
  } else {
    authStatusIconEl.textContent = '🔒';
    authStatusTextEl.textContent = 'Не авторизован';
    authorizeBtnEl.classList.remove('authenticated');
    authorizeBtnEl.style.display = 'inline-block';
    if (checkAuthBtnEl) checkAuthBtnEl.style.display = 'inline-block';
  }
}

// Проверить авторизацию с подробным выводом
async function forceCheckAuth() {
  log('[Проверка] Принудительная проверка авторизации...');
  
  try {
    // Показываем статус
    authStatusTextEl.textContent = 'Проверка...';
    
    // Проверяем cookies
    log('[Проверка] Проверка cookies...');
    const cookiesToCheck = [
      'https://oauth.yandex.ru',
      'https://id.yandex.ru',
      'https://books.yandex.ru',
      'https://yandex.ru'
    ];
    
    let foundToken = null;
    let foundInStorage = false;
    
    for (const url of cookiesToCheck) {
      try {
        const cookie = await chrome.cookies.get({ url, name: 'auth-token' });
        if (cookie && cookie.value) {
          foundToken = cookie.value;
          log(`[Проверка] ✓ auth-token найден в ${url}`);
          log(`[Проверка] Token (первые 20 символов): ${cookie.value.substring(0, 20)}...`);
          break;
        } else {
          log(`[Проверка] ✗ auth-token не найден в ${url}`);
        }
      } catch (e) {
        log(`[Проверка] Ошибка проверки ${url}: ${e.message}`);
      }
    }
    
    // Проверяем storage
    const { authToken: storedToken } = await chrome.storage.local.get('authToken');
    if (storedToken) {
      foundInStorage = true;
      log(`[Проверка] ✓ auth-token найден в storage (длина: ${storedToken.length})`);
    } else {
      log(`[Проверка] ✗ auth-token не найден в storage`);
    }
    
    // Итоговый результат
    if (foundToken || foundInStorage) {
      const token = foundToken || storedToken;
      await chrome.storage.local.set({ authToken: token });
      log('[Проверка] ✓ Авторизация успешна!');
      updateAuthUI(true);
      showStatus('✓ Авторизован! Можно скачивать комиксы.');
    } else {
      log('[Проверка] ✗ Авторизация не найдена. Нажмите "Войти в Яндекс Книги".');
      updateAuthUI(false);
      showStatus('Не авторизован. Нажмите "Войти в Яндекс Книги" и войдите в аккаунт.');
    }
  } catch (error) {
    log(`[Проверка] Ошибка: ${error.message}`);
    authStatusTextEl.textContent = 'Ошибка проверки';
    showError(`Ошибка проверки: ${error.message}`);
  }
}

// Открыть OAuth страницу для авторизации
async function openYandexBooks() {
  // URL без redirect_uri - Яндекс использует дефолтный веб-redirect
  const oauthUrl = 'https://oauth.yandex.ru/authorize?response_type=token&client_id=4483e97bab6e486a9822973109a14d05';
  
  log('[OAuth] Отправка запроса в background...');
  
  // Показываем статус
  authStatusTextEl.textContent = 'Авторизация...';
  
  // Отправляем сообщение в background.js
  chrome.runtime.sendMessage({
    action: 'startOAuth',
    oauthUrl: oauthUrl
  }, (response) => {
    if (response && response.success) {
      log('[OAuth] Запрос отправлен в background');
    } else {
      log('[OAuth] Ошибка отправки запроса');
      showError('Ошибка запуска авторизации');
      authStatusTextEl.textContent = 'Не авторизован';
    }
  });
}

// Обработчик кнопки авторизации
if (authorizeBtnEl) {
  authorizeBtnEl.addEventListener('click', openYandexBooks);
}

// Обработчик кнопки проверки авторизации
if (checkAuthBtnEl) {
  checkAuthBtnEl.addEventListener('click', forceCheckAuth);
}

// Запуск при открытии popup
init();
checkAuthStatus();

// Обновление при изменении активной вкладки
chrome.tabs.onActivated.addListener(async () => {
  if (document.hidden) return;
  await init();
  checkAuthStatus();
});

// Проверять auth-token каждые 2 минуты
setInterval(checkAuthStatus, 120000);
