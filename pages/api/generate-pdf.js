import { writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export default async function handler(req, res) {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method allowed' })
  }

  try {
    const { text } = req.body
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' })
    }

    // Создаем PDF
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([600, 400])
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
    
    page.drawText(text, {
      x: 50,
      y: 350,
      size: 15,
      font,
      color: rgb(0, 0, 0),
    })

    const pdfBytes = await pdfDoc.save()

    // Сохраняем временный файл
    const fileName = `${uuidv4()}.pdf`
    const filePath = join('/tmp', fileName)
    writeFileSync(filePath, pdfBytes)

    // Ссылка будет действительна 5 минут
    const pdfUrl = `${process.env.VERCEL_URL}/api/temp-pdf/${fileName}`
    
    return res.status(200).json({ 
      pdfUrl,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    })

  } catch (error) {
    console.error('PDF generation error:', error)
    return res.status(500).json({ 
      error: 'PDF generation failed',
      details: error.message 
    })
  }
}
