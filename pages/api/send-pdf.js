import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';
import emojiRegex from 'emoji-regex';

// Загружаем шрифты
const loadFonts = async (pdfDoc) => {
  const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
  const fontBytes = readFileSync(fontPath);
  
  const mainFont = await pdfDoc.embedFont(fontBytes);
  const emojiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  return { mainFont, emojiFont };
};

// Функция для разделения текста и эмодзи
const splitTextAndEmojis = (text) => {
  const emojiRegExp = emojiRegex();
  const result = [];
  let lastIndex = 0;
  let match;

  while ((match = emojiRegExp.exec(text)) !== null) {
    // Текст до эмодзи
    if (match.index > lastIndex) {
      result.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }
    
    // Эмодзи
    result.push({
      type: 'emoji',
      content: match[0]
    });
    
    lastIndex = match.index + match[0].length;
  }

  // Остаток текста
  if (lastIndex < text.length) {
    result.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return result;
};

// Функция для обработки форматирования
const processFormatting = (text) => {
  // Обрабатываем Markdown-подобный синтаксис
  let processedText = text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')  // **жирный**
    .replace(/\*(.*?)\*/g, '<b>$1</b>')      // *жирный*
    .replace(/__(.*?)__/g, '<i>$1</i>')      // __курсив__
    .replace(/_(.*?)_/g, '<i>$1</i>')        // _курсив_
    .replace(/~~(.*?)~~/g, '<u>$1</u>')      // ~~подчеркнутый~~
    .replace(/~(.*?)~/g, '<u>$1</u>');       // ~подчеркнутый~

  // Разбиваем на токены с учетом HTML-тегов
  const tokens = [];
  const tagRegex = /(<\/?(b|i|u)>)/g;
  let lastIndex = 0;
  let match;
  let currentTags = [];

  while ((match = tagRegex.exec(processedText)) !== null) {
    // Текст до тега
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: processedText.slice(lastIndex, match.index),
        tags: [...currentTags]
      });
    }

    // Обработка тега
    if (match[0].startsWith('</')) {
      currentTags = currentTags.filter(tag => tag !== match[2]);
    } else {
      currentTags.push(match[2]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Остаток текста
  if (lastIndex < processedText.length) {
    tokens.push({
      type: 'text',
      content: processedText.slice(lastIndex),
      tags: [...currentTags]
    });
  }

  return tokens;
};

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    const { text, chat_id, bot_token, ...restParams } = req.body;

    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ 
        error: 'Required parameters: text, chat_id, bot_token' 
      });
    }

    // Создаем PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    
    // Загружаем шрифты
    const { mainFont, emojiFont } = await loadFonts(pdfDoc);
    
    // Обрабатываем текст
    const formattedTokens = processFormatting(text);
    let allTokens = [];

    // Разбиваем каждый форматированный токен на текст/эмодзи
    for (const token of formattedTokens) {
      if (token.type === 'text') {
        const splitResult = splitTextAndEmojis(token.content);
        allTokens.push(...splitResult.map(t => ({
          ...t,
          tags: token.tags
        })));
      } else {
        allTokens.push(token);
      }
    }
    
    // Создаем страницу
    const page = pdfDoc.addPage([600, 800]);
    let yPosition = 750;
    const lineHeight = 24;
    
    // Добавляем текст на страницу
    for (const token of allTokens) {
      let font = mainFont;
      let size = 12;
      let color = rgb(0, 0, 0);
      let content = token.content;
      let skew = undefined;

      if (token.type === 'emoji') {
        font = emojiFont;
      } else {
        // Применяем форматирование
        if (token.tags.includes('b')) size = 14;
        if (token.tags.includes('i')) skew = { x: 0.2, y: 0 };
        if (token.tags.includes('u')) color = rgb(0, 0, 1);
      }

      page.drawText(content, {
        x: 50,
        y: yPosition,
        size,
        font,
        color,
        ...(skew && { skew })
      });

      yPosition -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();

    // Отправка в Telegram
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), 'document.pdf');
    
    Object.entries(restParams).forEach(([key, value]) => {
      if (value !== undefined) {
        formData.append(key, typeof value === 'object' ? JSON.stringify(value) : value.toString());
      }
    });

    const response = await fetch(`https://api.telegram.org/bot${bot_token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.description || 'Telegram API error');
    }

    return res.json({
      success: true,
      result: {
        message_id: result.result.message_id,
        document: {
          file_name: 'document.pdf',
          file_size: pdfBytes.length,
          mime_type: 'application/pdf'
        }
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
