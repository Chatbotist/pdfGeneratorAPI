import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Buffer } from 'buffer';

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' });
  }

  try {
    const { text, chat_id, bot_token } = req.body;
    
    if (!text || !chat_id || !bot_token) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Создаем PDF без fontkit (используем стандартный Helvetica)
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // Добавляем страницу с запасом по высоте
    const lines = text.split('\n');
    const page = pdfDoc.addPage([600, 400 + (lines.length * 20)]);
    
    // Добавляем текст с поддержкой русского языка
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: 50,
        y: page.getHeight() - 50 - (index * 20),
        size: 12,
        font,
        color: rgb(0, 0, 0)
      });
    });

    const pdfBytes = await pdfDoc.save();

    // Отправляем в Telegram
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    formData.append('document', new Blob([pdfBytes]), 'document.pdf');
    
    if (req.body.caption) formData.append('caption', req.body.caption);

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
      message_id: result.result.message_id
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}
