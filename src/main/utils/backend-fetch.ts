/* eslint-disable @typescript-eslint/no-explicit-any */
import { getToken } from '../services/auth'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  body?: any
  headers?: Record<string, string>
  baseUrl?: string
}

interface ApiResponse<T = any> {
  data: T
  status: number
  statusText: string
  ok: boolean
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers = {}, baseUrl = process.env.PUBLIC_BACKEND_URL } = options

  const token = await getToken()
  if (!token && endpoint !== '/auth/login') {
    throw new Error('No hay token de autenticación')
  }

  console.log(`baseUrl: ${baseUrl}`)
  const defaultHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...headers
  }

  if (body) {
    defaultHeaders['Content-Type'] = 'application/json'
  }

  const url = `https://scrapper-back-two.vercel.app/api${endpoint}`

  try {
    const response = await fetch(url, {
      method,
      headers: defaultHeaders,
      body: body ? JSON.stringify(body) : undefined
    })

    const responseClone = response.clone()

    let data: T
    try {
      data = await response.json()
    } catch {
      data = (await responseClone.text()) as T
    }

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      ok: response.ok
    }
  } catch (error) {
    console.error(`Error en petición a ${url}:`, error)
    throw new Error(`Error de red: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  }
}

export const backend = {
  get: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(
    endpoint: string,
    body?: any,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ) => apiRequest<T>(endpoint, { ...options, method: 'POST', body }),

  put: <T = any>(endpoint: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'PUT', body }),

  delete: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    apiRequest<T>(endpoint, { ...options, method: 'DELETE' }),

  patch: <T = any>(
    endpoint: string,
    body?: any,
    options?: Omit<RequestOptions, 'method' | 'body'>
  ) => apiRequest<T>(endpoint, { ...options, method: 'PATCH', body })
}
