import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';
import emojiRegex from 'emoji-regex';

// Загружаем шрифты
const loadFonts = async (pdfDoc) => {
  const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
  const fontBytes = readFileSync(fontPath);
  
  // Основной шрифт для текста
  const mainFont = await pdfDoc.embedFont(fontBytes);
  
  // Шрифт для эмодзи (используем стандартный)
  const emojiFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  return { mainFont, emojiFont };
};

// Обработка HTML-тегов и эмодзи
const processText = (text, pdfDoc, fonts) => {
  const { mainFont, emojiFont } = fonts;
  const emojiRegExp = emojiRegex();
  
  // Разбиваем текст на токены: текст и эмодзи
  const tokens = [];
  let lastIndex = 0;
  let match;
  
  while ((match = emojiRegExp.exec(text)) !== null) {
    // Текст до эмодзи
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
        font: mainFont
      });
    }
    
    // Сам эмодзи
    tokens.push({
      type: 'emoji',
      content: match[0],
      font: emojiFont
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Остаток текста после последнего эмодзи
  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.slice(lastIndex),
      font: mainFont
    });
  }
  
  // Обработка HTML-тегов
  return tokens.map(token => {
    if (token.type === 'text') {
      // Простая замена тегов (можно расширить)
      let content = token.content;
      let isBold = false;
      
      // Обработка <b> тегов
      if (content.includes('<b>')) {
        isBold = true;
        content = content.replace(/<b>/g, '').replace(/<\/b>/g, '');
      }
      
      return {
        ...token,
        content,
        bold: isBold
      };
    }
    return token;
  });
};

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    // Параметры из запроса
    const { text, chat_id, bot_token, ...restParams } = req.body;

    // Валидация
    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ 
        error: 'Required parameters: text, chat_id, bot_token' 
      });
    }

    // Создаем PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    
    // Загружаем шрифты
    const fonts = await loadFonts(pdfDoc);
    
    // Обрабатываем текст
    const tokens = processText(text, pdfDoc, fonts);
    
    // Создаем страницу
    const page = pdfDoc.addPage([600, 800]);
    let yPosition = 750;
    const lineHeight = 24;
    
    // Добавляем текст на страницу
    tokens.forEach(token => {
      if (token.type === 'text') {
        page.drawText(token.content, {
          x: 50,
          y: yPosition,
          size: token.bold ? 14 : 12,
          font: token.font,
          color: rgb(0, 0, 0),
          ...(token.bold && { font: fonts.mainFont, size: 14 })
        });
        
        // Обновляем позицию (упрощенная логика переноса строк)
        yPosition -= lineHeight;
      } else if (token.type === 'emoji') {
        page.drawText(token.content, {
          x: 50,
          y: yPosition,
          size: 12,
          font: token.font,
          color: rgb(0, 0, 0)
        });
        yPosition -= lineHeight;
      }
    });

    const pdfBytes = await pdfDoc.save();

    // Отправка в Telegram (остальной код без изменений)
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), 'document.pdf');
    
    // Добавляем остальные параметры
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
