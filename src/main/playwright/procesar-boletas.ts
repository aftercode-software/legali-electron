import { chromium, Locator, Page } from 'playwright'
import { EnrichedBoleta } from '../../shared/interfaces/boletas'
import path from 'path'
import fs from 'fs'
import { BASE_OUTPUT_DIR } from '../../shared/constants/output-dir'

// 2616521150 -> 261-6521150 (si no tiene 10 dígitos se deja como viene)
function formatearTelefono(telefono?: string): string {
  const digitos = String(telefono ?? '').replace(/\D/g, '')
  return digitos.length === 10
    ? `${digitos.slice(0, 3)}-${digitos.slice(3)}`
    : String(telefono ?? '')
}

// Log en C:\LexFlow\logs para poder revisar cargas en la PC del cliente.
// Nunca corta la carga si no se puede escribir.
function logCarga(mensaje: string) {
  console.log(mensaje)
  try {
    const logsDir = path.join(BASE_OUTPUT_DIR, 'logs')
    fs.mkdirSync(logsDir, { recursive: true })
    const ahora = new Date()
    const archivo = path.join(logsDir, `boletas-${ahora.toISOString().slice(0, 10)}.log`)
    fs.appendFileSync(archivo, `[${ahora.toISOString()}] ${mensaje}\n`)
  } catch {
    // sin log, la carga sigue igual
  }
}

async function leerValor(campo: Locator): Promise<string | null> {
  try {
    return await campo.inputValue({ timeout: 2000 })
  } catch {
    return null
  }
}

// Completa Observaciones y verifica que el texto haya quedado; si el sitio lo
// borró o no lo tomó, reintenta. Si ya está bien, no agrega esperas.
async function completarObservaciones(
  page: Page,
  campo: Locator,
  texto: string,
  boleta: string,
  momento: string
) {
  for (let intento = 1; intento <= 3; intento++) {
    const valorActual = await leerValor(campo)
    if (valorActual === texto) {
      logCarga(`Boleta ${boleta} - Observaciones OK (${momento}): ${texto}`)
      return
    }
    if (intento > 1 || momento !== 'al completar') {
      logCarga(
        `Boleta ${boleta} - Observaciones con "${valorActual ?? 'sin leer'}" (${momento}), se vuelve a completar`
      )
      await page.waitForTimeout(500)
    }
    try {
      await campo.fill(texto, { timeout: 5000 })
    } catch (error) {
      logCarga(`Boleta ${boleta} - Error al completar Observaciones (${momento}): ${error}`)
    }
  }
  const valorFinal = await leerValor(campo)
  logCarga(
    valorFinal === texto
      ? `Boleta ${boleta} - Observaciones OK (${momento}): ${texto}`
      : `Boleta ${boleta} - ATENCION: Observaciones quedó "${valorFinal ?? 'sin leer'}" (${momento})`
  )
}

