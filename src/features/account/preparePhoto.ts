export async function preparePhoto(file: File, cover = false): Promise<string> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw Error('Escolhe uma imagem JPG, PNG ou WebP até 10 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw Error('A imagem é demasiado grande. Escolhe uma fotografia mais pequena.')
    const canvas = document.createElement('canvas')
    canvas.width = cover ? 1024 : 512; canvas.height = cover ? 400 : 512
    const context = canvas.getContext('2d')
    if (!context) throw Error('Não foi possível preparar a fotografia neste browser.')
    context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height)
    const scale = Math.max(canvas.width / bitmap.width,canvas.height / bitmap.height)
    const width = canvas.width / scale, height = canvas.height / scale
    context.drawImage(bitmap,(bitmap.width-width)/2,(bitmap.height-height)/2,width,height,0,0,canvas.width,canvas.height)
    const data = canvas.toDataURL('image/jpeg',0.85).split(',')[1]
    if (data.length > 349_528) throw Error('A fotografia continua demasiado grande. Escolhe outra imagem.')
    return data
  } finally { bitmap.close() }
}

