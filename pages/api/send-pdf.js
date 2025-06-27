import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    // Все параметры Telegram API
    const {
      // Обязательные
      text,
      chat_id,
      bot_token,
      
      // Настройки документа
      document_title = 'document.pdf',
      font_size = 12,
      line_height = 24,
      margins = [50, 50, 50, 50], // left, top, right, bottom
      
      // Параметры Telegram
      caption = '',
      parse_mode = 'HTML',
      disable_notification = false,
      protect_content = false,
      reply_parameters,
      reply_markup,
      message_thread_id,
      thumbnail,
      caption_entities,
      disable_content_type_detection,
      allow_sending_without_reply,
      has_spoiler,
      message_effect_id,
      business_connection_id
    } = req.body;

    // Валидация
    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ 
        error: 'Required parameters: text, chat_id, bot_token' 
      });
    }

    // Загружаем кастомный шрифт
    const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
    const fontBytes = readFileSync(fontPath);

    // Создаем PDF и регистрируем fontkit
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit); // Регистрируем fontkit
    
    // Загружаем шрифт
    const customFont = await pdfDoc.embedFont(fontBytes);
    
    // Подготовка текста
    const lines = text.split('\n');
    const [left, top, right, bottom] = margins;
    const pageHeight = Math.max(
      400, 
      top + bottom + (lines.length * line_height)
    );

    // Создаем страницу
    const page = pdfDoc.addPage([600, pageHeight]);

    // Добавляем текст
    lines.forEach((line, index) => {
      if (line.trim()) {
        page.drawText(line, {
          x: left,
          y: pageHeight - top - (index * line_height),
          size: font_size,
          font: customFont,
          color: rgb(0, 0, 0),
          lineHeight: line_height,
        });
      }
    });

    const pdfBytes = await pdfDoc.save();

    // Формируем FormData для Telegram
    const formData = new FormData();
    
    // Обязательные параметры
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), document_title);
    
    // Основные параметры
    formData.append('caption', caption);
    formData.append('parse_mode', parse_mode);
    formData.append('disable_notification', disable_notification.toString());
    formData.append('protect_content', protect_content.toString());

    // Дополнительные параметры
    const optionalParams = {
      reply_parameters,
      reply_markup,
      message_thread_id,
      thumbnail,
      caption_entities,
      disable_content_type_detection,
      allow_sending_without_reply,
      has_spoiler,
      message_effect_id,
      business_connection_id
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

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.description || 'Telegram API error');
    }

    return res.json({
      success: true,
      result: {
        message_id: result.result.message_id,
        document: {
          file_name: document_title,
          file_size: pdfBytes.length,
          mime_type: 'application/pdf'
        },
        date: result.result.date
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
