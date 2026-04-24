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

// Определить тип страницы (аудиокнига или обычная книга)
function getBookType() {
  const url = window.location.href;
  
  // Проверка на аудиокнигу по URL
  if (/\/audiobooks\//.test(url)) {
    return 'audio';
  }
  
  return 'book';
}

// Извлечь название книги из заголовка страницы
function extractBookTitle() {
  // Получаем заголовок из мета-тега og:title (наиболее надёжный источник)
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && ogTitle.getAttribute('content')) {
    let title = ogTitle.getAttribute('content');
    // Удаление " - Яндекс.Книги" и подобного
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  // Фолбэк: заголовок из title тега
  const titleTag = document.querySelector('title');
  if (titleTag && titleTag.textContent) {
    let title = titleTag.textContent;
    title = title.replace(/\s*[-–—]\s*Яндекс\.Книги.*/i, '').trim();
    if (title) {
      return title;
    }
  }
  
  return null;
}

// Обработка сообщений от popup и background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookInfo') {
    const bookId = extractBookIdFromUrl();
    const bookTitle = extractBookTitle();
    const bookType = getBookType();
    
    console.log('[Content Script] Sending response:', { bookId, bookTitle, bookType });
    
    sendResponse({
      bookId: bookId,
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