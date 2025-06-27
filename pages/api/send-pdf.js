import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Buffer } from 'buffer';

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    const {
      // Обязательные параметры
      text,
      chat_id,
      bot_token,
      
      // Опциональные параметры документа
      document_title = 'document.pdf',
      font_size = 12,
      line_height = 20,
      margins = [50, 50, 50, 50], // [left, top, right, bottom]
      
      // Параметры Telegram API
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

    // Валидация обязательных полей
    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ 
        error: 'Missing required parameters: text, chat_id, bot_token' 
      });
    }

    // Создаем PDF документ
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Используем стандартный шрифт с поддержкой Unicode
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Разбиваем текст на строки
    const lines = text.split('\n');
    const [left, top, right, bottom] = margins;

    // Рассчитываем высоту страницы
    const pageHeight = Math.max(
      400, 
      top + bottom + (lines.length * line_height)
    );

    // Добавляем страницу
    const page = pdfDoc.addPage([600, pageHeight]);

    // Добавляем текст с поддержкой Unicode
    lines.forEach((line, index) => {
      if (line.trim() !== '') {
        page.drawText(line, {
          x: left,
          y: pageHeight - top - (index * line_height),
          size: font_size,
          font,
          color: rgb(0, 0, 0),
          lineHeight: line_height,
        });
      }
    });

    // Генерируем PDF
    const pdfBytes = await pdfDoc.save();

    // Подготавливаем FormData для Telegram
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), document_title);
    formData.append('caption', caption);
    formData.append('parse_mode', parse_mode);
    formData.append('disable_notification', disable_notification.toString());
    formData.append('protect_content', protect_content.toString());

    // Добавляем опциональные параметры
    if (reply_parameters) {
      formData.append('reply_parameters', JSON.stringify(reply_parameters));
    }
    if (reply_markup) {
      formData.append('reply_markup', JSON.stringify(reply_markup));
    }
    if (message_thread_id) {
      formData.append('message_thread_id', message_thread_id);
    }
    if (thumbnail) {
      formData.append('thumbnail', thumbnail);
    }
    if (caption_entities) {
      formData.append('caption_entities', JSON.stringify(caption_entities));
    }
    if (disable_content_type_detection !== undefined) {
      formData.append('disable_content_type_detection', disable_content_type_detection.toString());
    }
    if (allow_sending_without_reply !== undefined) {
      formData.append('allow_sending_without_reply', allow_sending_without_reply.toString());
    }
    if (has_spoiler !== undefined) {
      formData.append('has_spoiler', has_spoiler.toString());
    }
    if (message_effect_id) {
      formData.append('message_effect_id', message_effect_id);
    }
    if (business_connection_id) {
      formData.append('business_connection_id', business_connection_id);
    }

    // Отправляем в Telegram
    const response = await fetch(`https://api.telegram.org/bot${bot_token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.description || 'Failed to send document');
    }

    return res.status(200).json({
      success: true,
      result: {
        message_id: result.result.message_id,
        date: result.result.date,
        document: {
          file_name: document_title,
          file_size: pdfBytes.length,
          mime_type: 'application/pdf'
        }
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
