import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Buffer } from 'buffer';

// Загружаем шрифт с поддержкой кириллицы
const loadFont = async (pdfDoc) => {
  const fontPath = join(process.cwd(), 'pages', 'api', 'font', 'Moderustic.ttf');
  const fontBytes = readFileSync(fontPath);
  return await pdfDoc.embedFont(fontBytes);
};

// Удаляем все неподдерживаемые символы
const cleanText = (text) => {
  // Разрешаем: русские/английские буквы, цифры, пунктуацию, пробелы и переносы строк
  return text.replace(/[^\u0400-\u04FF\u0500-\u052F\u0020-\u007E\u00A0-\u00FF\u2000-\u206F\n\r]/g, '');
};

// Обрабатываем HTML-теги форматирования
const processFormatting = (text) => {
  const result = {
    text: '',
    formats: []
  };

  let currentPos = 0;
  let openTags = [];

  const tagRegex = /<(\/?)(b|i|u)>/g;
  let match;

  while ((match = tagRegex.exec(text)) !== null) {
    // Текст до тега
    const textBefore = text.slice(currentPos, match.index);
    result.text += textBefore;
    
    // Добавляем форматирование
    if (match[1] === '/') {
      // Закрывающий тег
      openTags = openTags.filter(tag => tag !== match[2]);
    } else {
      // Открывающий тег
      openTags.push(match[2]);
    }
    
    // Запоминаем позицию начала форматирования
    if (openTags.length > 0) {
      result.formats.push({
        start: result.text.length,
        end: -1, // будет установлено при закрытии тега
        type: openTags[openTags.length - 1]
      });
    } else if (result.formats.length > 0) {
      // Устанавливаем конец для последнего форматирования
      const lastFormat = result.formats[result.formats.length - 1];
      if (lastFormat.end === -1) {
        lastFormat.end = result.text.length;
      }
    }
    
    currentPos = match.index + match[0].length;
  }

  // Остаток текста после последнего тега
  result.text += text.slice(currentPos);

  // Закрываем все незакрытые форматирования
  result.formats.forEach(format => {
    if (format.end === -1) {
      format.end = result.text.length;
    }
  });

  return result;
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

    // Очищаем текст и обрабатываем форматирование
    const cleanedText = cleanText(text);
    const { text: finalText, formats } = processFormatting(cleanedText);

    // Создаем PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await loadFont(pdfDoc);
    
    // Создаем страницу
    const lines = finalText.split('\n');
    const lineHeight = 25;
    const pageHeight = 50 + (lines.length * lineHeight);
    const page = pdfDoc.addPage([600, pageHeight]);
    
    // Добавляем текст с форматированием
    lines.forEach((line, lineIndex) => {
      let currentFormats = formats.filter(f => 
        f.start <= line.length && f.end >= 0
      );

      if (currentFormats.length === 0) {
        // Простой текст без форматирования
        page.drawText(line, {
          x: 50,
          y: pageHeight - 50 - (lineIndex * lineHeight),
          size: 12,
          font,
          color: rgb(0, 0, 0)
        });
      } else {
        // Текст с форматированием
        let currentPos = 0;
        currentFormats.forEach((format, i) => {
          // Текст до форматирования
          if (format.start > currentPos) {
            page.drawText(line.slice(currentPos, format.start), {
              x: 50 + getTextWidth(line.slice(currentPos, format.start), 12, font),
              y: pageHeight - 50 - (lineIndex * lineHeight),
              size: 12,
              font,
              color: rgb(0, 0, 0)
            });
          }

          // Форматированный текст
          const formattedText = line.slice(format.start, format.end);
          page.drawText(formattedText, {
            x: 50 + getTextWidth(line.slice(0, format.start), 12, font),
            y: pageHeight - 50 - (lineIndex * lineHeight),
            size: format.type === 'b' ? 14 : 12,
            font,
            color: rgb(0, 0, 0),
            ...(format.type === 'i' && { skew: { x: 0.2, y: 0 } }),
            ...(format.type === 'u' && { underline: true })
          });

          currentPos = format.end;
        });

        // Текст после последнего форматирования
        if (currentPos < line.length) {
          page.drawText(line.slice(currentPos), {
            x: 50 + getTextWidth(line.slice(0, currentPos), 12, font),
            y: pageHeight - 50 - (lineIndex * lineHeight),
            size: 12,
            font,
            color: rgb(0, 0, 0)
          });
        }
      }
    });

    // Вспомогательная функция для расчета ширины текста
    function getTextWidth(text, size, font) {
      // Упрощенный расчет (можно заменить на точный)
      return text.length * size * 0.6;
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
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
