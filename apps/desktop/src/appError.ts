export interface SerializedAppError {
  message: string
  code?: string
}

export class AppError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = "AppError"
    this.code = code
  }
}

function isSerializedAppError(value: unknown): value is SerializedAppError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  )
}

export function normalizeAppError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  if (isSerializedAppError(error)) {
    return new AppError(error.message, error.code)
  }

  if (typeof error === "string") {
    return new AppError(error)
  }

  return new AppError(String(error))
}

export function getAppErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === "string" ? code : null
  }
  return null
}

export function getAppErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (isSerializedAppError(error)) {
    return error.message
  }
  return String(error)
}
