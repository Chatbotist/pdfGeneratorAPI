import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';

// Загружаем шрифт
const loadFont = async (pdfDoc) => {
  const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
  const fontBytes = readFileSync(fontPath);
  return await pdfDoc.embedFont(fontBytes);
};

// Удаляем все неподдерживаемые символы
const cleanText = (text) => {
  return text.replace(/[^\u0400-\u04FF\u0500-\u052F\u0020-\u007E\u00A0-\u00FF\u2000-\u206F\n\r]/g, '');
};

// Автоперенос строк
const wrapText = (text, maxWidth, fontSize, font) => {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = font.widthOfTextAtSize(currentLine + ' ' + word, fontSize);
    
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  lines.push(currentLine);
  return lines;
};

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    // Поддерживаемые параметры Telegram API
    const {
      text,
      chat_id,
      bot_token,
      business_connection_id,
      message_thread_id,
      thumbnail,
      caption,
      parse_mode,
      caption_entities,
      disable_content_type_detection,
      disable_notification,
      protect_content,
      allow_paid_broadcast,
      message_effect_id,
      reply_parameters,
      reply_markup,
      document_title = 'document.pdf'
    } = req.body;

    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ error: 'Required parameters: text, chat_id, bot_token' });
    }

    // Очищаем текст
    const cleanedText = cleanText(text);

    // Создаем PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await loadFont(pdfDoc);
    
    // Настройки страницы
    const pageWidth = 600;
    const pageHeight = 800;
    const margin = 50;
    const fontSize = 12;
    const lineHeight = 20;
    const maxLineWidth = pageWidth - (margin * 2);
    
    // Создаем страницу
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;
    
    // Разбиваем на абзацы
    const paragraphs = cleanedText.split('\n');
    
    // Добавляем текст с автопереносами
    for (const paragraph of paragraphs) {
      const lines = wrapText(paragraph, maxLineWidth, fontSize, font);
      
      for (const line of lines) {
        if (yPosition < margin) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          yPosition = pageHeight - margin;
        }
        
        page.drawText(line, {
          x: margin,
          y: yPosition,
          size: fontSize,
          font,
          color: rgb(0, 0, 0)
        });
        
        yPosition -= lineHeight;
      }
      
      yPosition -= lineHeight / 2;
    }

    const pdfBytes = await pdfDoc.save();

    // Формируем FormData для Telegram
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), document_title);
    
    // Добавляем только указанные параметры
    const optionalParams = {
      business_connection_id,
      message_thread_id,
      thumbnail,
      caption,
      parse_mode,
      caption_entities,
      disable_content_type_detection,
      disable_notification,
      protect_content,
      allow_paid_broadcast,
      message_effect_id,
      reply_parameters,
      reply_markup
    };

    Object.entries(optionalParams).forEach(([key, value]) => {
      if (value !== undefined) {
        formData.append(
          key, 
          typeof value === 'object' ? JSON.stringify(value) : value.toString()
        );
      }
    });

    // Отправка в Telegram
    const response = await fetch(`https://api.telegram.org/bot${bot_token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const telegramResponse = await response.json();

    if (!telegramResponse.ok) {
      throw new Error(telegramResponse.description || 'Telegram API error');
    }

    // Возвращаем полный ответ от Telegram
    return res.json({
      success: true,
      telegram_response: telegramResponse, // Полный объект ответа
      local_info: {
        document_size: pdfBytes.length,
        pages: pdfDoc.getPages().length
      }
    });

  } catch (error) {
    console.error('PDF generation error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack
      })
    });
  }
}
