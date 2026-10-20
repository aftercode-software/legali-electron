import { chromium, Locator, Page } from 'playwright'
import { EnrichedBoleta } from '../../shared/interfaces/boletas'
import path from 'path'
import fs from 'fs'
import { BASE_OUTPUT_DIR } from '../../shared/constants/output-dir'

// En ATM hay una sola recaudadora, por eso Observaciones es un texto fijo
const OBSERVACIONES_ATM = 'DRA.AMARILLO MARCELA INES, CONTACTO: 2615024040'

// Log en C:\Legali\logs para poder revisar cargas en la PC del cliente.
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

// Observaciones es un textbox de easyui: el input que se ve en pantalla y un
// input oculto (name="observa") que es el que se envía al grabar.
interface CampoObservaciones {
  visible: Locator
  oculto: Locator
}

interface ValoresObservaciones {
  visible: string | null
  oculto: string | null // null si no se encontró el input oculto
}

async function leerObservaciones(campo: CampoObservaciones): Promise<ValoresObservaciones> {
  const visible = await leerValor(campo.visible)
  const hayOculto = await campo.oculto.count().catch(() => 0)
  const oculto = hayOculto > 0 ? await leerValor(campo.oculto.first()) : null
  return { visible, oculto }
}

function describirObservaciones(valores: ValoresObservaciones): string {
  return `pantalla="${valores.visible ?? 'sin leer'}" oculto="${valores.oculto ?? 'no encontrado'}"`
}

// Si no se encuentra el input oculto se juzga solo por lo que se ve en pantalla
function observacionesCorrectas(valores: ValoresObservaciones, texto: string): boolean {
  return valores.visible === texto && (valores.oculto === null || valores.oculto === texto)
}

// Solo lee y registra el estado del campo, no lo modifica
async function registrarObservaciones(
  campo: CampoObservaciones,
  texto: string,
  boleta: string,
  momento: string
) {
  const valores = await leerObservaciones(campo)
  const estado = observacionesCorrectas(valores, texto) ? 'OK' : 'DISTINTO'
  logCarga(
    `Boleta ${boleta} - Observaciones ${estado} (${momento}): ${describirObservaciones(valores)}`
  )
}

// Completa Observaciones y verifica que el texto haya quedado, en pantalla y en
// el input oculto; si el sitio lo borró o no lo tomó, reintenta. Si ya está
// bien, no agrega esperas.
async function completarObservaciones(
  page: Page,
  campo: CampoObservaciones,
  texto: string,
  boleta: string,
  momento: string
) {
  for (let intento = 1; intento <= 3; intento++) {
    const valores = await leerObservaciones(campo)
    if (observacionesCorrectas(valores, texto)) {
      logCarga(
        `Boleta ${boleta} - Observaciones OK (${momento}): ${describirObservaciones(valores)}`
      )
      return
    }
    if (intento > 1 || momento !== 'al completar') {
      logCarga(
        `Boleta ${boleta} - Observaciones DISTINTO (${momento}): ${describirObservaciones(valores)}, se vuelve a completar`
      )
      await page.waitForTimeout(500)
    }
    try {
      if (valores.visible !== texto) {
        await campo.visible.fill(texto, { timeout: 5000 })
      }
      // easyui pasa el texto al input oculto al salir del campo
      await campo.visible.evaluate((el) => (el as HTMLElement).blur(), undefined, {
        timeout: 2000
      })
      if (intento > 1) {
        // Último recurso: usar la API de easyui del sitio para fijar el valor
        await page.evaluate((valor) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const $ = (window as any).jQuery
          if ($ && $('#observa').length && $('#observa').textbox) {
            $('#observa').textbox('setValue', valor)
          }
        }, texto)
      }
    } catch (error) {
      logCarga(`Boleta ${boleta} - Error al completar Observaciones (${momento}): ${error}`)
    }
  }
  const valoresFinales = await leerObservaciones(campo)
  logCarga(
    observacionesCorrectas(valoresFinales, texto)
      ? `Boleta ${boleta} - Observaciones OK (${momento}): ${describirObservaciones(valoresFinales)}`
      : `Boleta ${boleta} - ATENCION: Observaciones quedó mal (${momento}): ${describirObservaciones(valoresFinales)}`
  )
}

