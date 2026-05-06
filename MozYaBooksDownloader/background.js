// Background.js - Фоновый сервис

// ==================== OAuth Authorization ====================

// Отслеживаем OAuth вкладку
let oauthTabId = null;

// Обработчик навигации для OAuth
const handleOAuthNavigation = async (details) => {
  if (details.tabId !== oauthTabId) return;
  
  log(`[OAuth] Навигация: ${details.url}`);
  
  // Проверяем наличие access_token в hash fragment
  if (details.url.includes('#')) {
    const hash = details.url.split('#')[1];
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get('access_token');
    const error = hashParams.get('error');
    
    if (error) {
      const errorDesc = hashParams.get('error_description') || 'Неизвестная ошибка';
      log(`[OAuth] Ошибка: ${error} - ${errorDesc}`);
      
      // Закрываем OAuth вкладку
      if (oauthTabId) {
        try {
          await browser.tabs.remove(oauthTabId);
        } catch (e) {}
        oauthTabId = null;
      }
      
      browser.webNavigation.onCommitted.removeListener(handleOAuthNavigation);
      return;
    }
    
    if (accessToken) {
      log(`[OAuth] ✓ access_token получен! (длина: ${accessToken.length})`);
      
      // Сохраняем token в storage
      await browser.storage.local.set({ authToken: accessToken });
      log('[OAuth] Token сохранён в storage');
      
      // Закрываем OAuth вкладку
      if (oauthTabId) {
        try {
          await browser.tabs.remove(oauthTabId);
        } catch (e) {}
        oauthTabId = null;
      }
      
      browser.webNavigation.onCommitted.removeListener(handleOAuthNavigation);
      
      // Устанавливаем бейдж
      browser.browserAction.setBadgeText({ text: '✓' });
      browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
      
      setTimeout(() => {
        browser.browserAction.setBadgeText({ text: '' });
      }, 3000);
    }
  }
};

// Обработчик сообщений для OAuth
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startOAuth') {
    startOAuth(message.oauthUrl);
    sendResponse({ success: true });
    return true;
  }
});

// Запустить OAuth flow
async function startOAuth(oauthUrl) {
  log('[OAuth] Запуск OAuth flow...');
  log(`[OAuth] URL: ${oauthUrl}`);
  
  // Открываем OAuth вкладку
  const tab = await browser.tabs.create({ url: oauthUrl, active: true });
  oauthTabId = tab.id;
  log(`[OAuth] Вкладка создана: ${oauthTabId}`);
  
  // Устанавливаем слушатель навигации (onCommitted срабатывает на все навигации включая первоначальную загрузку)
  browser.webNavigation.onCommitted.addListener(handleOAuthNavigation);
  
  // Polling как резервный механизм
  const pollInterval = setInterval(async () => {
    try {
      if (!oauthTabId) {
        clearInterval(pollInterval);
        return;
      }
      
      const currentTab = await browser.tabs.get(oauthTabId);
      if (currentTab.url && currentTab.url.includes('#')) {
        const hash = currentTab.url.split('#')[1];
        const hashParams = new URLSearchParams(hash);
        const accessToken = hashParams.get('access_token');
        const error = hashParams.get('error');
        
        if (error || accessToken) {
          clearInterval(pollInterval);
          // Обработчик навигации уже обработает это
        }
      }
    } catch (e) {
      // Вкладка могла быть закрыта
      clearInterval(pollInterval);
    }
  }, 500);
  
  // Тайм-аут через 3 минуты
  setTimeout(async () => {
    if (oauthTabId) {
      try {
        await browser.tabs.remove(oauthTabId);
      } catch (e) {}
      oauthTabId = null;
    }
    clearInterval(pollInterval);
    log('[OAuth] Тайм-аут авторизации');
  }, 180000);
}

// API домен
const BOOKS_DOMAIN = 'books.yandex.ru';

// Варианты app-user-agent для комиксов (как в Python скрипте)
const COMIC_USER_AGENTS = [
  'Samsung/Galaxy_A51 Android/12 Bookmate/3.7.3',
  'Huawei/P40_Lite Android/11 Bookmate/3.7.3',
  'OnePlus/Nord_N10 Android/10 Bookmate/3.7.3'
];

// Получить случайный app-user-agent
function getRandomComicUA() {
  return COMIC_USER_AGENTS[Math.floor(Math.random() * COMIC_USER_AGENTS.length)];
}

// Переменная для хранения интервала анимации
let animationInterval = null;
let isAnimating = false;

// Логирование
function log(message) {
  console.log('[Background]', message);
}

// ============== localForage Helpers ==============

// Инициализировать localForage
const archives = localforage.createInstance({
  name: 'YandexBooksDownloader',
  storeName: 'archives',
  description: 'Archives storage'
});

