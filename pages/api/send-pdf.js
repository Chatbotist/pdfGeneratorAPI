import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Buffer } from 'buffer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  // Все поддерживаемые параметры
  const {
    // Обязательные
    text,
    chat_id,
    bot_token,
    document_title = 'document.pdf',
    
    // Опциональные базовые
    caption,
    parse_mode = 'HTML',
    caption_entities,
    disable_content_type_detection,
    disable_notification,
    protect_content,
    message_effect_id,
    reply_parameters,
    reply_markup,
    
    // Опциональные расширенные
    message_thread_id,
    thumbnail,
    allow_sending_without_reply,
    has_spoiler,
    allow_paid_broadcast,
    business_connection_id
  } = req.body;

  // Валидация
  if (!text || !chat_id || !bot_token) {
    return res.status(400).json({ 
      error: 'Required parameters: text, chat_id, bot_token' 
    });
  }

  // Проверка parse_mode
  const allowedParseModes = ['HTML', 'Markdown', 'MarkdownV2'];
  if (parse_mode && !allowedParseModes.includes(parse_mode)) {
    return res.status(400).json({
      error: `Invalid parse_mode. Allowed: ${allowedParseModes.join(', ')}`
    });
  }

  try {
    // 1. Генерация PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 400]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    page.drawText(text, {
      x: 50,
      y: 350,
      size: 15,
      font,
      color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();

    // 2. Подготовка формы для Telegram
    const formData = new FormData();
    
    // Обязательные параметры
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), document_title);
    
    // Опциональные параметры
    if (caption) formData.append('caption', caption);
    if (parse_mode) formData.append('parse_mode', parse_mode);
    if (caption_entities) formData.append('caption_entities', JSON.stringify(caption_entities));
    if (disable_content_type_detection !== undefined) formData.append('disable_content_type_detection', disable_content_type_detection);
    if (disable_notification !== undefined) formData.append('disable_notification', disable_notification);
    if (protect_content !== undefined) formData.append('protect_content', protect_content);
    if (message_effect_id) formData.append('message_effect_id', message_effect_id);
    if (reply_parameters) formData.append('reply_parameters', JSON.stringify(reply_parameters));
    if (reply_markup) formData.append('reply_markup', JSON.stringify(reply_markup));
    if (message_thread_id) formData.append('message_thread_id', message_thread_id);
    if (thumbnail) formData.append('thumbnail', thumbnail);
    if (allow_sending_without_reply !== undefined) formData.append('allow_sending_without_reply', allow_sending_without_reply);
    if (has_spoiler !== undefined) formData.append('has_spoiler', has_spoiler);
    if (allow_paid_broadcast !== undefined) formData.append('allow_paid_broadcast', allow_paid_broadcast);
    if (business_connection_id) formData.append('business_connection_id', business_connection_id);

    // 3. Отправка в Telegram
    const tgResponse = await fetch(`https://api.telegram.org/bot${bot_token}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const result = await tgResponse.json();

    if (!result.ok) {
      throw new Error(result.description || 'Telegram API error');
    }

    return res.json({
      success: true,
      result: result.result
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
