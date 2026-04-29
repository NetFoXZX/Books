// Content.js - Скрипт для внедрения на страницу книги

const BOOKS_DOMAIN = 'books.yandex.ru';

// Извлечь BookId из URL
function extractBookIdFromUrl() {
  const url = window.location.href;
  
  console.log('[Content Script] Current URL:', url);
  
  const patterns = [
    /bookId=([^&]+)/,
    /\/audiobooks\/([a-zA-Z0-9-]+)/,  // Добавлено поддержу дефисов в UUID
    /\/books\/([a-zA-Z0-9]+)/,
    /\/reader\/([a-zA-Z0-9]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      console.log('[Content Script] Extracted bookId:', match[1]);
      return match[1];
    }
  }
  
  console.log('[Content Script] No bookId found');
  return null;
}

// Извлечь ComicBookId из URL
function extractComicBookIdFromUrl() {
  const url = window.location.href;
  
  console.log('[Content Script] Checking for comicbook URL:', url);
  
  // Паттерн для комиксов: /comicbooks/{id}
  const comicPattern = /\/comicbooks\/([a-zA-Z0-9]+)/;
  const match = url.match(comicPattern);
  
  if (match && match[1]) {
    console.log('[Content Script] Extracted comicBookId:', match[1]);
    return match[1];
  }
  
  console.log('[Content Script] No comicBookId found');
  return null;
}

// Определить тип страницы (аудиокнига, комикс или обычная книга)
function getBookType() {
  const url = window.location.href;
  
  // Проверка на аудиокнигу по URL
  if (/\/audiobooks\//.test(url)) {
    return 'audio';
  }
  
  // Проверка на комикс по URL
  if (/\/comicbooks\//.test(url)) {
    return 'comic';
  }
  
  return 'book';
}

// Извлечь название книги из заголовка страницы
function extractBookTitle() {
  // Приоритет 1: Специфичный селектор для страницы описания книги Яндекс.Книг
  // [data-test-id="CONTENT_TITLE_MAIN"] содержит название без HTML тегов
  const contentTitleMain = document.querySelector('[data-test-id="CONTENT_TITLE_MAIN"]');
  if (contentTitleMain) {
    // Используем textContent для получения чистого текста без HTML
    let title = contentTitleMain.textContent.trim();
    // Удаление служебных суффиксов
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*слушать онлайн.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*читать онлайн.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  // Приоритет 2: Получаем заголовок из мета-тега og:title
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.getAttribute('content')) {
    let title = ogTitle.getAttribute('content');
    // Удаление " - Яндекс.Книги" и подобного
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    // Удаление " - слушать онлайн" и подобных суффиксов
    title = title.replace(/\s*[-–—]\s*слушать онлайн.*/i, '').trim();
    // Удаление " читать онлайн" и подобных суффиксов
    title = title.replace(/\s*[-–—]\s*читать онлайн.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  // Приоритет 3: Заголовок из title тега
  const titleTag = document.querySelector('title');
  if (titleTag && titleTag.textContent) {
    let title = titleTag.textContent;
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*слушать онлайн.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*читать онлайн.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  // Приоритет 4: Заголовок h1 на странице
  const h1Title = document.querySelector('h1');
  if (h1Title && h1Title.textContent) {
    let title = h1Title.textContent.trim();
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*слушать онлайн.*/i, '').trim();
    title = title.replace(/\s*[-–—]\s*читать онлайн.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  // Приоритет 5: Специфичные селекторы для Яндекс.Книг
  // Селекторы для страниц комиксов
  const comicTitleSelectors = [
    '.book-header__title',
    '.reader-header__title',
    '[data-testid="book-title"]',
    '.book-title',
    '.title-header'
  ];
  
  for (const selector of comicTitleSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent) {
      let title = element.textContent.trim();
      title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
      title = title.replace(/\s*[-–—]\s*слушать онлайн.*/i, '').trim();
      title = title.replace(/\s*[-–—]\s*читать онлайн.*/i, '').trim();
      if (title) {
        return title;
      }
    }
  }
  
  return null;
}

// Обработка сообщений от popup и background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookInfo') {
    const bookType = getBookType();
    let bookId = null;
    let comicBookId = null;
    const bookTitle = extractBookTitle();
    
    // В зависимости от типа страницы извлекаем нужный ID
    if (bookType === 'comic') {
      comicBookId = extractComicBookIdFromUrl();
      bookId = comicBookId; // Для совместимости передаем тоже в bookId
    } else {
      bookId = extractBookIdFromUrl();
    }
    
    console.log('[Content Script] Sending response:', { bookId, comicBookId, bookTitle, bookType });
    
    sendResponse({
      bookId: bookId,
      comicBookId: comicBookId,
      bookTitle: bookTitle,
      bookType: bookType,
      url: window.location.href
    });
  }
  
  if (request.action === 'fetchAudioPlaylist') {
    // Получаем плейлист аудиокниги
    fetch(`https://${BOOKS_DOMAIN}/reader/p/api/v5/audiobooks/${request.bookId}/playlists.json?lang=ru`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      return response.json();
    })
    .then(playlist => {
      sendResponse({ success: true, playlist });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Асинхронный ответ
  }
  
  if (request.action === 'downloadAudioFile') {
    // Скачиваем аудиофайл
    fetch(request.url, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then(arrayBuffer => {
      sendResponse({ success: true, arrayBuffer: Array.from(new Uint8Array(arrayBuffer)) });
    })
    .catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    
    return true; // Асинхронный ответ
  }
  
  return true;
});

// Логирование для отладки
console.log('[Content Script] Yandex Books Downloader content script loaded');

// Логирование для отладки
console.log('Yandex Books Downloader - Content script loaded');