// Сохранить данные в localForage
async function saveToDB(id, data) {
  try {
    const size = data.byteLength !== undefined ? data.byteLength : (data.size || 0);
    const type = data.constructor.name;
    log(`Сохранение в localForage: id=${id}, type=${type}, size=${size}`);
    
    const record = { 
      id, 
      blob: data.blob || data,
      fileName: data.fileName || `file_${id}`
    };
    
    await archives.setItem(id, record);
    log(`Данные сохранены в localForage: ${id}, размер: ${size} байт`);
  } catch (error) {
    log(`Ошибка сохранения в localForage: ${error.message}`);
    throw error;
  }
}

// Получить данные из localForage
async function getFromDB(id) {
  try {
    return await archives.getItem(id);
  } catch (error) {
    log(`Ошибка получения из localForage: ${error.message}`);
    return null;
  }
}

// Удалить данные из localForage
async function deleteFromDB(id) {
  try {
    await archives.removeItem(id);
    log(`Данные удалены из localForage: ${id}`);
  } catch (error) {
    log(`Ошибка удаления из localForage: ${error.message}`);
  }
}

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

// Получить количество записей
async function getArchiveCount() {
  try {
    return await archives.length();
  } catch (error) {
    log(`Ошибка получения количества: ${error.message}`);
    return 0;
  }
}

// Очистить все записи
async function clearAllFromDB() {
  try {
    await archives.clear();
    log('Все записи очищены из localForage');
  } catch (error) {
    log(`Ошибка очистки: ${error.message}`);
  }
}

// Начать анимацию иконки
function startIconAnimation() {
  if (isAnimating) return;
  
  isAnimating = true;
  const dots = ['.', '..', '...', '....'];
  let index = 0;
  
  // Устанавливаем цвет бейджа
  browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
  
  // Запускаем анимацию с точками
  animationInterval = setInterval(() => {
    browser.browserAction.setBadgeText({ text: dots[index] });
    index = (index + 1) % dots.length;
  }, 300);
}

// Остановить анимацию иконки
function stopIconAnimation() {
  if (!isAnimating) return;
  
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  
  browser.browserAction.setBadgeText({ text: '' });
  isAnimating = false;
}

// Получить Session_id cookie
function getSessionId() {
  return new Promise((resolve, reject) => {
    if (!browser.cookies || !browser.cookies.get) {
      reject(new Error('browser.cookies API недоступрно. Проверьте разрешения в manifest.json'));
      return;
    }
    
    // Используем url для доступа к кукам (Firefox требует url, а не domain)
    browser.cookies.get({
      url: 'https://yandex.ru',
      name: 'Session_id'
    }, (cookie) => {
      // Игнорируем ошибки доступа к кукам (браузер может блокировать доступ к _yasc и другим кукам)
      if (browser.runtime.lastError) {
        log(`Предупреждение при получении cookie: ${browser.runtime.lastError.message}`);
        // Продолжаем работу - cookie может быть доступен другим способом
      }
      
      if (cookie && cookie.value) {
        resolve(cookie.value);
      } else {
        reject(new Error('Session_id cookie не найден. Авторизуйтесь на books.yandex.ru и обновите страницу'));
      }
    });
  });
}

