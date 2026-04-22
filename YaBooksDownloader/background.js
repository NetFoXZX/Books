// Background.js - Фоновый сервис для скачивания книг

// Подключаем JSZip
importScripts('jszip.min.js');

// API домен
const BOOKS_DOMAIN = 'books.yandex.ru';

// Переменная для хранения интервала анимации
let animationInterval = null;
let isAnimating = false;

// Логирование
function log(message) {
  console.log('[Yandex Books Downloader]', message);
}

// Начать анимацию иконки
function startIconAnimation() {
  if (isAnimating) return;
  
  isAnimating = true;
  const dots = ['.', '..', '...', '....'];
  let index = 0;
  
  // Устанавливаем цвет бейджа
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  
  // Запускаем анимацию с точками
  animationInterval = setInterval(() => {
    chrome.action.setBadgeText({ text: dots[index] });
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
  
  chrome.action.setBadgeText({ text: '' });
  isAnimating = false;
}

// Получить Session_id cookie
function getSessionId() {
  return new Promise((resolve, reject) => {
    if (!chrome.cookies || !chrome.cookies.get) {
      reject(new Error('chrome.cookies API недоступрно. Проверьте разрешения в manifest.json'));
      return;
    }
    
    chrome.cookies.get({
      url: `https://${BOOKS_DOMAIN}`,
      name: 'Session_id'
    }, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Ошибка получения cookie: ${chrome.runtime.lastError.message}`));
        return;
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
  return new Promise((resolve, reject) => {
    chrome.cookies.get({
      url: `https://${BOOKS_DOMAIN}`,
      name: 'Session_id'
    }, async (cookie) => {
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

// Сохранить файл через chrome.downloads API
async function downloadFileFromBase64(base64, fileName) {
  const dataUrl = `data:application/epub+zip;base64,${base64}`;
  
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: fileName,
        saveAs: true // Показывать диалог сохранения файла
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
}

// Безопасное имя файла
function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').substring(0, 200).trim() || 'book';
}

// Обработка сообщений от popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    
    // 4. Извлечь название из метаданных OPF (приоритетный источник)
    const opfTitle = extractTitlesFromOpf(metadata.opf);
    const title = opfTitle || bookTitle || `Book_${bookId}`;
    
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

// Новая функция: скачивает и сохраняет файл через chrome.downloads API
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
    
    // 4. Извлечь название из метаданных OPF (приоритетный источник)
    const opfTitle = extractTitlesFromOpf(metadata.opf);
    const title = opfTitle || bookTitle || `Book_${bookId}`;
    
    // 5. Создать EPUB
    log('Создание EPUB...');
    const epubResult = await createEpub(metadata, bookId, title);
    
    // 6. Сохранить файл через chrome.downloads API
    log('Сохранение файла...');
    const downloadResult = await downloadFileFromBase64(epubResult.base64, epubResult.fileName + '.epub');
    
    log('Книга успешно сохранена!');
    return { ...downloadResult };
  } catch (error) {
    log(`Ошибка: ${error.message}`);
    throw error;
  }
}

log('Service worker started');