// Procesar una sola boleta
async function procesarBoleta(page: Page, boleta: EnrichedBoleta, oficial2: boolean) {
  await page.waitForTimeout(4000)
  await page.locator('text="Nuevo Registro"').click()
  await page.waitForSelector('.window:visible', { timeout: 5000 })

  const boletaInput = page.locator(
    '.window:visible label:has-text("Boleta") ~ span input.textbox-text'
  )
  await boletaInput.click()
  await boletaInput.fill(boleta.boleta)

  const apellido = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[5]/td[2]/div/span/input[1]'
  )

  await apellido.fill(boleta.demandado.apellido)
  await page
    .locator('xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[6]/td[2]/div/span/span')
    .click()
  if (boleta.demandado.tipoDocumento === 'CUIT') {
    const cuitSelect = page.locator('#_easyui_combobox_i4_4')
    await cuitSelect.click()
  } else {
    const dniSelect = page.locator('#_easyui_combobox_i4_2')
    await dniSelect.click()
  }
  const domicilio = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[7]/td[2]/div/p/span/input[1]'
  )
  console.log(`Debug: boleta.demandado.domicilio =`, boleta.demandado.domicilio)
  await domicilio.fill(boleta.demandado.domicilio)
  const nombre = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[5]/td[3]/div/span/input[1]'
  )
  console.log(`Debug: boleta.demandado.nombre =`, boleta.demandado.nombre)
  await nombre.fill(boleta.demandado.nombre)
  const documento = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[6]/td[3]/div/p/span/input[1]'
  )
  console.log(`Debug: boleta.demandado.numeroDocumento =`, boleta.demandado.numeroDocumento)
  await documento.fill(boleta.demandado.numeroDocumento)
  const monto = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[19]/td[2]/div/p/span/input[1]'
  )
  await page.waitForTimeout(2500)

  console.log(`Debug: boleta.monto =`, boleta.monto)
  await monto.fill(boleta.monto)
  const objetoImponible = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[20]/td[2]/div/span/input[1]'
  )
  if (boleta.tipo === 'Profesional') {
    await objetoImponible.fill(`APORTES MATRICULA N° ${boleta.demandado.matricula}`.toUpperCase())
  } else {
    await objetoImponible.fill(
      `APORTES EN JUICIO ${boleta.expediente} - ${boleta.juzgado} `.toUpperCase()
    )
  }
  const observaciones = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[20]/td[3]/div/span/input[1]'
  )
  const recaudador = boleta.recaudador
  const textoObservaciones = `Dr. ${recaudador.nombre}: ${formatearTelefono(recaudador.telefono)} - ${recaudador.oficial}: ${formatearTelefono(recaudador.celular)}`
  await completarObservaciones(
    page,
    observaciones,
    textoObservaciones,
    boleta.boleta,
    'al completar'
  )
  await page
    .locator('xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[19]/td[3]/div/span/span/a')
    .click()
  await page.waitForTimeout(2500)

  await page.locator('#_easyui_combobox_i7_0').click()
  const oficial = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[13]/td[3]/div/span/span/a'
  )
  await oficial.click()
  if (oficial2) {
    await page.locator('#_easyui_combobox_i8_1').click()
  } else {
    await page.locator('#_easyui_combobox_i8_0').click()
  }

  if (boleta.tipo === 'Profesional') {
    const archivoPath = `${BASE_OUTPUT_DIR}/boletas/profesionales/${boleta.boleta}.pdf`
    await page.setInputFiles('input#filebox_file_id_1', archivoPath)
  } else {
    const archivoPath = `${BASE_OUTPUT_DIR}/boletas/terceros/${boleta.boleta}.pdf`
    await page.setInputFiles('input#filebox_file_id_1', archivoPath)
  }

  await page.locator('input[type="submit"][value="Guardar"]').click()
  await page.waitForTimeout(1500)
  await page.locator('xpath=/html/body/div[13]/div[3]/a/span/span').click()
  await page.waitForTimeout(1500)
  await completarObservaciones(
    page,
    observaciones,
    textoObservaciones,
    boleta.boleta,
    'antes de grabar'
  )
  const grabar = page.locator('xpath=/html/body/div[11]/div[3]/a[1]/span')
  await grabar.click()
  logCarga(`✅ Boleta ${boleta.boleta} completada (recaudador: ${recaudador.idNombre})`)
}

// Flujo principal
export async function subirBoletas(
  boletas: EnrichedBoleta[],
  montoThreshold: number,
  modoInhibicion: string,
  oficial2: boolean
) {
  console.log('montoThreshold', montoThreshold)
  const chromePath = findChromeExe()
  if (!chromePath) {
    console.error('No se encontró la ruta de Chrome. Asegúrate de que esté instalado.')
    return
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath: chromePath
    // Si quieres que corra oculto, pon headless: true
  })
  const context = await browser.newContext({ storageState: 'auth.json' })
  const page = await context.newPage()
  await page.goto('https://www.jus.mendoza.gov.ar/tributario/precarga/index.php')
  // Forzar carga de elementos con scroll
  await page.mouse.wheel(0, 50)
  await page.waitForTimeout(4000)

  // Forzar interacción con click invisible (en un lugar seguro

  await page.waitForTimeout(1000)
  await page
    .locator('xpath=/html/body/center[3]/div[2]/div[2]/table/tbody/tr/td[7]/a[2]/span/span')
    .click()
  await page.waitForTimeout(2000)
  await page
    .locator('xpath=/html/body/center[3]/div[2]/div[2]/table/tbody/tr/td[2]/span/span/a')
    .click()
  await page.waitForTimeout(2000)
  await page.locator('#_easyui_combobox_i1_1').click()
  await page
    .locator('xpath=/html/body/center[3]/div[2]/div[2]/table/tbody/tr/td[4]/span/span')
    .click()
  await page.waitForTimeout(2000)
  await page.locator('#_easyui_combobox_i2_1').click()
  await page.waitForTimeout(2000)
  await page
    .locator('xpath=/html/body/center[3]/div[2]/div[2]/table/tbody/tr/td[6]/span/span')
    .click()
  await page.waitForTimeout(1000)
  if (modoInhibicion === 'con') {
    await page.locator('#_easyui_combobox_i3_1').click()
  } else {
    await page.locator('#_easyui_combobox_i3_9').click()
  }
  await page.waitForTimeout(4000)
  await page.locator('#buttonGuardar').click()
  await page.waitForTimeout(3000)
  const maxIterations = Math.min(boletas.length, 25)
  for (const boleta of boletas.slice(0, maxIterations)) {
    await procesarBoleta(page, boleta, oficial2)
  }
  await page.waitForTimeout(60000)
}

export function findChromeExe(): string | null {
  // Rutas típicas en Windows
  const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files'
  const programFilesx86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'

  const chrome64 = path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')
  const chrome32 = path.join(programFilesx86, 'Google', 'Chrome', 'Application', 'chrome.exe')

  if (fs.existsSync(chrome64)) {
    return chrome64
  } else if (fs.existsSync(chrome32)) {
    return chrome32
  } else {
    return null
  }
}
