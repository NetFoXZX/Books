// Popup.js - Логика интерфейса расширения
// Version: 1.0.2

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

// Элементы чекбокса проверки формата
const validateFormatCheckboxEl = document.getElementById('validateFormatCheckbox');
const validateFormatContainerEl = document.getElementById('validateFormatContainer');

// Константа для хранения состояния чекбокса
const VALIDATE_FORMAT_STORAGE_KEY = 'validateFormatEnabled';

// Получить сохранённое состояние чекбокса (по умолчанию true)
async function getValidateFormatState() {
  try {
    const { validateFormatEnabled } = await browser.storage.local.get('validateFormatEnabled');
    return validateFormatEnabled !== false; // По умолчанию true
  } catch (error) {
    console.log('[Popup] Ошибка получения состояния чекбокса:', error);
    return true; // Фолбэк на true
  }
}

// Сохранить состояние чекбокса
async function setValidateFormatState(enabled) {
  try {
    await browser.storage.local.set({ validateFormatEnabled: enabled });
  } catch (error) {
    console.log('[Popup] Ошибка сохранения состояния чекбокса:', error);
  }
}

// Инициализировать localForage в popup
const archives = localforage.createInstance({
  name: 'YandexBooksDownloader',
  storeName: 'archives',
  description: 'Archives storage'
});

// Получить все записи из localForage
async function getAllFromDB() {
  try {
    const records = [];
    await archives.iterate((value, key) => {
      records.push(value);
    });
    return records;
  } catch (error) {
    log(`Ошибка получения всех записей: ${error.message}`);
    return [];
  }
}

// Удалить запись из localForage
async function deleteFromDB(id) {
  try {
    await archives.removeItem(id);
    log(`Запись удалена из localForage: ${id}`);
  } catch (error) {
    log(`Ошибка удаления: ${error.message}`);
  }
}

// Очистить все записи из localForage
async function clearAllFromDB() {
  try {
    await archives.clear();
    log('Все записи очищены из localForage');
  } catch (error) {
    log(`Ошибка очистки: ${error.message}`);
  }
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
  // Вычисляем размер с учётом всех форматов: base64, blob, data
  const totalSize = records.reduce((sum, r) => {
    // Новый base64 формат
    if (r.isBase64 && r.base64) {
      // base64 размер примерно на 33% больше оригинала, поэтому делим на 1.33
      return sum + Math.round(r.base64.length * 0.75);
    }
    // Формат с blob на верхнем уровне
    if (r.blob) {
      return sum + (r.blob.size || 0);
    }
    // Вложенный формат { data: { blob, fileName } }
    if (r.data?.blob) {
      return sum + r.data.blob.size;
    }
    return sum + (r.data?.size || 0);
  }, 0);
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
    browser.runtime.sendMessage({ action: 'clearBadge' });
    
  } catch (error) {
    log(`Ошибка скачивания: ${error.message}`);
    showError(`Ошибка скачивания: ${error.message}`);
  }
}

