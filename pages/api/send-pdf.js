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

// Обработка форматирования
const processText = (text) => {
  // Обработка Markdown-подобного синтаксиса
  text = text
    .replace(/\*([^*]+)\*/g, '<b>$1</b>')       // *жирный* → <b>жирный</b>
    .replace(/_([^_]+)_/g, '<i>$1</i>')         // _курсив_ → <i>курсив</i>
    .replace(/~([^~]+)~/g, '<u>$1</u>');        // ~подчеркнутый~ → <u>подчеркнутый</u>

  const tokens = [];
  let buffer = '';
  let currentStyles = {
    bold: false,
    italic: false,
    underline: false
  };

  const pushText = (content) => {
    if (content) {
      tokens.push({
        content,
        ...currentStyles
      });
    }
  };

  for (let i = 0; i < text.length; i++) {
    if (text.substr(i, 3) === '<b>') {
      pushText(buffer);
      buffer = '';
      currentStyles.bold = true;
      i += 2;
    } else if (text.substr(i, 4) === '</b>') {
      pushText(buffer);
      buffer = '';
      currentStyles.bold = false;
      i += 3;
    } else if (text.substr(i, 3) === '<i>') {
      pushText(buffer);
      buffer = '';
      currentStyles.italic = true;
      i += 2;
    } else if (text.substr(i, 4) === '</i>') {
      pushText(buffer);
      buffer = '';
      currentStyles.italic = false;
      i += 3;
    } else if (text.substr(i, 3) === '<u>') {
      pushText(buffer);
      buffer = '';
      currentStyles.underline = true;
      i += 2;
    } else if (text.substr(i, 4) === '</u>') {
      pushText(buffer);
      buffer = '';
      currentStyles.underline = false;
      i += 3;
    } else {
      buffer += text[i];
    }
  }
  pushText(buffer);

  return tokens;
};

// Обработка эмодзи
const processEmojis = (tokens) => {
  const emojiRegExp = emojiRegex();
  const result = [];

  tokens.forEach(token => {
    let text = token.content;
    let lastIndex = 0;
    let match;

    while ((match = emojiRegExp.exec(text)) !== null) {
      // Текст до эмодзи
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          content: text.slice(lastIndex, match.index),
          ...token
        });
      }
      
      // Эмодзи
      result.push({
        type: 'emoji',
        content: match[0],
        ...token
      });
      
      lastIndex = match.index + match[0].length;
    }

    // Остаток текста
    if (lastIndex < text.length) {
      result.push({
        type: 'text',
        content: text.slice(lastIndex),
        ...token
      });
    }
  });

  return result;
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
    const styleTokens = processText(text);
    const tokens = processEmojis(styleTokens);
    
    // Создаем страницу
    const page = pdfDoc.addPage([600, 800]);
    let yPosition = 750;
    const lineHeight = 24;
    
    // Добавляем текст на страницу
    tokens.forEach(token => {
      let font = mainFont;
      let size = 12;
      let color = rgb(0, 0, 0);
      let content = token.content;

      if (token.type === 'emoji') {
        font = emojiFont;
      } else {
        if (token.bold) size = 14;
        if (token.underline) color = rgb(0, 0, 1); // Синий для подчеркивания
      }

      page.drawText(content, {
        x: 50,
        y: yPosition,
        size,
        font,
        color,
        ...(token.italic && { skew: { x: 0.2, y: 0 } }) // Наклон для курсива
      });

      yPosition -= lineHeight;
    });

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