// Procesar una sola boleta
async function procesarBoleta(page: Page, boleta: EnrichedBoleta) {
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
  await monto.fill(String(boleta.monto))
  const objetoImponible = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[20]/td[2]/div/span/input[1]'
  )
  if (boleta.tipo === 'Multas') {
    await objetoImponible.fill(`MULTAS N° ${boleta.objeto}`.toUpperCase())
  } else if (boleta.tipo === 'Automotores') {
    await objetoImponible.fill(`AUTOMOTOR PATENTE  N° ${boleta.objeto} `.toUpperCase())
  } else if (boleta.tipo === 'Inmobiliarios') {
    await objetoImponible.fill(`INMOBILIARIO PADRÓN N° ${boleta.objeto}`.toUpperCase())
  } else if (boleta.tipo === 'Ingresos Brutos') {
    await objetoImponible.fill(`INGRESOS BRUTOS N° ${boleta.objeto}`.toUpperCase())
  } else if (boleta.tipo === 'Sellos') {
    await objetoImponible.fill(`SELLO N° ${boleta.objeto}`.toUpperCase())
  }
  const observaciones: CampoObservaciones = {
    visible: page.locator(
      'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[20]/td[3]/div/span/input[1]'
    ),
    oculto: page.locator(
      'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[20]/td[3]/div/span/input[@type="hidden"]'
    )
  }
  const recaudador = boleta.recaudador
  const textoObservaciones = OBSERVACIONES_ATM
  await completarObservaciones(
    page,
    observaciones,
    textoObservaciones,
    boleta.boleta,
    'al completar'
  )

  const tributo = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[19]/td[3]/div/span/input[1]'
  )
  await tributo.click()
  await page.waitForTimeout(2500)
  if (boleta.tipo === 'Multas') {
    await page.locator('#_easyui_combobox_i7_4').click()
  } else {
    await page.locator('#_easyui_combobox_i7_1').click()
  }
  await registrarObservaciones(
    observaciones,
    textoObservaciones,
    boleta.boleta,
    'despues de tributo'
  )
  const oficial = page.locator(
    'xpath=/html/body/div[11]/div[2]/form[1]/table/tbody/tr[13]/td[3]/div/span/span/a'
  )
  await oficial.click()
  await page.locator('#_easyui_combobox_i8_2').click()
  await registrarObservaciones(
    observaciones,
    textoObservaciones,
    boleta.boleta,
    'despues de oficial'
  )

  await page.waitForTimeout(2500)

  console.log('boleta', boleta)
  let path = ''
  switch (boleta.tipo) {
    case 'Ingresos Brutos':
      path = 'ingresos-brutos'
      break
    case 'Automotores':
      path = 'automotores'
      break
    case 'Sellos':
      path = 'sellos'
      break
    case 'Multas':
      path = 'multas'
      break
    case 'Inmobiliarios':
      path = 'inmobiliarios'
      break
  }
  console.log(path)
  const archivoPath = `${BASE_OUTPUT_DIR}/boletas/${path}/ATM${boleta.boleta}.pdf`
  await page.setInputFiles('input#filebox_file_id_1', archivoPath)
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

// Flujo principal: registra la carga en el log y cualquier error que la corte
export async function subirBoletas(
  boletas: EnrichedBoleta[],
  montoThreshold: number,
  modoInhibicion: string
) {
  const recaudadores = [...new Set(boletas.map((b) => b.recaudador?.idNombre))].join(', ')
  logCarga(
    `=== Inicio de carga: ${boletas.length} boletas (se cargan hasta 25) | recaudador: ${recaudadores} | inhibicion: ${modoInhibicion} | montoThreshold: ${montoThreshold}`
  )
  try {
    await cargarLote(boletas, montoThreshold, modoInhibicion)
    logCarga('=== Fin de carga')
  } catch (error) {
    logCarga(`❌ La carga se cortó por un error: ${error}`)
    throw error
  }
}

async function cargarLote(
  boletas: EnrichedBoleta[],
  montoThreshold: number,
  modoInhibicion: string
) {
  console.log('montoThreshold', montoThreshold)
  const chromePath = findChromeExe()
  if (!chromePath) {
    logCarga('No se encontró la ruta de Chrome. Asegúrate de que esté instalado.')
    return
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath: chromePath
  })
  const context = await browser.newContext({ storageState: 'auth.json' })
  const page = await context.newPage()
  await page.goto('https://www.jus.mendoza.gov.ar/tributario/precarga/index.php')
  await page.mouse.wheel(0, 50)
  await page.waitForTimeout(4000)

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
  const tipos = new Set<string>()

  for (const boleta of boletas.slice(0, maxIterations)) {
    tipos.add(boleta.tipo)
    logCarga(
      `Boleta ${boleta.boleta} - inicio (${boleta.tipo}, recaudador: ${boleta.recaudador?.idNombre})`
    )
    try {
      await procesarBoleta(page, boleta)
    } catch (error) {
      logCarga(`❌ Boleta ${boleta.boleta} - error: ${error}`)
      throw error
    }
  }
  console.log('Tipos de boleta detectados:', Array.from(tipos))

  await page.waitForTimeout(60000)
}

export function findChromeExe(): string | null {
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