// Скачать один ZIP архив
async function downloadSingleZip(record) {
  try {
    log(`Начинаю скачивание архива: ${record.id}`);
    log(`Полная запись:`, record);
    log(`record.blob тип: ${typeof record.blob}, constructor: ${record.blob?.constructor?.name}`);
    log(`record.fileName: ${record.fileName}`);
    
    let blob;
    let fileNameFromRecord = null;
    let mimeType = 'application/octet-stream';
    
    // Проверяем, это base64 формат (новый) или Blob формат
    if (record.isBase64 && record.base64) {
      // Новый формат: base64 данные
      log(`Используем base64 формат данных`);
      fileNameFromRecord = record.fileName;
      mimeType = record.mimeType || 'application/octet-stream';
      
      // Конвертируем base64 в Blob
      log(`Конвертация base64 в Blob... размер base64: ${record.base64.length}`);
      const binaryString = atob(record.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mimeType });
      log(`Blob создан: размер=${blob.size} байт, MIME: ${blob.type}`);
    } else if (record.blob) {
      // Формат с Blob на верхнем уровне
      blob = record.blob;
      fileNameFromRecord = record.fileName;
      log(`record.blob: ${blob}`);
      log(`record.blob.size: ${blob?.size}`);
      log(`record.blob.type: ${blob?.type}`);
      log(`Используем Blob формат данных (record.blob): blob=${blob?.size} байт, fileName=${fileNameFromRecord}`);
      mimeType = record.mimeType || blob.type || 'application/octet-stream';
    } else if (record.data?.blob) {
      // Старый вложенный формат: { data: { blob, fileName } }
      blob = record.data.blob;
      fileNameFromRecord = record.data.fileName;
      log(`Используем вложенный формат данных (record.data.blob): blob=${blob?.size} байт, fileName=${fileNameFromRecord}`);
      mimeType = record.data.mimeType || blob.type || 'application/octet-stream';
    } else if (record.data instanceof Blob) {
      // Старый формат: прямой Blob
      blob = record.data;
      log(`Используем старый формат данных (прямой Blob): ${blob?.size} байт`);
      mimeType = record.mimeType || blob.type || 'application/octet-stream';
    } else {
      log(`ОШИБКА: Запись не содержит данных! Доступные поля: ${Object.keys(record).join(', ')}`);
      throw new Error(`Данные архива не найдены. Доступные поля: ${Object.keys(record).join(', ')}`);
    }
    
    log(`Type: ${typeof blob}, Constructor: ${blob?.constructor?.name}`);
    log(`Размер Blob: ${blob?.size} байт`);
    log(`MIME Type: ${mimeType}`);
    
    if (!blob || blob.size === 0) {
      throw new Error(`Blob пустой или некорректный! Размер: ${blob?.size}`);
    }
    
    // Создаём Blob URL
    log('Создание Blob URL...');
    const blobUrl = URL.createObjectURL(blob);
    
    // Получаем имя файла из сохранённых данных или генерируем из ID
    let fileName;
    if (fileNameFromRecord) {
      // Используем имя файла из объекта { blob, fileName }
      fileName = fileNameFromRecord;
      log(`Используем имя файла из данных: ${fileName}`);
    } else if (record.fileName) {
      // Фолбэк: сохранённое имя файла в записи (старый формат)
      fileName = record.fileName;
      log(`Используем сохранённое имя файла из записи: ${fileName}`);
    } else {
      // Фолбэк: генерируем имя из ID
      if (record.id.includes('_part')) {
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
    }
    
    log('Сохранение ZIP архива...');
    log(`blobUrl: ${blobUrl.substring(0, 100)}...`);
    log(`fileName: ${fileName}`);
    
    // Используем метод через <a> элемент вместо browser.downloads.download()
    // Это работает напрямую из popup без необходимости downloads API callback
    log('Создание <a> элемента для скачивания...');
    
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    a.style.display = 'none';
    
    // Добавляем элемент в DOM
    document.body.appendChild(a);
    
    // Программно кликаем по ссылке
    log('Программный клик по ссылке для запуска скачивания...');
    a.click();
    
    // Удаляем элемент из DOM
    document.body.removeChild(a);
    
    log(`Скачивание запущено: ${fileName}`);
    
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
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
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
      const response = await browser.tabs.sendMessage(tab.id, { action: 'getBookInfo' });
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
async function showBookInfo(bookId, bookType = 'book') {
  bookIdEl.textContent = bookId;
  bookInfoEl.classList.remove('hidden');
  
  console.log('showBookInfo called, bookType:', bookType);
  
  // Скрываем все кнопки сначала
  downloadBtn.classList.add('hidden');
  downloadAudioBtn.classList.add('hidden');
  if (downloadComicBtn) downloadComicBtn.classList.add('hidden');
  
  // Управление чекбоксом проверки формата
  if (validateFormatContainerEl && validateFormatCheckboxEl) {
    if (bookType === 'audio' || bookType === 'comic') {
      // Скрываем чекбокс для аудиокниг и комиксов
      validateFormatContainerEl.classList.add('hidden');
    } else {
      // Показываем чекбокс для обычных книг
      validateFormatContainerEl.classList.remove('hidden');
      // Восстанавливаем сохранённое состояние
      const savedState = await getValidateFormatState();
      validateFormatCheckboxEl.checked = savedState;
    }
  }
  
  // Показываем кнопки в зависимости от типа
  if (bookType === 'audio') {
    // Для аудиокниг проверяем, есть ли текст (EPUB) кроме аудио
    // Пока показываем обе кнопки (EPUB может содержать текст + аудио)
    // Если нужно скрывать EPUB если только аудио - нужно проверять метаданные
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
  
  // Получаем состояние чекбокса
  const validateFormat = validateFormatCheckboxEl ? validateFormatCheckboxEl.checked : true;
  
  setLoading(true);
  progressEl.classList.remove('hidden');
  hideError();
  
  try {
    updateProgress(10, 'Получение метаданных...');
    
    const response = await browser.runtime.sendMessage({
      action: 'downloadBook',
      bookId: currentBookId,
      bookTitle: currentBookTitle,
      validateFormat: validateFormat
    });
    
    if (response.success) {
      updateProgress(100, 'Готово!');
      showStatus('Книга сохранена! Нажмите "Обновить" чтобы скачать файл.');
      // Проверить наличие готовых архивов
      await checkForReadyArchives();
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
    }, 5000);
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
    
    const response = await browser.runtime.sendMessage({
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
    
    const response = await browser.runtime.sendMessage({
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
    browser.runtime.sendMessage({ action: 'clearBadge' });
    
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
      browser.cookies.get({ url: 'https://oauth.yandex.ru', name: 'auth-token' }),
      browser.cookies.get({ url: 'https://id.yandex.ru', name: 'auth-token' }),
      browser.cookies.get({ url: 'https://books.yandex.ru', name: 'auth-token' }),
      browser.cookies.get({ url: 'https://yandex.ru', name: 'auth-token' })
    ]);
    
    // Находим первый не-null токен
    const authToken = authTokens.find(token => token && token.value);
    
    if (authToken && authToken.value) {
      log(`[Авторизация] auth-token найден в cookies (${authToken.url})`);
      // Сохраняем токен в storage
      await browser.storage.local.set({ authToken: authToken.value });
      log('[Авторизация] Токен сохранён в storage');
      updateAuthUI(true);
      return;
    }
    
    // Token не найден в cookies - пробуем из storage
    log('[Авторизация] auth-token не найден в cookies, проверка storage...');
    const { authToken: storedToken } = await browser.storage.local.get('authToken');
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
        const cookie = await browser.cookies.get({ url, name: 'auth-token' });
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
    const { authToken: storedToken } = await browser.storage.local.get('authToken');
    if (storedToken) {
      foundInStorage = true;
      log(`[Проверка] ✓ auth-token найден в storage (длина: ${storedToken.length})`);
    } else {
      log(`[Проверка] ✗ auth-token не найден в storage`);
    }
    
    // Итоговый результат
    if (foundToken || foundInStorage) {
      const token = foundToken || storedToken;
      await browser.storage.local.set({ authToken: token });
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
  browser.runtime.sendMessage({
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

// Обработчик изменения состояния чекбокса
if (validateFormatCheckboxEl) {
  validateFormatCheckboxEl.addEventListener('change', (e) => {
    setValidateFormatState(e.target.checked);
    console.log('[Popup] Состояние чекбокса:', e.target.checked);
  });
}

// Обновление при изменении активной вкладки
browser.tabs.onActivated.addListener(async () => {
  if (document.hidden) return;
  await init();
  checkAuthStatus();
});

// Проверять auth-token каждые 2 минуты
setInterval(checkAuthStatus, 120000);

// Слушать сообщения от background о завершении скачивания
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadComplete') {
    // Проверить наличие готовых архивов
    checkForReadyArchives();
  }
  return true;
});
