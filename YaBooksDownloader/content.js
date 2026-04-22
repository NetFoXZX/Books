// Content.js - Скрипт для внедрения на страницу книги

// Извлечь BookId из URL
function extractBookIdFromUrl() {
  const url = window.location.href;
  
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

// Обработка сообщений от popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getBookInfo') {
    const bookId = extractBookIdFromUrl();
    const bookTitle = extractBookTitle();
    
    sendResponse({
      bookId: bookId,
      bookTitle: bookTitle,
      url: window.location.href
    });
  }
  
  return true;
});

// Логирование для отладки
console.log('Yandex Books Downloader - Content script loaded');