// HTTP запрос с cookies и отключённым кэшем
async function fetchWithCookie(url, sessionId) {
  // Для data: URL не используем cookies, делаем прямой запрос
  if (url.startsWith('data:')) {
    return fetch(url, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
  }
  
  return new Promise((resolve, reject) => {
    // Используем url для доступа к кукам (Firefox требует url, а не domain)
    browser.cookies.get({
      url: 'https://yandex.ru',
      name: 'Session_id'
    }, async (cookie) => {
      // Игнорируем ошибки доступа к кукам (браузер может блокировать доступ к _yasc и другим кукам)
      if (browser.runtime.lastError) {
        log(`Предупреждение при получении cookie: ${browser.runtime.lastError.message}`);
      }
      
      if (!cookie) {
        reject(new Error('Cookie не найден'));
        return;
      }
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Cookie': `Session_id=${cookie.value}`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        
        // Обработка 304 Not Modified - выбрасываем ошибку
        if (response.status === 304) {
          reject(new Error('304 Not Modified - сервер вернул кэш'));
          return;
        }
        
        if (response.ok) {
          resolve(response);
        } else {
          reject(new Error(`HTTP error: ${response.status}`));
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Загрузить секрет
async function downloadSecret() {
  const url = `https://${BOOKS_DOMAIN}/reader/p/api/v5/metadata_secret?lang=ru`;
  const sessionId = await getSessionId();
  
  const response = await fetchWithCookie(url, sessionId);
  const data = await response.json();
  
  return data.secret;
}

// Загрузить метаданные книги
async function downloadMetadata(bookId) {
  const url = `https://${BOOKS_DOMAIN}/p/api/v5/books/${bookId}/metadata/v4`;
  const sessionId = await getSessionId();
  
  const response = await fetchWithCookie(url, sessionId);
  return response.json();
}

// Загрузить метаданные комикса
async function downloadComicMetadata(comicBookId) {
  // Получаем auth-token из browser.storage
  const { authToken } = await browser.storage.local.get('authToken');
  
  if (!authToken) {
    throw new Error('Auth token не найден. Пожалуйста, авторизуйтесь через кнопку "Авторизоваться" в popup.');
  }
  
  const url = `https://${BOOKS_DOMAIN}/p/api/v5/comicbooks/${comicBookId}/metadata`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Cookie': `auth-token=${authToken}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch comic metadata: ${response.status}`);
  }
  
  return response.json();
}

// Заголовки как в Python скрипте (для комиксов)
// Используем auth-token OAuth для доступа к comicbook.bookmate.ru
async function getComicHeaders(appUserAgent) {
  // Получаем auth-token из browser.storage
  const { authToken } = await browser.storage.local.get('authToken');
  
  if (!authToken) {
    throw new Error('Auth token не найден. Пожалуйста, авторизуйтесь через кнопку "Авторизоваться" в popup.');
  }
  
  return {
    'Cookie': `auth-token=${authToken}`,
    'app-user-agent': appUserAgent,
    'mcc': '',
    'mnc': '',
    'imei': '',
    'subscription-country': '',
    'app-locale': '',
    'bookmate-version': '',
    'bookmate-websocket-version': '',
    'device-idfa': '',
    'onyx-preinstall': 'false',
    'auth-token': authToken,
    'accept-encoding': '',
    'user-agent': ''
  };
}

// Скачать изображение страницы комикса
async function downloadComicPage(imageUrl, appUserAgent) {
  const headers = await getComicHeaders(appUserAgent);
  const response = await fetch(imageUrl, {
    method: 'GET',
    headers: headers
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download comic page: ${response.status}`);
  }
  
  return response.arrayBuffer();
}

// Расшифровать метаданные
async function decryptMetadata(encryptedMetadata, secret) {
  const metadata = {};
  
  // Преобразуем секрет из base64 в ArrayBuffer
  const key = base64ToUint8Array(secret);
  
  for (const [keyName, value] of Object.entries(encryptedMetadata)) {
    if (Array.isArray(value)) {
      // Это зашифрованные данные
      const byteArray = new Uint8Array(value);
      const decrypted = await decrypt(key, byteArray);
      // decrypted - это ArrayBuffer, нужно конвертировать в Uint8Array
      const decryptedBytes = new Uint8Array(decrypted);
      metadata[keyName] = new TextDecoder('utf-8').decode(decryptedBytes);
    } else {
      metadata[keyName] = value;
    }
  }
  
  return metadata;
}

// Расшифровка AES-CBC
function decrypt(key, data) {
  // IV - первые 16 байт
  const iv = data.slice(0, 16);
  const encryptedData = data.slice(16);
  
  // Используем Crypto API браузера
  return new Promise((resolve, reject) => {
    crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt']
    ).then(importedKey => {
      crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv },
        importedKey,
        encryptedData
      ).then(decrypted => {
        // Удаление PKCS#7 padding
        const padding = decrypted[decrypted.length - 1];
        if (padding > 0 && padding <= 16) {
          resolve(decrypted.slice(0, decrypted.length - padding));
        } else {
          resolve(decrypted);
        }
      }).catch(reject);
    }).catch(reject);
  });
}

// Конвертация base64 в Uint8Array
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

// Преобразование ArrayBuffer в base64
function uint8ArrayToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Конвертация ArrayBuffer в base64 с использованием chunk-подхода для экономии памяти
// Работает в Service Worker без FileReader
function arrayBufferToBase64(arrayBuffer) {
  const CHUNK_SIZE = 8192; // 8KB chunks для экономии памяти
  const bytes = new Uint8Array(arrayBuffer);
  let result = '';
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    result += btoa(binary);
    
    // Периодически выводим прогресс
    if ((i + CHUNK_SIZE) % (CHUNK_SIZE * 100) === 0) {
      const percent = Math.round(((i + CHUNK_SIZE) / bytes.length) * 100);
      log(`Конвертация base64: ${percent}%`);
    }
  }
  
  return result;
}

// Конвертация ArrayBuffer в base64 с прогрессом для больших файлов
async function arrayBufferToBase64WithProgress(arrayBuffer) {
  const CHUNK_SIZE = 65536; // 64KB chunks для производительности
  const bytes = new Uint8Array(arrayBuffer);
  let result = '';
  
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    let binary = '';
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
    result += btoa(binary);
    
    // Периодически выводим прогресс каждые 10MB
    if ((i + CHUNK_SIZE) % (10 * 1024 * 1024) < CHUNK_SIZE) {
      const percent = Math.round(((i + CHUNK_SIZE) / bytes.length) * 100);
      log(`Конвертация base64: ${percent}% (${Math.round((i + CHUNK_SIZE) / 1024 / 1024)}MB / ${Math.round(bytes.length / 1024 / 1024)}MB)`);
    }
    
    // Небольшая задержка для освобождения Event Loop
    if (i % (CHUNK_SIZE * 10) === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }
  
  return result;
}

// Извлечь названия из OPF
function extractTitlesFromOpf(opfContent) {
  const match = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  return match ? match[1].trim() : null;
}

// Извлечь UUID документа из OPF
function extractDocumentUuidFromOpf(opfContent) {
  const match = opfContent.match(/<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/i);
  return match ? match[1].trim() : null;
}

// Извлечь href из OPF с очисткой от некорректных префиксов
function extractHrefsFromOpf(opfContent) {
  const hrefs = [];
  const regex = /<item[^>]*href="([^"]+)"/g;
  let match;
  
  while ((match = regex.exec(opfContent)) !== null) {
    let href = match[1];
    
    // Пропускать toc.ncx
    if (href === 'toc.ncx') {
      continue;
    }
    
    // Удалить префикс m:document: если он есть
    if (href.startsWith('m:document:')) {
      href = href.replace('m:document:', '');
    }
    
    // Пропускать пустые href
    if (!href || href.trim() === '') {
      continue;
    }
    
    // Пропускать href без расширения файла (только html, xhtml, htm, svg, css, js, xml)
    if (!/\.(html|xhtml|htm|svg|css|js|xml|jpg|jpeg|gif|png)$/i.test(href)) {
      continue;
    }
    
    hrefs.push(href);
  }
  
  return hrefs;
}

// Скачать файл с повторной попыткой при 304
async function downloadFile(url, sessionId) {
  const maxRetries = 3;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetchWithCookie(url, sessionId);
      const arrayBuffer = await response.arrayBuffer();
      
      // Проверка на пустой ответ
      if (arrayBuffer.byteLength === 0) {
        log(`Получен пустой ответ для ${url}, попытка ${i + 1}/${maxRetries}`);
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw new Error('Получен пустой ответ после всех попыток');
      }
      
      return arrayBuffer;
    } catch (error) {
      if (error.message.includes('304') && i < maxRetries - 1) {
        log(`Получен 304 для ${url}, повторяем через 500мс...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('Max retries exceeded');
}

// Создать EPUB с использованием JSZip
async function createEpub(metadata, bookId, bookTitle) {
  const safeTitle = sanitizeFileName(bookTitle || `Book_${bookId}`);
  
  // Создаем JSZip instance с настройками для EPUB
  const zip = new JSZip();
  
  // mimetype - ДОЛЖЕН быть без сжатия (STORED), и ПЕРВЫМ в архиве
  zip.file('mimetype', 'application/epub+zip', {
    compression: 'STORE',
    compressionOptions: {
      level: 1 // STORE (без сжатия)
    }
  });
  
  // META-INF/container.xml
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  
  // content.opf
  const opfContent = metadata.opf || '';
  zip.file('OEBPS/content.opf', opfContent);
  
  // toc.ncx
  if (metadata.ncx) {
    zip.file('OEBPS/toc.ncx', metadata.ncx);
  }
  
  // Скачать контент-файлы
  const uuuid = extractDocumentUuidFromOpf(opfContent) || bookId;
  const hrefs = extractHrefsFromOpf(opfContent);
  const sessionId = await getSessionId();
  
  const uuid = uuuid.replace('bm:document:','');
  
  console.log (uuid);
  for (const href of hrefs) {
    try {
      const url = `https://${BOOKS_DOMAIN}/p/a/4/d/${uuid}/contents/OEBPS/${href}`;
      
      log(`Скачивание: ${href}`);
      const arrayBuffer = await downloadFile(url, sessionId);
      zip.file(`OEBPS/${href}`, arrayBuffer);
    } catch (error) {
      log(`Не удалось скачать ${href}: ${error.message}`);
    }
  }
  
  // Генерируем EPUB как base64
  return await createEpubBase64(zip, safeTitle);
}

// Создать EPUB в формате base64 для передачи через sendMessage
async function createEpubBase64(zip, fileName) {
  // Генерируем ArrayBuffer напрямую из JSZip
  const arrayBuffer = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: {
      level: 6
    }
  });
  
  // Конвертируем в base64
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  
  return { base64, fileName };
}

// Сохранить файл через localForage (работает в Service Worker)
async function saveEpubToIndexDB(base64, fileName) {
  // Конвертируем base64 в Blob
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/epub+zip' });
  
  const archiveId = `epub_${Date.now()}`;
  
  const record = { 
    id: archiveId,
    blob: blob,
    fileName: fileName
  };
  
  await archives.setItem(archiveId, record);
  log(`EPUB сохранён в localForage: ${archiveId}, размер: ${blob.size} байт`);
  return { archiveId, fileName };
}

// Сохранить файл через browser.downloads API (из Blob)
// Используем FileReader для работы в Service Worker контексте
async function downloadFileFromBlob(blob, fileName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onloadend = () => {
      // reader.result - это data URL в формате "data:application/zip;base64,..."
      // Заменяем MIME тип на application/x-cbz для правильного расширения .cbz
      let dataUrl = reader.result.replace(/^data:application\/zip;base64,/, 'data:application/x-cbz;base64,');
      
      browser.downloads.download(
        {
          url: dataUrl,
          filename: fileName,
          saveAs: true // Показывать диалог сохранения файла
        },
        (downloadId) => {
          if (browser.runtime.lastError) {
            reject(new Error(browser.runtime.lastError.message));
          } else if (downloadId) {
            resolve({ downloadId });
          } else {
            reject(new Error('Не удалось начать загрузку'));
          }
        }
      );
    };
    
    reader.onerror = () => {
      reject(new Error('Ошибка чтения Blob'));
    };
    
    // Читаем Blob как Data URL (base64)
    reader.readAsDataURL(blob);
  });
}

// Безопасное имя файла
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 200).trim() || 'book';
}

// Проверить статус аудиокниги
async function checkAudioBookStatus(bookId) {
  try {
    // Получаем активную вкладку, чтобы проверить URL
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    if (tab && tab.url) {
      // Проверяем, является ли URL страницей аудиокниги
      const isAudioPage = /\/audiobooks\//.test(tab.url);
      
      if (isAudioPage) {
        log(`Книга ${bookId} - аудиокнига (по URL)`);
        return { isAudio: true };
      }
    }
    
    // Если не по URL, проверяем по метаданным
    const sessionId = await getSessionId();
    const url = `https://${BOOKS_DOMAIN}/p/api/v5/books/${bookId}/metadata/v4`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': `Session_id=${sessionId}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    
    if (!response.ok) {
      return { isAudio: false };
    }
    
    const data = await response.json();
    const opfContent = data.opf || '';
    
    // Ищем аудиофайлы в OPF
    const hasAudioFiles = /<item[^>]*href="[^"]+\.(mp3|ogg|wav|m4a)"|media-type="audio\//i.test(opfContent);
    
    log(`Книга ${bookId} - ${hasAudioFiles ? 'аудиокнига' : 'обычная книга'} (по метаданным)`);
    
    return { isAudio: hasAudioFiles };
  } catch (error) {
    log(`Ошибка проверки типа книги ${bookId}: ${error.message}`);
    return { isAudio: false };
  }
}

// Проверить, является ли книга аудиокнигой
function isAudioBook(metadata) {
  try {
    const opfContent = metadata.opf || '';
    
    // Проверяем наличие аудиофайлов в OPF
    const hasAudioFiles = /media-type="audio\/(mp3|mpeg|ogg|wav)"|<item[^>]*media-type="audio\//i.test(opfContent);
    
    // Проверяем наличие аудио в href
    const hasAudioRefs = /\.(mp3|ogg|wav|m4a)$/i.test(opfContent);
    
    // Проверяем свойства метаданных
    const opfObj = metadata.opfObject || {};
    const properties = opfObj.properties || '';
    const hasAudioProperty = /audio|sound|media/i.test(properties);
    
    return hasAudioFiles || hasAudioRefs || hasAudioProperty;
  } catch (error) {
    log(`Ошибка проверки типа книги: ${error.message}`);
    return false;
  }
}

// Извлечь список аудиофайлов из метаданных
function extractAudioFiles(metadata) {
  const audioFiles = [];
  const opfContent = metadata.opf || '';
  const uuid = extractDocumentUuidFromOpf(opfContent);
  
  // Ищем аудиофайлы в OPF
  const audioRegex = /<item[^>]*href="([^"]+\.(mp3|ogg|wav|m4a))"[^>]*\/?>/gi;
  let match;
  
  while ((match = audioRegex.exec(opfContent)) !== null) {
    const href = match[1];
    if (href) {
      audioFiles.push({
        href: href,
        url: `https://${BOOKS_DOMAIN}/p/a/4/d/${uuid.replace('bm:document:', '')}/contents/OEBPS/${href}`
      });
    }
  }
  
  // Также ищем в формате media-item
  const mediaRegex = /<media-item[^>]*href="([^"]+)"/gi;
  while ((match = mediaRegex.exec(opfContent)) !== null) {
    const href = match[1];
    if (href && /\.(mp3|ogg|wav|m4a)$/i.test(href)) {
      audioFiles.push({
        href: href,
        url: `https://${BOOKS_DOMAIN}/p/a/4/d/${uuid.replace('bm:document:', '')}/contents/OEBPS/${href}`
      });
    }
  }
  
  return audioFiles;
}

