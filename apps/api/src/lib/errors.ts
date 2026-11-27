export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
    /** Header tambahan untuk respons error (misalnya Retry-After). */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) =>
  new AppError("NOT_FOUND", `${what} tidak ditemukan`, 404);
export const conflict = (code: string, message: string) =>
  new AppError(code, message, 409);
export const forbidden = (message = "Tidak diizinkan") =>
  new AppError("FORBIDDEN", message, 403);
export const unauthorized = (message = "Perlu login") =>
  new AppError("UNAUTHORIZED", message, 401);
export const tooManyRequests = (retryAfterSec: number) =>
  new AppError(
    "RATE_LIMITED",
    `Terlalu banyak percobaan. Coba lagi dalam ${
      retryAfterSec >= 60 ? `sekitar ${Math.ceil(retryAfterSec / 60)} menit` : `${retryAfterSec} detik`
    }.`,
    429,
    { "retry-after": String(retryAfterSec) },
  );
