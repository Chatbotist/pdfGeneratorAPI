import { readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

export default function handler(req, res) {
  const { filename } = req.query
  const filePath = join('/tmp', filename)

  try {
    const file = readFileSync(filePath)
    
    // Автоматическое удаление после отправки
    setTimeout(() => {
      try {
        unlinkSync(filePath)
      } catch (e) {
        console.error('Error deleting file:', e)
      }
    }, 1000)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
    return res.send(file)

  } catch (e) {
    return res.status(404).json({ error: 'File not found or expired' })
  }
}