// Максимальный размер архива: 600MB
const MAX_ARCHIVE_SIZE = 950 * 1024 * 1024;

// Скачать комикс и сохранить в localForage
async function downloadComicBookAndSave(comicBookId, comicTitle) {
  log(`Начало скачивания комикса ${comicBookId}`);
  
  try {
    // 1. Получаем метаданные комикса
    log('Получение метаданных комикса...');
    const metadata = await downloadComicMetadata(comicBookId);
    
    // Приоритет названия:
    // 1. Название со страницы (comicTitle из content.js - через [data-test-id="CONTENT_TITLE_MAIN"])
    // 2. Название из метаданных API комикса (metadata.book?.title или metadata.title)
    // 3. Фолбэк Comic_${comicBookId}
    const comicTitleFromApi = metadata.book?.title || metadata.title || (metadata.bookmate && metadata.bookmate.title);
    const baseTitle = sanitizeFileName(comicTitle || comicTitleFromApi || `Comic_${comicBookId}`);
    
    log(`Используем название: ${baseTitle} (из ${comicTitle ? 'страницы' : (comicTitleFromApi ? 'API' : 'фолбэк')})`);
    
    // 2. Проверяем наличие ZIP URL в метаданных
    let comicZipUrl = null;
    if (metadata.uris && metadata.uris.zip) {
      comicZipUrl = metadata.uris.zip;
      log(`ZIP URL найден: ${comicZipUrl}`);
    }
    
    if (!comicZipUrl) {
      throw new Error('ZIP URL не найден в метаданных комикса');
    }
    
    // 3. Скачиваем готовый ZIP архив
    log('Скачивание ZIP архива комикса...');
    
    // Выбираем случайный app-user-agent как в Python скрипте
    const appUserAgent = getRandomComicUA();
    log(`Используем app-user-agent: ${appUserAgent}`);
    
    const headers = await getComicHeaders(appUserAgent);
    const response = await fetch(comicZipUrl, {
      method: 'GET',
      headers: headers
    });
    
    if (!response.ok) {
      throw new Error(`Ошибка скачивания ZIP: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/zip' });
    
    log(`Размер ZIP архива: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
    
    // 4. Сохраняем в localForage как CBZ
    const fileName = `${baseTitle}.cbz`;
    const archiveId = `comic_${Date.now()}`;
    
    const record = { 
      id: archiveId,
      blob: blob,
      fileName: fileName
    };
    
    await archives.setItem(archiveId, record);
    log(`Комикс сохранён в localForage: ${archiveId}, размер: ${blob.size} байт`);
    
    // 5. Устанавливаем бейдж на иконке (зеленая галочка)
    browser.browserAction.setBadgeText({ text: '✓' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
    
    log(`Комикс готов к скачиванию! Нажмите на иконку расширения чтобы скачать.`);
    return { success: true, archiveId, fileName };
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    throw error;
  }
}

// Скачать аудиокнигу и создать ZIP архив(ы) БЕЗ СЖАТИЯ
// Сохраняет ZIP в IndexedDB и отправляет ID в popup
async function downloadAudioAndSave(bookId, bookTitle) {
  const archiveBaseId = `audio_${bookId}_${Date.now()}`;
  
  log(`Начало скачивания аудиокниги ${bookId}`);
  
  try {
    // 1. Получаем плейлист аудиокниги
    log('Получение плейлиста аудиокниги...');
    const sessionId = await getSessionId();
    const url = `https://${BOOKS_DOMAIN}/reader/p/api/v5/audiobooks/${bookId}/playlists.json?lang=ru`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cookie': `Session_id=${sessionId}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }
    
    const playlist = await response.json();
    
    if (!playlist.tracks || playlist.tracks.length === 0) {
      throw new Error('Нет треков в плейлисте');
    }
    
    log(`Найдено треков: ${playlist.tracks.length}`);
    
    // Приоритет названия:
    // 1. Название со страницы (bookTitle из content.js)
    // 2. Название из плейлиста (playlist.title или playlist.bookTitle)
    // 3. Фолбэк Audiobook_${bookId}
    const playlistTitle = playlist.title || playlist.bookTitle || playlist.name;
    const baseTitle = sanitizeFileName(bookTitle || playlistTitle || `Audiobook_${bookId}`);
    
    log(`Используем название: ${baseTitle} (из ${bookTitle ? 'страницы' : (playlistTitle ? 'плейлиста' : 'фолбэк')})`);
    
    // Фильтруем доступные треки
    const availableTracks = playlist.tracks.filter(track => track.availability === 'available' && track.offline?.max_bit_rate?.url);
    
    if (availableTracks.length === 0) {
      throw new Error('Нет доступных для скачивания треков');
    }
    
    // 2. Создаём ZIP архив(ы) БЕЗ СЖАТИЯ
    let partNumber = 1;
    let savedCount = 0;
    let totalSavedCount = 0;
    let currentZipSize = 0;
    let globalFileCount = 0; // Глобальный счетчик файлов (не сбрасывается между частями)
    
    // Создаем первый ZIP архив
    let zip = new JSZip();
    
    // Скачиваем и добавляем каждый трек в ZIP по одному
    for (let i = 0; i < availableTracks.length; i++) {
      const track = availableTracks[i];
      
      try {
        log(`Скачивание трека ${i + 1}/${availableTracks.length}...`);
        
        // Получаем URL аудиофайла
        let audioUrl = track.offline?.max_bit_rate?.url;
        
        // Получаем имя файла из EXT-X-MAP:URI плейлиста
        try {
          const playlistResponse = await fetch(audioUrl, {
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
          });
          
          if (playlistResponse.ok) {
            const playlistText = await playlistResponse.text();
            const mapMatch = playlistText.match(/#EXT-X-MAP:URI="([^"]+)"/);
            if (mapMatch && mapMatch[1]) {
              const audioFileName = mapMatch[1];
              audioUrl = audioUrl.replace('play.m3u8', audioFileName);
              log(`Имя файла получено из EXT-X-MAP: ${audioFileName}`);
            }
          }
        } catch (err) {
          log(`Не удалось получить EXT-X-MAP из плейлиста, используем play.m4a по умолчанию`);
          audioUrl = audioUrl.replace('play.m3u8', 'play.m4a');
        }
        
        // Скачиваем аудиофайл
        const audioResponse = await fetch(audioUrl, {
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        });
        
        if (!audioResponse.ok) {
          log(`Ошибка скачивания трека ${track.number}: ${audioResponse.status}`);
          continue;
        }
        
        const arrayBuffer = await audioResponse.arrayBuffer();
        const fileSize = arrayBuffer.byteLength;
        
        const fileName = `${String(globalFileCount + 1).padStart(4, '0')}_${baseTitle}.m4a`;
        globalFileCount++;
        
        // Проверяем, не превысит ли файл лимит архива
        if (currentZipSize + fileSize > MAX_ARCHIVE_SIZE && savedCount > 0) {
          // Сохраняем текущий архив и создаем новый
          log(`Достигнут лимит размера архива (${(MAX_ARCHIVE_SIZE / 1024 / 1024).toFixed(0)}MB). Сохраняем часть ${partNumber}...`);
          
          const archiveId = `${archiveBaseId}_part${partNumber}`;
          const partFileName = `${baseTitle}_part${partNumber}.zip`;
          
          // Генерируем ZIP
          const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'STORE',
            compressionOptions: { level: 0 }
          });
          
          log(`Размер части ${partNumber}: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
          
          // Сохраняем в IndexedDB с названием файла
          await saveToDB(archiveId, { blob, fileName: `${baseTitle}_part${partNumber}.zip` });
          
          // Очищаем ZIP и начинаем новый архив
          zip = new JSZip();
          savedCount = 0;
          currentZipSize = 0;
          partNumber++;
          
          totalSavedCount += savedCount;
          log(`Создана часть архива ${partNumber - 1}, файлов в части: ${savedCount}, глобально: ${globalFileCount}`);
        }
        
        // Добавляем файл в ZIP БЕЗ СЖАТИЯ
        zip.file(fileName, arrayBuffer, { compression: 'STORE' });
        savedCount++;
        currentZipSize += fileSize;
        
        // Освобождаем память
        void arrayBuffer;
        
        log(`Трек ${i + 1}/${availableTracks.length} добавлен в архив (часть ${partNumber}, размер: ${(currentZipSize / 1024 / 1024).toFixed(2)}MB)`);
        
        // Небольшая задержка для освобождения памяти
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        log(`Ошибка при скачивании трека ${track.number}: ${error.message}`);
      }
    }
    
    if (savedCount === 0 && partNumber === 1) {
      throw new Error('Не удалось скачать ни одного трека');
    }
    
    // Сохраняем последний архив, если есть файлы
    if (savedCount > 0) {
      log(`Сохранение последней части архива ${partNumber}...`);
      
      const archiveId = `${archiveBaseId}_part${partNumber}`;
      const partFileName = `${baseTitle}_part${partNumber}.zip`;
      
      // Генерируем ZIP
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
        compressionOptions: { level: 0 }
      });
      
      log(`Размер части ${partNumber}: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
      
      // Сохраняем в IndexedDB с названием файла
      await saveToDB(archiveId, { blob, fileName: `${baseTitle}_part${partNumber}.zip` });
      
      totalSavedCount += savedCount;
      log(`Создана часть архива ${partNumber}, файлов: ${savedCount}`);
    }
    
    // Освобождаем память от ZIP объекта
    void zip;
    
    // 5. Устанавливаем бейдж на иконке (зеленая галочка)
    browser.browserAction.setBadgeText({ text: '✓' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
    
    const totalParts = partNumber;
    log(`Аудиокнига готова к сохранению! Всего файлов: ${totalSavedCount}, частей: ${totalParts}`);
    log(`Нажмите на иконку расширения чтобы скачать ZIP архив(ы)`);
    return { success: true, savedCount: totalSavedCount, parts: totalParts };
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    // Очистка при ошибке
    await deleteFromDB(archiveId).catch(() => {});
    throw error;
  }
}

// Обработка сообщений от popup
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setAuthToken') {
    // Установить auth-token вручную
    browser.storage.local.set({ authToken: request.token }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'clearBadge') {
    // Очищаем бейдж на иконке
    browser.browserAction.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getArchiveCount') {
    // Получить количество архивов в IndexedDB
    getArchiveCount()
      .then(count => {
        sendResponse({ count });
      })
      .catch(error => {
        sendResponse({ count: 0, error: error.message });
      });
    return true;
  }
  
  if (request.action === 'downloadBook') {
    // Начинаем анимацию иконки перед скачиванием
    startIconAnimation();
    
    downloadBookAndSave(request.bookId, request.bookTitle)
      .then(result => {
        // Останавливаем анимацию при успехе
        stopIconAnimation();
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        // Останавливаем анимацию при ошибке
        stopIconAnimation();
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Асинхронный ответ
  }
  
  if (request.action === 'downloadAudio') {
    // Начинаем анимацию иконки перед скачиванием
    startIconAnimation();
    
    downloadAudioAndSave(request.bookId, request.bookTitle)
      .then(result => {
        // Останавливаем анимацию при успехе
        stopIconAnimation();
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        // Останавливаем анимацию при ошибке
        stopIconAnimation();
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Асинхронный ответ
  }
  
  if (request.action === 'checkAudioBook') {
    // Проверяем, является ли книга аудиокнигой
    checkAudioBookStatus(request.bookId)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        sendResponse({ isAudio: false, error: error.message });
      });
    
    return true; // Асинхронный ответ
  }
  
  if (request.action === 'downloadComic') {
    // Начинаем анимацию иконки перед скачиванием
    startIconAnimation();
    
    downloadComicBookAndSave(request.comicBookId, request.comicTitle)
      .then(result => {
        // Останавливаем анимацию при успехе
        stopIconAnimation();
        sendResponse({ success: true, ...result });
      })
      .catch(error => {
        // Останавливаем анимацию при ошибке
        stopIconAnimation();
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Асинхронный ответ
  }
  
  return false;
});

// Главная функция скачивания (возвращает base64)
async function downloadBook(bookId, bookTitle) {
  log(`Начало скачивания книги ${bookId}`);
  
  try {
    // 1. Получить секрет
    log('Получение секрета...');
    const secret = await downloadSecret();
    
    // 2. Загрузить метаданные
    log('Загрузка метаданных...');
    const encryptedMetadata = await downloadMetadata(bookId);
    
    // 3. Расшифровать метаданные
    log('Расшифровка метаданных...');
    const metadata = await decryptMetadata(encryptedMetadata, secret);
    
    // 4. Приоритет названия:
    // 1. Название со страницы (bookTitle из content.js - через [data-test-id="CONTENT_TITLE_MAIN"])
    // 2. Название из метаданных OPF
    // 3. Фолбэк Book_${bookId}
    const opfTitle = extractTitlesFromOpf(metadata.opf);
    const title = bookTitle || opfTitle || `Book_${bookId}`;
    
    log(`Используем название: ${title} (из ${bookTitle ? 'страницы' : (opfTitle ? 'OPF' : 'фолбэк')})`);
    
    // 5. Создать EPUB
    log('Создание EPUB...');
    const result = await createEpub(metadata, bookId, title);
    
    log('EPUB создан успешно!');
    return { ...result };
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    throw error;
  }
}

// Новая функция: скачивает и сохраняет файл в IndexedDB
async function downloadBookAndSave(bookId, bookTitle) {
  log(`Начало скачивания книги ${bookId}`);
  
  try {
    // 1. Получить секрет
    log('Получение секрета...');
    const secret = await downloadSecret();
    
    // 2. Загрузить метаданные
    log('Загрузка метаданных...');
    const encryptedMetadata = await downloadMetadata(bookId);
    
    // 3. Расшифровать метаданные
    log('Расшифровка метаданных...');
    const metadata = await decryptMetadata(encryptedMetadata, secret);
    
    // 4. Приоритет названия:
    // 1. Название со страницы (bookTitle из content.js - через [data-test-id="CONTENT_TITLE_MAIN"])
    // 2. Название из метаданных OPF
    // 3. Фолбэк Book_${bookId}
    const opfTitle = extractTitlesFromOpf(metadata.opf);
    const title = bookTitle || opfTitle || `Book_${bookId}`;
    
    log(`Используем название: ${title} (из ${bookTitle ? 'страницы' : (opfTitle ? 'OPF' : 'фолбэк')})`);
    
    // 5. Создать EPUB
    log('Создание EPUB...');
    const epubResult = await createEpub(metadata, bookId, title);
    
    // 6. Сохранить файл в IndexedDB
    log('Сохранение файла в IndexedDB...');
    const saveResult = await saveEpubToIndexDB(epubResult.base64, epubResult.fileName + '.epub');
    
    // 7. Устанавливаем бейдж
    browser.browserAction.setBadgeText({ text: '✓' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#4CAF50' });
    
    log('Книга сохранена в IndexedDB! Нажмите на иконку расширения чтобы скачать.');
    return { ...saveResult };
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    throw error;
  }
}

log('Firefox background script started');
