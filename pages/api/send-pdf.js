import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';
import emojiRegex from 'emoji-regex';

// Загружаем шрифт
const loadFont = async (pdfDoc) => {
  const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
  const fontBytes = readFileSync(fontPath);
  return await pdfDoc.embedFont(fontBytes);
};

// Простая замена эмодзи на текстовые описания
const replaceEmojis = (text) => {
  const emojiMap = {
    '😊': '[улыбка]',
    '😂': '[смех]',
    '❤️': '[сердце]',
    '👍': '[палец вверх]',
    // Добавьте другие нужные эмодзи
  };
  
  return text.replace(emojiRegex(), (emoji) => {
    return emojiMap[emoji] || `[эмодзи:${emoji.codePointAt(0).toString(16)}]`;
  });
};

// Обработка форматирования
const processFormatting = (text) => {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<b>$1</b>')
    .replace(/__(.*?)__/g, '<i>$1</i>')
    .replace(/_(.*?)_/g, '<i>$1</i>')
    .replace(/~~(.*?)~~/g, '<u>$1</u>')
    .replace(/~(.*?)~/g, '<u>$1</u>');
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    const { text, chat_id, bot_token, ...restParams } = req.body;

    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ error: 'Required parameters missing' });
    }

    // Обрабатываем текст
    const textWithoutEmojis = replaceEmojis(text);
    const formattedText = processFormatting(textWithoutEmojis);

    // Создаем PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await loadFont(pdfDoc);
    
    // Разбиваем на строки
    const lines = formattedText.split('\n');
    const pageHeight = 50 + (lines.length * 25);
    const page = pdfDoc.addPage([600, pageHeight]);
    
    // Добавляем текст
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: 50,
        y: pageHeight - 50 - (i * 25),
        size: 12,
        font,
        color: rgb(0, 0, 0)
      });
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
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
